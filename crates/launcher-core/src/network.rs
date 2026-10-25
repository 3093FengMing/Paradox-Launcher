use std::time::Duration;

use anyhow::{Context, Result, ensure};
use elemental::driver::drivers::vanilla::source::VanillaEndpoints;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct NetworkOptions {
    pub timeout_seconds: u32,
    pub max_concurrent_downloads: u32,
    pub max_retries: u32,
    pub proxy_url: String,
    /// A Mojang-compatible mirror base, with assets/ and maven/ subpaths.
    pub mirror_url: String,
}

impl Default for NetworkOptions {
    fn default() -> Self {
        Self {
            timeout_seconds: 30,
            max_concurrent_downloads: 8,
            max_retries: 3,
            proxy_url: String::new(),
            mirror_url: String::new(),
        }
    }
}

impl NetworkOptions {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            (1..=300).contains(&self.timeout_seconds),
            "网络超时应在 1–300 秒之间"
        );
        ensure!(
            (1..=32).contains(&self.max_concurrent_downloads),
            "同时下载数应在 1–32 之间"
        );
        ensure!(self.max_retries <= 8, "重试次数应在 0–8 之间");
        if !self.proxy_url.trim().is_empty() {
            validate_http_url(self.proxy_url.trim(), "代理", true)?;
        }
        if !self.mirror_url.trim().is_empty() {
            validate_http_url(self.mirror_url.trim(), "镜像", false)?;
        }
        Ok(())
    }

    /// Bound stalled connections and reads, without limiting a large file's
    /// total download time. Metadata requests can add their own total timeout.
    pub fn build_client(&self) -> Result<Client> {
        self.validate()?;
        let timeout = Duration::from_secs(self.timeout_seconds.into());
        let mut builder = Client::builder()
            .connect_timeout(timeout)
            .read_timeout(timeout)
            .user_agent(format!("ParadoxLauncher/{}", env!("CARGO_PKG_VERSION")));
        if !self.proxy_url.trim().is_empty() {
            builder = builder
                .proxy(reqwest::Proxy::all(self.proxy_url.trim()).context("无法配置网络代理")?);
        }
        builder.build().context("无法创建网络客户端")
    }

    pub fn endpoints(&self) -> Result<VanillaEndpoints> {
        self.validate()?;
        let mirror = self.mirror_url.trim().trim_end_matches('/');
        if mirror.is_empty() {
            return Ok(VanillaEndpoints::official());
        }
        VanillaEndpoints::mirror(
            mirror.into(),
            mirror.into(),
            mirror.into(),
            format!("{mirror}/assets"),
            format!("{mirror}/maven"),
        )
        .context("无法配置原版镜像端点")
    }
}

fn validate_http_url(raw: &str, label: &str, allow_credentials: bool) -> Result<()> {
    // Do not include a proxy URL in errors: it may contain credentials.
    let parsed = Url::parse(raw).with_context(|| format!("{label}地址格式无效"))?;
    ensure!(
        matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some(),
        "{label}地址必须使用 http:// 或 https://"
    );
    ensure!(
        parsed.query().is_none() && parsed.fragment().is_none(),
        "{label}地址不能包含查询参数或片段"
    );
    ensure!(
        allow_credentials || (parsed.username().is_empty() && parsed.password().is_none()),
        "镜像地址不能包含用户名或密码"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_network_options_are_rejected() {
        for proxy in ["file:///tmp/proxy", "socks5://localhost:1080", "not a url"] {
            assert!(
                NetworkOptions {
                    proxy_url: proxy.into(),
                    ..NetworkOptions::default()
                }
                .validate()
                .is_err()
            );
        }
        for mirror in [
            "https://mirror.invalid/?token=secret",
            "https://user:secret@mirror.invalid",
            "https://mirror.invalid/#fragment",
        ] {
            assert!(
                NetworkOptions {
                    mirror_url: mirror.into(),
                    ..NetworkOptions::default()
                }
                .validate()
                .is_err()
            );
        }
        assert!(NetworkOptions::default().validate().is_ok());
    }

    #[test]
    fn mirrors_keep_their_base_path_and_map_artifacts() {
        let endpoints = NetworkOptions {
            mirror_url: "https://mirror.invalid/api/".into(),
            ..NetworkOptions::default()
        }
        .endpoints()
        .unwrap();
        assert_eq!(
            endpoints.version_manifest_url().unwrap(),
            "https://mirror.invalid/api/mc/game/version_manifest_v2.json"
        );
        assert_eq!(
            endpoints.object_url("abcdef").unwrap(),
            "https://mirror.invalid/api/assets/ab/abcdef"
        );
        assert_eq!(
            endpoints
                .rewrite_upstream("https://libraries.minecraft.net/org/example.jar")
                .unwrap(),
            "https://mirror.invalid/api/maven/org/example.jar"
        );
    }
}
