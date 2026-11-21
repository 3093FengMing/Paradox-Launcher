// SDK identity behavior regressions; included in sdk::tests.
#[tokio::test]
async fn launch_identity_preserves_supplied_online_credentials() {
    let credential = Credential {
        username: "OnlinePlayer".into(),
        uuid: "12345678-1234-1234-1234-123456789abc".into(),
        access_token: "fixture-access-token".into(),
        kind: elemental::core::auth::credential::CredentialKind::Msa,
        xuid: Some("fixture-xuid".into()),
        client_id: Some("fixture-client-id".into()),
    };
    let authorized = LaunchIdentity {
        credential: Some(credential.clone()),
        username: "OfflinePlayer".into(),
    }
    .authorize()
    .await
    .unwrap();
    assert_eq!(authorized, credential);
}

#[tokio::test]
async fn launch_identity_uses_the_minecraft_offline_uuid_and_empty_token() {
    let authorized = LaunchIdentity {
        credential: None,
        username: "Player".into(),
    }
    .authorize()
    .await
    .unwrap();
    assert_eq!(authorized.username, "Player");
    assert_eq!(authorized.uuid, "a01e3843-e521-3998-958a-f459800e4d11");
    assert!(authorized.access_token.is_empty());
}

async fn launch_command(
    jvm_arguments: Vec<String>,
    game_arguments: Vec<String>,
) -> LaunchCommand {
    let temporary = tempfile::tempdir().unwrap();
    let home = temporary.path().join("fixture-java");
    std::fs::create_dir_all(home.join("bin")).unwrap();
    std::fs::write(
        home.join("bin")
            .join(format!("java{}", std::env::consts::EXE_SUFFIX)),
        b"fixture",
    )
    .unwrap();
    std::fs::write(home.join("release"), b"JAVA_VERSION=\"21.0.1\"\n").unwrap();
    let provider =
        elemental::core::runtime::providers::custom::CustomProvider::new(vec![home]).unwrap();
    let distribution =
        elemental::core::runtime::RuntimeResolver::new(vec![std::sync::Arc::new(provider)])
            .resolve(21)
            .await
            .unwrap();
    LaunchCommand::new(
        distribution,
        jvm_arguments,
        "example.Main".into(),
        game_arguments,
    )
}
