//! Validate public profile fields and normalize official skin URLs to HTTPS.
use super::*;

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

pub(super) fn account_from_profile(profile: &Value) -> Result<Account> {
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

pub(super) fn normalize_profile_skin_url(raw: &str) -> Result<String> {
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
