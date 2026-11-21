//! Microsoft device-code polling and bounded refresh-token requests.
use super::*;

impl MicrosoftAuth {
    pub async fn begin(&self, client_id: &str) -> Result<DeviceGrant> {
        ensure!(
            uuid::Uuid::parse_str(client_id).is_ok(),
            "auth.errors.clientId"
        );
        #[derive(Deserialize)]
        struct Response {
            device_code: String,
            user_code: String,
            verification_uri: String,
            expires_in: u64,
            #[serde(default = "default_interval")]
            interval: u64,
        }
        let response: Response = read_response(
            self.client
                .post(DEVICE)
                .form(&[("client_id", client_id), ("scope", SCOPE)]),
        )
        .await?;
        ensure!(
            (1..=3600).contains(&response.expires_in)
                && (1..=60).contains(&response.interval)
                && !response.device_code.is_empty()
                && response.user_code.len() <= 32,
            "auth.errors.response"
        );
        let uri = reqwest::Url::parse(&response.verification_uri)
            .map_err(|_| anyhow::anyhow!("auth.errors.response"))?;
        ensure!(
            uri.scheme() == "https"
                && matches!(
                    uri.host_str(),
                    Some("microsoft.com" | "www.microsoft.com" | "login.microsoftonline.com")
                )
                && uri.username().is_empty()
                && uri.password().is_none(),
            "auth.errors.response"
        );
        Ok(DeviceGrant {
            prompt: LoginPrompt {
                id: uuid::Uuid::new_v4().to_string(),
                user_code: response.user_code,
                verification_uri: response.verification_uri,
                expires_at: now() + response.expires_in,
            },
            client_id: client_id.into(),
            device_code: response.device_code,
            interval: response.interval,
        })
    }

    pub async fn poll(
        &self,
        grant: &DeviceGrant,
        cancellation: &CancellationToken,
    ) -> Result<OAuthTokens> {
        let mut interval = grant.interval;
        loop {
            ensure!(now() < grant.prompt.expires_at, "auth.errors.expired");
            let remaining = grant.prompt.expires_at.saturating_sub(now());
            tokio::select! {
                biased;
                () = cancellation.cancelled() => bail!("auth.errors.cancelled"),
                () = tokio::time::sleep(Duration::from_secs(interval.min(remaining))) => {}
            }
            ensure!(now() < grant.prompt.expires_at, "auth.errors.expired");
            let response: Result<OAuthTokens> = tokio::select! {
                biased;
                () = cancellation.cancelled() => bail!("auth.errors.cancelled"),
                result = read_response(self.client.post(TOKEN).form(&[("grant_type", "urn:ietf:params:oauth:grant-type:device_code"), ("client_id", grant.client_id.as_str()), ("device_code", grant.device_code.as_str())])) => result
            };
            match response {
                Ok(tokens) => {
                    validate_tokens(&tokens)?;
                    return Ok(tokens);
                }
                Err(error) if error.to_string() == "auth.errors.pending" => {}
                Err(error) if error.to_string() == "auth.errors.slowDown" => {
                    interval = (interval + 5).min(120)
                }
                Err(error) => return Err(error),
            }
        }
    }

    pub async fn refresh(&self, client_id: &str, refresh_token: &str) -> Result<OAuthTokens> {
        ensure!(
            uuid::Uuid::parse_str(client_id).is_ok(),
            "auth.errors.clientId"
        );
        let tokens = read_response(self.client.post(TOKEN).form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("scope", SCOPE),
        ]))
        .await?;
        validate_tokens(&tokens)?;
        Ok(tokens)
    }
}
