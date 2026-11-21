//! Validate installed identity and assemble a command before creating a game process.
use super::*;

impl ElementalService {
    /// Reopen the installed instance. Launch does not implicitly download files.
    pub async fn launch(&self, profile: &GameProfile, settings: &Settings) -> Result<LoggedChild> {
        self.launch_with_runtime_directory(
            profile,
            settings,
            &crate::model::default_data_directory().join("runtimes"),
        )
        .await
    }

    pub async fn launch_with_runtime_directory(
        &self,
        profile: &GameProfile,
        settings: &Settings,
        managed_runtime_root: &Path,
    ) -> Result<LoggedChild> {
        self.launch_authenticated(profile, settings, managed_runtime_root, None)
            .await
    }

    pub async fn launch_authenticated(
        &self,
        profile: &GameProfile,
        settings: &Settings,
        managed_runtime_root: &Path,
        credential: Option<Credential>,
    ) -> Result<LoggedChild> {
        self.prepare_authenticated_launch(profile, settings, managed_runtime_root, credential)
            .await?
            .spawn()
    }

    /// Inspect an installed instance and prepare its command without spawning the game.
    /// Java probes are owned by this future; cancelling it cannot create a game process.
    pub async fn prepare_authenticated_launch(
        &self,
        profile: &GameProfile,
        settings: &Settings,
        managed_runtime_root: &Path,
        credential: Option<Credential>,
    ) -> Result<PreparedGameLaunch> {
        profile.validate()?;
        settings.validate()?;
        let instance = self
            .launcher
            .inspect_instance(profile.instance_key.clone())
            .await?
            .context("实例尚未安装，请先安装 / 修复")?;
        ensure!(
            instance.driver.driver.id == profile.loader
                && instance
                    .driver
                    .game_version
                    .as_ref()
                    .map(|version| version.as_str())
                    == Some(profile.game_version.as_str())
                && (profile.loader == "vanilla"
                    || installed_loader_version(&instance.driver).as_deref()
                        == Some(profile.loader_version.as_str())),
            "loaders.errors.identity"
        );
        let required_java = java::required_java_major_version(
            &settings
                .game_directory
                .join("versions")
                .join(&profile.instance_key),
        )?;
        let runtime = java::select_runtime(
            required_java,
            (!settings.java_executable.trim().is_empty())
                .then(|| std::path::Path::new(settings.java_executable.trim())),
            managed_runtime_root,
        )
        .await?;
        let prepared = self
            .launcher
            .load_instance(instance)
            .await
            .context("实例不完整，请安装 / 修复后重试")?;
        let mut options = LaunchOptions {
            launcher_name: Some("Paradox Launcher".into()),
            launcher_version: Some(env!("CARGO_PKG_VERSION").into()),
            resolution: Some(LaunchResolution::new(
                settings.resolution_width.to_string(),
                settings.resolution_height.to_string(),
            )),
            ..LaunchOptions::default()
        };
        options = options.set_extra_jvm_arguments(
            parse_argument_string(&settings.extra_jvm_arguments).context("JVM 参数引号不匹配")?,
        );
        ensure!(
            !options
                .extra_jvm_arguments
                .iter()
                .any(|argument| argument.starts_with("-Xmx") || argument.starts_with("-Xms")),
            "请通过内存设置调整 -Xmx / -Xms"
        );
        options
            .extra_jvm_arguments
            .push(format!("-Xms{}M", settings.minimum_memory_mb));
        options
            .extra_jvm_arguments
            .push(format!("-Xmx{}M", settings.memory_mb));
        options = options.set_extra_game_arguments(
            parse_argument_string(&settings.extra_game_arguments).context("游戏参数引号不匹配")?,
        );
        let runtime_options =
            crate::runtime::elemental_runtime_options(&runtime, required_java).await?;
        let credential = LaunchIdentity {
            credential,
            username: settings.offline_username.clone(),
        }
        .authorize()
        .await
        .context("无法获取启动身份凭据")?;
        let mut command = self
            .launcher
            .build_launch_command(&prepared, &credential, &runtime_options, &options)
            .await
            .context("无法构建启动命令，请检查 Java 版本和实例文件")?;
        let prepared_info = prepared.info().context("无法读取实例原生库布局")?;
        include_extracted_natives(
            &mut command,
            &prepared_info.natives_directory,
            &prepared_info.natives_files,
        )?;
        include_profile_environment(&mut command, settings, profile);
        Ok(PreparedGameLaunch {
            command,
            executable: runtime.executable,
        })
    }
}
