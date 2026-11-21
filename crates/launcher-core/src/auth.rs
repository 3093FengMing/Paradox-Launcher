//! Microsoft device-code authentication; secret carriers stay inside Rust services.
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Result, bail, ensure};
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

mod minecraft;
mod oauth;
mod profile;
mod response;
mod types;

use profile::account_from_profile;
use response::read_response;
#[cfg(test)]
pub(crate) use types::test_device_grant;
pub use types::{Account, DeviceGrant, GameSession, LoginPrompt, OAuthTokens};

const DEVICE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";

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

#[cfg(test)]
mod tests;
