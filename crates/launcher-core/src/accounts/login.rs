//! Device-code reservations, cancellation and completion before credential commit.
use super::*;

impl AccountsManager {
    pub async fn begin(&self, network: &NetworkOptions) -> Result<LoginPrompt> {
        self.begin_with_id(&uuid::Uuid::new_v4().to_string(), network)
            .await
    }
    pub async fn begin_with_id(
        &self,
        request_id: &str,
        network: &NetworkOptions,
    ) -> Result<LoginPrompt> {
        let auth = MicrosoftAuth::new(network)?;
        self.begin_with_fetch(request_id, |client_id| async move {
            auth.begin(&client_id).await
        })
        .await
    }
    pub(super) async fn begin_with_fetch<F, Fut>(&self, id: &str, fetch: F) -> Result<LoginPrompt>
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Result<DeviceGrant>>,
    {
        ensure!(uuid::Uuid::parse_str(id).is_ok(), "auth.errors.profile");
        let cancellation = CancellationToken::new();
        self.reserve_login(id, &cancellation)?;
        // Reservation cleanup also runs if the caller drops the begin future.
        let _reservation = StartingLoginGuard { manager: self, id };
        tokio::select! {
            biased;
            () = cancellation.cancelled() => Err(anyhow::anyhow!("auth.errors.cancelled")),
            result = async {
                let _guard = self.gate.lock().await;
                ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
                let state = self.load()?;
                ensure!(state.accounts.len() < 32, "auth.errors.capacity");
                let mut grant = fetch(state.client_id).await?;
                grant.prompt.id = id.into();
                self.publish_prompt(grant, &cancellation)
            } => result,
        }
    }

    fn reserve_login(&self, id: &str, cancellation: &CancellationToken) -> Result<()> {
        let mut starting = self
            .starting
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        ensure!(starting.is_none(), "auth.errors.busy");
        let mut cancelled = self
            .cancelled_starts
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        if let Some(index) = cancelled.iter().position(|cancelled_id| cancelled_id == id) {
            cancelled.remove(index);
            return Err(anyhow::anyhow!("auth.errors.cancelled"));
        }
        // Preserve the reservation lock order used by synchronous cancellation.
        drop(cancelled);
        self.ensure_no_pending_login()?;
        *starting = Some(StartingLogin {
            id: id.into(),
            cancellation: cancellation.clone(),
        });
        Ok(())
    }

    fn publish_prompt(
        &self,
        grant: DeviceGrant,
        cancellation: &CancellationToken,
    ) -> Result<LoginPrompt> {
        let prompt = grant.prompt.clone();
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        *pending = Some(Pending {
            grant: Arc::new(grant),
            cancellation: cancellation.clone(),
            phase: LoginPhase::Authorizing,
        });
        Ok(prompt)
    }
    pub(super) fn ensure_no_pending_login(&self) -> Result<()> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        if pending.as_ref().is_some_and(|p| {
            p.phase == LoginPhase::Authorizing
                && (p.cancellation.is_cancelled() || p.grant.prompt.expires_at <= now())
        }) {
            *pending = None;
        }
        ensure!(pending.is_none(), "auth.errors.busy");
        Ok(())
    }
    pub fn cancel(&self, id: &str) -> Result<()> {
        {
            let starting = self
                .starting
                .lock()
                .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
            if let Some(starting) = &*starting
                && starting.id == id
            {
                starting.cancellation.cancel();
            } else if uuid::Uuid::parse_str(id).is_ok() {
                // The synchronous cancel IPC can arrive before an async begin
                // future is first polled. Keep bounded public request IDs under
                // the same reservation lock so neither ordering loses the stop.
                self.remember_cancelled_start(id)?;
            }
        }
        let pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        if let Some(pending) = &*pending
            && pending.grant.prompt.id == id
            && pending.phase != LoginPhase::Committing
        {
            pending.cancellation.cancel();
        }
        Ok(())
    }

    fn remember_cancelled_start(&self, id: &str) -> Result<()> {
        let mut cancelled = self
            .cancelled_starts
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        if cancelled.iter().any(|cancelled_id| cancelled_id == id) {
            return Ok(());
        }
        if cancelled.len() >= 128 {
            cancelled.pop_front();
        }
        cancelled.push_back(id.into());
        Ok(())
    }
    pub fn verification_uri(&self, id: &str) -> Result<String> {
        let pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        let pending = pending
            .as_ref()
            .filter(|p| {
                p.grant.prompt.id == id
                    && !p.cancellation.is_cancelled()
                    && p.grant.prompt.expires_at > now()
            })
            .ok_or_else(|| anyhow::anyhow!("auth.errors.expired"))?;
        Ok(pending.grant.prompt.verification_uri.clone())
    }
    pub async fn complete(&self, id: &str, network: &NetworkOptions) -> Result<AccountsState> {
        let (grant, cancellation) = {
            let pending = self
                .pending
                .lock()
                .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
            let pending = pending
                .as_ref()
                .filter(|p| p.grant.prompt.id == id)
                .ok_or_else(|| anyhow::anyhow!("auth.errors.expired"))?;
            (pending.grant.clone(), pending.cancellation.clone())
        };
        let result = tokio::select! {
            biased;
            () = cancellation.cancelled() => Err(anyhow::anyhow!("auth.errors.cancelled")),
            guard = self.gate.lock() => {
                let _guard = guard;
                self.finish_login(&grant, &cancellation, network).await
            }
        };
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| anyhow::anyhow!("auth.errors.service"))?;
        if pending.as_ref().is_some_and(|p| p.grant.prompt.id == id) {
            *pending = None;
        }
        result
    }
    pub(super) async fn finish_login(
        &self,
        grant: &DeviceGrant,
        cancellation: &CancellationToken,
        network: &NetworkOptions,
    ) -> Result<AccountsState> {
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        let auth = MicrosoftAuth::new(network)?;
        let tokens = auth.poll(grant, cancellation).await?;
        let session = tokio::select! {
            biased;
            () = cancellation.cancelled() => return Err(anyhow::anyhow!("auth.errors.cancelled")),
            result = auth.game_session(&tokens.access_token) => result?,
        };
        ensure!(!cancellation.is_cancelled(), "auth.errors.cancelled");
        self.commit_login(grant, cancellation, session, tokens.refresh_token)
    }
}
