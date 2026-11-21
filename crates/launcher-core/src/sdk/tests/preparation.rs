// SDK preparation behavior regressions; included in sdk::tests.
#[tokio::test(flavor = "multi_thread")]
async fn vanilla_prepare_accepts_valid_local_files_and_creates_natives_inside_instance() {
    use elemental::core::storage::layout::Layoutable;
    use sha1::{Digest, Sha1};
    use std::io::Write;

    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap().join("minecraft");
    let profile = GameProfile::new("Vanilla", "1.21.1").unwrap();
    let paths = crate::loaders::InstallationPaths::new(&root, &profile.instance_key).unwrap();
    let instance = Storage::with_parent(
        paths.instance.clone(),
        Storage::new(&root, SharedRootLayout::default()),
        SharedInstanceLayout::default(),
    );
    let mut metadata = vanilla_metadata(&profile);
    metadata.metadata.downloads.client.sha1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709".into();
    let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for name in ["jtracy.dll", "java/lwjgl.dll", "platform/vendor/audio.dll"] {
        archive
            .start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(name.as_bytes()).unwrap();
    }
    let archive = archive.finish().unwrap().into_inner();
    let platform = elemental::driver::families::version_json::VersionJsonPlatform::current();
    let artifact_path = format!(
        "org/example/native/1/native-1-natives-{}.jar",
        platform.native_os_names()[0]
    );
    let library = root.join("libraries").join(&artifact_path);
    std::fs::create_dir_all(library.parent().unwrap()).unwrap();
    std::fs::write(&library, &archive).unwrap();
    metadata.metadata.libraries = serde_json::from_value(serde_json::json!([{
        "name": format!("org.example:native:1:natives-{}", platform.native_os_names()[0]),
        "downloads": {"artifact": {"path": artifact_path,
            "sha1": hex::encode(Sha1::digest(&archive)), "size": archive.len(),
            "url": format!("https://libraries.minecraft.net/{artifact_path}")}}
    }]))
    .unwrap();
    persist_vanilla_metadata(metadata, &profile, &paths, &instance)
        .await
        .unwrap();
    std::fs::write(
        paths.instance.join(format!("{}.jar", profile.instance_key)),
        b"",
    )
    .unwrap();
    let mut settings = Settings {
        game_directory: root,
        ..Settings::default()
    };
    settings.network.proxy_url = "http://127.0.0.1:1".into();
    settings.network.timeout_seconds = 1;
    let service = ElementalService::new(&settings).unwrap();
    let prepared = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        service.prepare_with_progress(&profile, CancellationToken::new(), |_| {}),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        prepared.canonicalize().unwrap(),
        paths.instance.canonicalize().unwrap()
    );
    let natives = java_compatible_path(
        &instance
            .try_get_resource(
                elemental::driver::families::version_json::VersionJsonInstanceResource::Natives,
            )
            .unwrap(),
    );
    assert!(natives.is_dir());
    assert!(natives.starts_with(&prepared));
    for name in ["jtracy.dll", "java/lwjgl.dll", "platform/vendor/audio.dll"] {
        assert_eq!(std::fs::read(natives.join(name)).unwrap(), name.as_bytes());
    }
    let inspected = service
        .launcher
        .inspect_instance(profile.instance_key.clone())
        .await
        .unwrap()
        .unwrap();
    let loaded = service.launcher.load_instance(inspected).await.unwrap();
    let info = loaded.info().unwrap();
    assert_eq!(info.natives_directory, natives);
    let mut command = launch_command(
        vec![format!(
            "-Djava.library.path={}",
            natives.join("java").display()
        )],
        vec![],
    )
    .await;
    // Exercise the real SDK command builder as well as the application's
    // native-directory adjustment. Native JAR artifacts must stay on -cp.
    let credential = OfflineAccount::new("Player".into())
        .credential()
        .await
        .unwrap();
    let options = elemental::launcher::RuntimeOptions::new()
        .set_runtime_override(command.runtime.clone());
    let mut built = service
        .launcher
        .build_launch_command(&loaded, &credential, &options, &LaunchOptions::default())
        .await
        .unwrap();
    include_extracted_natives(&mut built, &info.natives_directory, &info.natives_files)
        .unwrap();
    let classpath_argument = built
        .jvm_arguments
        .windows(2)
        .find(|arguments| arguments[0] == "-cp")
        .unwrap();
    let classpath = std::env::split_paths(&classpath_argument[1]).collect::<Vec<_>>();
    assert!(classpath.contains(&java_compatible_path(&library)));
    assert!(classpath.contains(&java_compatible_path(
        &paths.instance.join(format!("{}.jar", profile.instance_key))
    )));
    assert_eq!(built.main_class, "example.Main");
    assert_eq!(built.program(), command.program());
    include_extracted_natives(&mut command, &info.natives_directory, &info.natives_files)
        .unwrap();
    let roots: Vec<_> = std::env::split_paths(
        command.jvm_arguments[0].trim_start_matches("-Djava.library.path="),
    )
    .collect();
    assert!(roots.contains(&natives));
    assert!(roots.contains(&natives.join("java")));
    assert!(roots.contains(&natives.join("platform/vendor")));
    assert!(prepared.join(".elemental").is_dir());
}
