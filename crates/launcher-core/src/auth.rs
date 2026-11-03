//! Microsoft device-code authentication. Secrets never cross the IPC boundary.
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Result, bail, ensure};
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

const DEVICE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";

#[derive(Clone, Serialize)]
pub struct LoginPrompt {
    pub id: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at: u64,
}

// Deliberately no Debug/Serialize implementation on secret-bearing types.
pub struct DeviceGrant {
    pub prompt: LoginPrompt,
    client_id: String,
    device_code: String,
    interval: u64,
}

#[cfg(test)]
pub(crate) fn test_device_grant(expires_at: u64) -> DeviceGrant {
    DeviceGrant {
        prompt: LoginPrompt {
            id: uuid::Uuid::new_v4().to_string(),
            user_code: "TEST-CODE".into(),
            verification_uri: "https://microsoft.com/devicelogin".into(),
            expires_at,
        },
        client_id: uuid::Uuid::new_v4().to_string(),
        device_code: "test-device-code".into(),
        interval: 5,
    }
}

#[derive(Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub skin_url: Option<String>,
}

impl Account {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            uuid::Uuid::parse_str(&self.id).is_ok(),
            "auth.errors.profile"
        );
        ensure!(
            !self.name.is_empty()
                && self.name.len() <= 64
                && !self.name.chars().any(char::is_control),
            "auth.errors.profile"
        );
        if let Some(url) = &self.skin_url {
            let url =
                reqwest::Url::parse(url).map_err(|_| anyhow::anyhow!("auth.errors.profile"))?;
            ensure!(
                url.scheme() == "https"
                    && url.host_str() == Some("textures.minecraft.net")
                    && url.username().is_empty()
                    && url.password().is_none(),
                "auth.errors.profile"
            );
        }
        Ok(())
    }
}

pub struct GameSession {
    pub account: Account,
    pub access_token: String,
    pub expires_at: u64,
}

#[derive(Clone)]
pub struct MicrosoftAuth {
    client: Client,
}

impl MicrosoftAuth {
    pub fn new(network: &crate::network::NetworkOptions) -> Result<Self> {
        network.validate()?;
        let mut builder = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(network.timeout_seconds.into()))
            .user_agent(concat!("ParadoxLauncher/", env!("CARGO_PKG_VERSION")));
        if !network.proxy_url.trim().is_empty() {
            builder = builder.proxy(
                reqwest::Proxy::all(network.proxy_url.trim())
                    .map_err(|_| anyhow::anyhow!("auth.errors.network"))?,
            );
        }
        Ok(Self {
            client: builder
                .build()
                .map_err(|_| anyhow::anyhow!("auth.errors.network"))?,
        })
    }

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

    pub async fn game_session(&self, access_token: &str) -> Result<GameSession> {
        let xbox: Value = read_response(self.client.post("https://user.auth.xboxlive.com/user/authenticate").json(&json!({"Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket":format!("d={access_token}")},"RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"}))).await?;
        let xbox_token = required_string(&xbox, "/Token")?;
        let xsts: Value = read_response(self.client.post("https://xsts.auth.xboxlive.com/xsts/authorize").json(&json!({"Properties":{"SandboxId":"RETAIL","UserTokens":[xbox_token]},"RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"}))).await?;
        let hash = required_string(&xsts, "/DisplayClaims/xui/0/uhs")?;
        let xsts_token = required_string(&xsts, "/Token")?;
        let minecraft: Value = read_response(
            self.client
                .post("https://api.minecraftservices.com/authentication/login_with_xbox")
                .json(&json!({"identityToken":format!("XBL3.0 x={hash};{xsts_token}")})),
        )
        .await?;
        let token = required_string(&minecraft, "/access_token")?;
        let expires_in = minecraft["expires_in"]
            .as_u64()
            .filter(|v| (60..=86400).contains(v))
            .ok_or_else(|| anyhow::anyhow!("auth.errors.response"))?;
        let expires_at = now() + expires_in;
        let entitlement: Value = read_response(
            self.client
                .get("https://api.minecraftservices.com/entitlements/mcstore")
                .bearer_auth(token),
        )
        .await?;
        ensure!(
            entitlement["items"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| matches!(
                    item["name"].as_str(),
                    Some("game_minecraft" | "product_minecraft")
                ))),
            "auth.errors.noEntitlement"
        );
        let profile: Value = read_response(
            self.client
                .get("https://api.minecraftservices.com/minecraft/profile")
                .bearer_auth(token),
        )
        .await?;
        let account = account_from_profile(&profile)?;
        Ok(GameSession {
            account,
            access_token: token.into(),
            expires_at,
        })
    }
}

fn account_from_profile(profile: &Value) -> Result<Account> {
    let id = uuid::Uuid::parse_str(required_string(profile, "/id")?)
        .map_err(|_| anyhow::anyhow!("auth.errors.profile"))?
        .to_string();
    let account = Account {
        id,
        name: required_string(profile, "/name")?.into(),
        skin_url: profile["skins"]
            .as_array()
            .and_then(|skins| skins.iter().find(|skin| skin["state"] == "ACTIVE"))
            .and_then(|skin| skin["url"].as_str())
            .map(normalize_profile_skin_url)
            .transpose()?,
    };
    account.validate()?;
    Ok(account)
}

fn normalize_profile_skin_url(raw: &str) -> Result<String> {
    let mut url = reqwest::Url::parse(raw).map_err(|_| anyhow::anyhow!("auth.errors.profile"))?;
    ensure!(
        matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("textures.minecraft.net")
            && url.username().is_empty()
            && url.password().is_none(),
        "auth.errors.profile"
    );
    // Official profiles may use HTTP texture URLs; persist the secure equivalent.
    url.set_scheme("https")
        .map_err(|_| anyhow::anyhow!("auth.errors.profile"))?;
    Ok(url.into())
}

fn default_interval() -> u64 {
    5
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn validate_tokens(tokens: &OAuthTokens) -> Result<()> {
    ensure!(
        !tokens.access_token.is_empty() && !tokens.refresh_token.is_empty(),
        "auth.errors.response"
    );
    Ok(())
}
fn required_string<'a>(value: &'a Value, pointer: &str) -> Result<&'a str> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("auth.errors.response"))
}

async fn read_response<T: DeserializeOwned>(request: RequestBuilder) -> Result<T> {
    let mut response = request
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("auth.errors.network"))?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::anyhow!("auth.errors.network"))?
    {
        ensure!(
            bytes.len() + chunk.len() <= 1024 * 1024,
            "auth.errors.response"
        );
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        let error: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        bail!(service_error(&error, status.as_u16()));
    }
    serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("auth.errors.response"))
}

fn service_error(value: &Value, status: u16) -> &'static str {
    match value["error"].as_str() {
        Some("authorization_pending") => "auth.errors.pending",
        Some("slow_down") => "auth.errors.slowDown",
        Some("authorization_declined" | "access_denied") => "auth.errors.denied",
        Some("expired_token") => "auth.errors.expired",
        Some("invalid_grant") => "auth.errors.loginRequired",
        Some("unauthorized_client" | "invalid_client") => "auth.errors.clientId",
        _ => match value["XErr"].as_u64() {
            Some(2148916233) => "auth.errors.noXboxProfile",
            Some(2148916235) => "auth.errors.region",
            Some(2148916236..=2148916238) => "auth.errors.family",
            _ if status == 404 => "auth.errors.noEntitlement",
            _ if status == 401 => "auth.errors.loginRequired",
            _ => "auth.errors.service",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile_with_skin(url: Option<&str>) -> Value {
        json!({
            "id": "069a79f444e94726a5befca90e38aaf5",
            "name": "Player",
            "skins": url.map(|url| vec![json!({"state": "ACTIVE", "url": url})]).unwrap_or_default(),
        })
    }

    #[test]
    fn official_profile_normalizes_http_skin_urls_to_https() {
        let account = account_from_profile(&profile_with_skin(Some(
            "http://textures.minecraft.net/texture/abc",
        )))
        .expect("official texture URLs must not reject a valid Minecraft account");
        assert_eq!(account.id, "069a79f4-44e9-4726-a5be-fca90e38aaf5");
        assert_eq!(
            account.skin_url.as_deref(),
            Some("https://textures.minecraft.net/texture/abc")
        );
        account.validate().unwrap();
    }

    #[test]
    fn profile_skin_normalization_preserves_secure_urls_and_absent_skins() {
        let account = account_from_profile(&profile_with_skin(Some(
            "https://textures.minecraft.net/texture/abc",
        )))
        .unwrap();
        assert_eq!(
            account.skin_url.as_deref(),
            Some("https://textures.minecraft.net/texture/abc")
        );
        assert!(
            account_from_profile(&profile_with_skin(None))
                .unwrap()
                .skin_url
                .is_none()
        );
        let mut profile = profile_with_skin(Some("http://untrusted.invalid/skin"));
        profile["skins"][0]["state"] = json!("INACTIVE");
        assert!(account_from_profile(&profile).unwrap().skin_url.is_none());
    }

    #[test]
    fn profile_skin_normalization_rejects_untrusted_addresses() {
        for url in [
            "http://untrusted.invalid/skin",
            "https://textures.minecraft.net.untrusted.invalid/skin",
            "http://user@textures.minecraft.net/texture/abc",
            "https://user:secret@textures.minecraft.net/texture/abc",
            "ftp://textures.minecraft.net/texture/abc",
            "not a URL",
        ] {
            let error = account_from_profile(&profile_with_skin(Some(url))).unwrap_err();
            assert_eq!(error.to_string(), "auth.errors.profile");
            assert!(!error.to_string().contains("secret"));
        }
    }

    #[test]
    fn errors_never_include_service_secrets() {
        let body = json!({"error":"invalid_grant","error_description":"SECRET refresh_token=secret","access_token":"secret"});
        assert_eq!(service_error(&body, 400), "auth.errors.loginRequired");
        assert_eq!(
            service_error(&json!({"XErr":2148916233_u64}), 401),
            "auth.errors.noXboxProfile"
        );
        assert_eq!(
            service_error(&json!({"XErr":2148916238_u64}), 401),
            "auth.errors.family"
        );
        assert_eq!(
            service_error(&json!({"error":"slow_down"}), 400),
            "auth.errors.slowDown"
        );
    }
    #[test]
    fn account_profile_rejects_invalid_ids_and_remote_skin_hosts() {
        let mut account = Account {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Player".into(),
            skin_url: Some("https://textures.minecraft.net/texture/abc".into()),
        };
        account.validate().unwrap();
        account.skin_url = Some("https://evil.invalid/skin".into());
        assert!(account.validate().is_err());
        account.skin_url = Some("http://textures.minecraft.net/texture/abc".into());
        assert!(
            account.validate().is_err(),
            "stored metadata still requires HTTPS"
        );
        account.skin_url = None;
        account.id = "../outside".into();
        assert!(account.validate().is_err());
    }
}
