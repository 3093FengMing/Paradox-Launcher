use anyhow::{Context, Result, ensure};
use elemental::{
    core::runtime::{
        RuntimeValidationMode,
        distribution::{Distribution, DistributionReleaseData},
    },
    launcher::RuntimeOptions,
};

use crate::{java::JavaInstallation, sdk::java_compatible_path};

/// Adapt a validated Java installation to upstream runtime options.
/// Distribution describes the installation root; callers retain the selected
/// executable separately when the application creates the game process.
pub async fn elemental_runtime_options(
    installation: &JavaInstallation,
    required_major: u32,
) -> Result<RuntimeOptions> {
    ensure!(
        installation.major_version == required_major,
        "Java 版本与实例要求不一致"
    );
    ensure!(
        crate::java::matches_current_architecture(&installation.architecture),
        "Java 架构与启动器不一致"
    );
    // These properties came from the application's owned probe. Import them
    // directly, avoiding a second SDK subprocess for no-release installations.
    let release = DistributionReleaseData {
        implementor: Some(installation.vendor.clone()),
        architecture: Some(installation.architecture.clone()),
        major_version: Some(installation.major_version.to_string()),
        jre_version: Some(installation.version.clone()),
        jvm_version: None,
    };
    let distribution = Distribution::from_validated_root(
        java_compatible_path(&installation.java_home),
        release,
        "Paradox owned probe",
    )
    .await
    .context("SDK 无法验证所选 Java 安装目录")?;
    distribution.require_compatible(required_major as usize, RuntimeValidationMode::Strict)?;
    Ok(RuntimeOptions::new().set_runtime_override(distribution))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn selected_wrapper_is_separate_from_upstream_installation_distribution() {
        let temporary = tempfile::tempdir().unwrap();
        let home = temporary.path().join("Java 中文 home");
        std::fs::create_dir_all(home.join("bin")).unwrap();
        std::fs::write(
            home.join("bin")
                .join(format!("java{}", std::env::consts::EXE_SUFFIX)),
            b"release metadata supplies the runtime version",
        )
        .unwrap();
        std::fs::write(
            home.join("release"),
            b"JAVA_VERSION=\"21.0.12\"\nOS_ARCH=\"amd64\"\n",
        )
        .unwrap();
        let installation = JavaInstallation {
            executable: temporary.path().join("wrapper/javaw.exe"),
            java_home: home.clone(),
            major_version: 21,
            version: "21.0.12".into(),
            vendor: "fixture".into(),
            architecture: std::env::consts::ARCH.into(),
            source: "manual".into(),
        };
        let options = elemental_runtime_options(&installation, 21).await.unwrap();
        let distribution = options.runtime_override.unwrap();
        assert_eq!(distribution.path(), home.canonicalize().unwrap());
        assert_eq!(distribution.java_major_version(), Some(21));
        assert_ne!(distribution.executable(), installation.executable);
        assert!(elemental_runtime_options(&installation, 17).await.is_err());
        std::fs::write(home.join("release"), b"JAVA_VERSION=\"17.0.1\"\n").unwrap();
        assert!(elemental_runtime_options(&installation, 21).await.is_ok());
        // Even with no release and a deliberately invalid default executable,
        // adaptation imports the owned probe data without starting another JVM.
        std::fs::remove_file(home.join("release")).unwrap();
        let options = elemental_runtime_options(&installation, 21).await.unwrap();
        assert_eq!(
            options.runtime_override.unwrap().java_major_version(),
            Some(21)
        );
        assert!(!home.join("release").exists());
    }
}
