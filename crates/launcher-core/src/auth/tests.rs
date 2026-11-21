//! Public profile compatibility and service-secret sanitization regressions.
use super::response::service_error;
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
