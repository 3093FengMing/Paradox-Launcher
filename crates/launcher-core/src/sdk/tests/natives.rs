// SDK natives behavior regressions; included in sdk::tests.
#[tokio::test]
async fn extracted_natives_preserve_jvm_argument_order_and_game_arguments() {
    let metadata_natives = PathBuf::from("metadata-natives");
    let extracted_natives = PathBuf::from("extracted-natives");
    let metadata_path = std::env::join_paths([&metadata_natives]).unwrap();
    let mut command = launch_command(
        vec![
            format!("-Djava.library.path={}", metadata_path.to_str().unwrap()),
            "-Xmx1024M".into(),
        ],
        vec![
            "-Djava.library.path=game-option".into(),
            "--username".into(),
            "Player".into(),
        ],
    )
    .await
    .with_cwd(PathBuf::from("fixture-instance"))
    .with_env("SDK_ENV".into(), "retained".into());
    let program = command.program();
    include_extracted_natives(&mut command, &extracted_natives, &[]).unwrap();
    include_extracted_natives(&mut command, &extracted_natives, &[]).unwrap();
    let expected_path = std::env::join_paths([&metadata_natives, &extracted_natives]).unwrap();
    assert_eq!(
        command.arguments(),
        vec![
            format!("-Djava.library.path={}", expected_path.to_str().unwrap()),
            "-Xmx1024M".into(),
            "example.Main".into(),
            "-Djava.library.path=game-option".into(),
            "--username".into(),
            "Player".into(),
        ]
    );
    assert_eq!(command.program(), program);
    assert_eq!(command.cwd, Some(PathBuf::from("fixture-instance")));
    assert_eq!(
        command.env.get("SDK_ENV").map(String::as_str),
        Some("retained")
    );
}

#[tokio::test]
async fn extracted_natives_do_not_reinterpret_game_arguments_as_jvm_arguments() {
    let mut command = launch_command(
        vec!["-Xmx1024M".into()],
        vec!["-Djava.library.path=game-option".into()],
    )
    .await;
    include_extracted_natives(&mut command, Path::new("extracted-natives"), &[]).unwrap();
    assert_eq!(
        command.arguments(),
        vec![
            "-Xmx1024M".to_owned(),
            "example.Main".to_owned(),
            "-Djava.library.path=game-option".to_owned(),
        ]
    );
}

#[tokio::test]
async fn natives_search_path_uses_actual_root_and_nested_files_in_last_jvm_property() {
    let temporary = tempfile::tempdir().unwrap();
    let natives = temporary.path().join("upstream natives");
    let java = natives.join("java");
    let nested = natives.join("platform/vendor");
    std::fs::create_dir_all(&java).unwrap();
    std::fs::create_dir_all(&nested).unwrap();
    let files = vec![
        natives.join("jtracy.dll"),
        java.join("lwjgl.dll"),
        nested.join("audio.dll"),
    ];
    for file in &files {
        std::fs::write(file, b"native fixture").unwrap();
    }
    let initial = std::env::join_paths([&java]).unwrap();
    let mut command = launch_command(
        vec![
            "-Djava.library.path=earlier-option".into(),
            format!("-Djava.library.path={}", initial.to_string_lossy()),
            "-Xmx2048M".into(),
        ],
        vec!["--version".into(), "26.3".into()],
    )
    .await;
    include_extracted_natives(&mut command, &natives, &files).unwrap();
    include_extracted_natives(&mut command, &natives, &files).unwrap();
    let roots: Vec<_> = std::env::split_paths(
        command.jvm_arguments[1].trim_start_matches("-Djava.library.path="),
    )
    .collect();
    assert_eq!(roots[0], java);
    for file in files {
        assert!(roots.contains(&file.parent().unwrap().to_owned()));
    }
    assert_eq!(roots.len(), 3);
    assert_eq!(
        command.jvm_arguments[0],
        "-Djava.library.path=earlier-option"
    );
    assert_eq!(command.jvm_arguments[2], "-Xmx2048M");
    assert_eq!(command.game_arguments, ["--version", "26.3"]);
}
