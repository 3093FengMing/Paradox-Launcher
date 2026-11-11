use super::catalog::fetch_resource;
use async_trait::async_trait;
use elemental::{
    core::minecraft::MinecraftVersionId,
    driver::{
        driver::{DriverDescriptor, InstalledDriver},
        drivers::vanilla::source::VanillaSource,
        error::{Error, Result},
        families::version_json::{
            LoaderMetaEndpoints, LoaderMetaSource, ProfiledVersionJsonFamily,
        },
        inspect::ProfiledDriverIdentity,
        loader_version::LoaderVersionId,
    },
    schema::{fabric::ProfileJson, mojang::piston::PistonMetaData},
};
use std::time::Duration;

/// Keep upstream merge, repair and identity rules while bounding profile HTTP.
#[derive(Clone, Debug)]
pub(super) struct BoundedProfileFamily<F> {
    family: F,
    client: reqwest::Client,
    timeout: Duration,
}

impl<F> BoundedProfileFamily<F> {
    pub(super) fn new(family: F, client: reqwest::Client, timeout: Duration) -> Self {
        Self {
            family,
            client,
            timeout,
        }
    }
}

pub(super) trait ProfileResourceUrl {
    fn profile_url(&self, game: &str, loader: &str) -> Result<String>;
}

impl<E: LoaderMetaEndpoints> ProfileResourceUrl for LoaderMetaSource<E> {
    fn profile_url(&self, game: &str, loader: &str) -> Result<String> {
        self.endpoints().profile_json_url(game, loader)
    }
}

#[async_trait(?Send)]
impl<F> ProfiledVersionJsonFamily for BoundedProfileFamily<F>
where
    F: ProfiledVersionJsonFamily,
    F::Source: ProfileResourceUrl,
{
    type Source = F::Source;
    type RemoteResolver = F::RemoteResolver;

    fn descriptor(&self) -> DriverDescriptor {
        self.family.descriptor()
    }

    fn identity(&self) -> Option<ProfiledDriverIdentity> {
        self.family.identity()
    }

    fn default_source(&self) -> Result<Self::Source>
    where
        Self::Source: Default,
    {
        self.family.default_source()
    }

    fn remote_resolver(
        &self,
        vanilla_source: &VanillaSource,
        source: &Self::Source,
    ) -> Self::RemoteResolver {
        self.family.remote_resolver(vanilla_source, source)
    }

    async fn profile(
        &self,
        source: &Self::Source,
        game_version: &MinecraftVersionId,
        loader_version: &LoaderVersionId,
    ) -> Result<ProfileJson> {
        let url = source.profile_url(game_version.as_str(), loader_version.as_str())?;
        let bytes = fetch_resource(&self.client, &url, self.timeout)
            .await
            .map_err(|error| Error::Io(std::io::Error::other(error)))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    fn merge_profile(
        &self,
        base_metadata: PistonMetaData,
        profile: ProfileJson,
    ) -> Result<PistonMetaData> {
        self.family.merge_profile(base_metadata, profile)
    }

    fn local_metadata_needs_refresh(
        &self,
        metadata: &PistonMetaData,
        game_version: &MinecraftVersionId,
        loader_version: &LoaderVersionId,
    ) -> bool {
        self.family
            .local_metadata_needs_refresh(metadata, game_version, loader_version)
    }

    fn inspect_installed(&self, metadata: &PistonMetaData) -> Option<InstalledDriver> {
        self.family.inspect_installed(metadata)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use elemental::driver::drivers::{
        fabric::{
            driver::FabricDriverFamily,
            source::{FabricEndpoints, FabricFlavor, FabricOrigin, FabricSource},
        },
        quilt::{
            driver::QuiltDriverFamily,
            source::{QuiltEndpoints, QuiltOrigin, QuiltSource},
        },
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[tokio::test]
    async fn profiled_drivers_reject_oversized_profile_before_decoding() {
        for quilt in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let origin = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut connection, _) = listener.accept().await.unwrap();
                let mut request = [0; 4096];
                assert!(connection.read(&mut request).await.unwrap() > 0);
                connection
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 8388609\r\nConnection: close\r\n\r\n",
                    )
                    .await
                    .unwrap();
            });
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let game = MinecraftVersionId::from("1.21.1");
            let loader = LoaderVersionId::from("0.16.10");
            let result = if quilt {
                let family = BoundedProfileFamily::new(
                    QuiltDriverFamily,
                    client.clone(),
                    Duration::from_secs(5),
                );
                let source = QuiltSource::with_client(
                    QuiltEndpoints::with_overrides([(QuiltOrigin::Meta, origin)]).unwrap(),
                    client,
                );
                family.profile(&source, &game, &loader).await
            } else {
                let family = BoundedProfileFamily::new(
                    FabricDriverFamily::new(FabricFlavor::Fabric),
                    client.clone(),
                    Duration::from_secs(5),
                );
                let source = FabricSource::with_client(
                    FabricEndpoints::with_overrides([(FabricOrigin::Meta, origin)]).unwrap(),
                    client,
                );
                family.profile(&source, &game, &loader).await
            };
            assert_eq!(result.unwrap_err().to_string(), "loaders.errors.response");
            tokio::time::timeout(Duration::from_secs(5), server)
                .await
                .unwrap()
                .unwrap();
        }
    }
}
