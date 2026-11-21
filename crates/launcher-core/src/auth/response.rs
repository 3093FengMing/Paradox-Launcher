//! Bound decoded authentication responses and return sanitized service error keys.
use super::*;

pub(super) async fn read_response<T: DeserializeOwned>(request: RequestBuilder) -> Result<T> {
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

pub(super) fn service_error(value: &Value, status: u16) -> &'static str {
    match value["error"].as_str() {
        Some("authorization_pending") => "auth.errors.pending",
        Some("slow_down") => "auth.errors.slowDown",
        Some("authorization_declined" | "access_denied") => "auth.errors.denied",
        Some("expired_token") => "auth.errors.expired",
        Some("invalid_grant") => "auth.errors.loginRequired",
        Some("unauthorized_client" | "invalid_client") => "auth.errors.clientId",
        _ => xbox_service_error(value, status),
    }
}

fn xbox_service_error(value: &Value, status: u16) -> &'static str {
    match value["XErr"].as_u64() {
        Some(2148916233) => "auth.errors.noXboxProfile",
        Some(2148916235) => "auth.errors.region",
        Some(2148916236..=2148916238) => "auth.errors.family",
        _ if status == 404 => "auth.errors.noEntitlement",
        _ if status == 401 => "auth.errors.loginRequired",
        _ => "auth.errors.service",
    }
}
