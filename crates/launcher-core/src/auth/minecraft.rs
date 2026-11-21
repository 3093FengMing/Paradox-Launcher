//! Xbox/XSTS exchange, Minecraft entitlements and account profile authorization.
use super::*;

impl MicrosoftAuth {
    pub async fn game_session(&self, access_token: &str) -> Result<GameSession> {
        let xbox_token = self.xbox_token(access_token).await?;
        let xsts = self.xsts_token(&xbox_token).await?;
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
        validate_entitlement(&entitlement)?;
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

    async fn xbox_token(&self, access_token: &str) -> Result<String> {
        let xbox: Value = read_response(
            self.client
                .post("https://user.auth.xboxlive.com/user/authenticate")
                .json(&json!({
                    "Properties": {
                        "AuthMethod": "RPS",
                        "SiteName": "user.auth.xboxlive.com",
                        "RpsTicket": format!("d={access_token}"),
                    },
                    "RelyingParty": "http://auth.xboxlive.com",
                    "TokenType": "JWT",
                })),
        )
        .await?;
        Ok(required_string(&xbox, "/Token")?.into())
    }

    async fn xsts_token(&self, xbox_token: &str) -> Result<Value> {
        read_response(
            self.client
                .post("https://xsts.auth.xboxlive.com/xsts/authorize")
                .json(&json!({
                    "Properties": {"SandboxId": "RETAIL", "UserTokens": [xbox_token]},
                    "RelyingParty": "rp://api.minecraftservices.com/",
                    "TokenType": "JWT",
                })),
        )
        .await
    }
}

fn validate_entitlement(entitlement: &Value) -> Result<()> {
    let items = entitlement["items"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("auth.errors.noEntitlement"))?;
    ensure!(
        items.iter().any(|item| matches!(
            item["name"].as_str(),
            Some("game_minecraft" | "product_minecraft")
        )),
        "auth.errors.noEntitlement"
    );
    Ok(())
}
