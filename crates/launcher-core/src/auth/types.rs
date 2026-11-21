//! Public account metadata and private secret-bearing OAuth/session carriers.
use super::*;

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
    pub(super) client_id: String,
    pub(super) device_code: String,
    pub(super) interval: u64,
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

pub struct GameSession {
    pub account: Account,
    pub access_token: String,
    pub expires_at: u64,
}
