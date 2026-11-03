use anyhow::{Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct Personalization {
    pub background_file: String,
    pub background_fit: String,
    pub font: String,
    pub startup_page: String,
    pub notifications: bool,
    pub retain_logs: bool,
    pub shortcuts: bool,
    pub launch_shortcut: String,
}
impl Default for Personalization {
    fn default() -> Self {
        Self {
            background_file: String::new(),
            background_fit: "cover".into(),
            font: "system".into(),
            startup_page: "home".into(),
            notifications: true,
            retain_logs: false,
            shortcuts: true,
            launch_shortcut: "Ctrl+Enter".into(),
        }
    }
}
impl Personalization {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.background_file.is_empty() || valid_image_id(&self.background_file),
            "content.errors.background"
        );
        ensure!(
            matches!(
                self.background_fit.as_str(),
                "cover" | "contain" | "stretch"
            ),
            "content.errors.background"
        );
        ensure!(
            matches!(
                self.font.as_str(),
                "system" | "yahei" | "arial" | "serif" | "monospace"
            ),
            "content.errors.preferences"
        );
        ensure!(
            valid_route_id(&self.startup_page),
            "content.errors.preferences"
        );
        ensure!(
            matches!(
                self.launch_shortcut.as_str(),
                "Ctrl+Enter" | "Ctrl+Shift+L" | "Alt+Enter"
            ),
            "content.errors.preferences"
        );
        Ok(())
    }
}
fn valid_route_id(value: &str) -> bool {
    matches!(
        value,
        "home" | "instances" | "downloads" | "accounts" | "settings" | "logs" | "content"
    ) || value.strip_prefix("custom.").is_some_and(|suffix| {
        (1..=64).contains(&suffix.len())
            && suffix.as_bytes()[0].is_ascii_lowercase()
            && suffix
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ArgumentTemplate {
    pub id: String,
    pub name: String,
    pub jvm: String,
    pub game: String,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
}
impl ArgumentTemplate {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            uuid::Uuid::parse_str(&self.id).is_ok()
                && (1..=48).contains(&self.name.chars().count())
                && !self.name.chars().any(char::is_control),
            "content.errors.templates"
        );
        for argument in [&self.jvm, &self.game] {
            ensure!(
                argument.len() <= 8192 && !argument.contains('\0'),
                "content.errors.templates"
            );
        }
        validate_environment(&self.environment)
    }
}
pub fn validate_environment(environment: &BTreeMap<String, String>) -> Result<()> {
    ensure!(environment.len() <= 64, "content.errors.environment");
    let mut keys = BTreeSet::new();
    for (key, value) in environment {
        ensure!(
            keys.insert(environment_key(key)),
            "content.errors.environment"
        );
        ensure!(
            !key.is_empty()
                && key.len() <= 128
                && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
                && !key.as_bytes()[0].is_ascii_digit()
                && value.len() <= 8192
                && !value.contains('\0'),
            "content.errors.environment"
        );
        ensure!(
            !matches!(
                key.to_ascii_uppercase().as_str(),
                "JAVA_TOOL_OPTIONS" | "JDK_JAVA_OPTIONS" | "_JAVA_OPTIONS"
            ),
            "content.errors.environment"
        );
    }
    Ok(())
}

fn environment_key(key: &str) -> String {
    if cfg!(windows) {
        key.to_ascii_uppercase()
    } else {
        key.to_owned()
    }
}

/// Keep one entry per OS environment key, preserving the spelling and value of the last layer.
pub(crate) fn merge_environment(
    target: &mut HashMap<String, String>,
    values: &BTreeMap<String, String>,
) {
    for (key, value) in values {
        let normalized = environment_key(key);
        target.retain(|existing, _| environment_key(existing) != normalized);
        target.insert(key.clone(), value.clone());
    }
}
fn valid_image_id(value: &str) -> bool {
    value
        .strip_suffix(".png")
        .is_some_and(|stem| stem.len() == 64 && stem.bytes().all(|b| b.is_ascii_hexdigit()))
}
pub fn background_directory(config: &Path) -> Result<PathBuf> {
    Ok(config
        .parent()
        .ok_or_else(|| anyhow::anyhow!("content.errors.background"))?
        .join("backgrounds"))
}
pub fn import_background(config: &Path, source: &Path) -> Result<String> {
    ensure!(
        source.is_absolute() && source.metadata()?.len() <= 16 * 1024 * 1024,
        "content.errors.background"
    );
    let bytes = fs::read(source)?;
    let reader = image::ImageReader::new(Cursor::new(&bytes)).with_guessed_format()?;
    let (width, height) = reader.into_dimensions()?;
    ensure!(
        width <= 8192 && height <= 8192 && u64::from(width) * u64::from(height) <= 32 * 1024 * 1024,
        "content.errors.background"
    );
    let image = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()?
        .decode()?;
    let mut output = Cursor::new(Vec::new());
    image.write_to(&mut output, image::ImageFormat::Png)?;
    let bytes = output.into_inner();
    ensure!(bytes.len() <= 16 * 1024 * 1024, "content.errors.background");
    let id = format!("{:x}.png", Sha256::digest(&bytes));
    let directory = background_directory(config)?;
    fs::create_dir_all(&directory)?;
    let mut temp = tempfile::NamedTempFile::new_in(&directory)?;
    std::io::Write::write_all(&mut temp, &bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(directory.join(&id))?;
    Ok(id)
}
pub fn background_data(config: &Path, id: &str) -> Result<String> {
    ensure!(valid_image_id(id), "content.errors.background");
    let directory = background_directory(config)?;
    let path = directory.join(id);
    ensure!(
        path.canonicalize()?.starts_with(directory.canonicalize()?)
            && path.metadata()?.len() <= 16 * 1024 * 1024,
        "content.errors.background"
    );
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(fs::read(path)?)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preferences_route_id_shared_fixture() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../ui/scripts/fixtures/route-ids.json"))
                .unwrap();
        for id in fixture["valid"].as_array().unwrap() {
            let preferences = Personalization {
                startup_page: id.as_str().unwrap().into(),
                ..Personalization::default()
            };
            assert!(preferences.validate().is_ok(), "valid route: {id}");
        }
        for id in fixture["invalid"].as_array().unwrap() {
            let preferences = Personalization {
                startup_page: id.as_str().unwrap().into(),
                ..Personalization::default()
            };
            assert!(preferences.validate().is_err(), "invalid route: {id}");
        }
    }
    #[test]
    fn environment_validation_matches_platform_key_identity() {
        let environment = BTreeMap::from([
            ("Path".into(), "template".into()),
            ("PATH".into(), "instance".into()),
        ]);
        assert_eq!(validate_environment(&environment).is_err(), cfg!(windows));
    }

    #[test]
    fn preferences_environment_and_images_reject_untrusted_values() {
        let mut preferences = Personalization::default();
        preferences.validate().unwrap();
        preferences.background_file = "../secret".into();
        assert!(preferences.validate().is_err());
        assert!(
            validate_environment(&BTreeMap::from([(
                "JAVA_TOOL_OPTIONS".into(),
                "-Xmx64M".into()
            )]))
            .is_err()
        );
        assert!(
            validate_environment(&BTreeMap::from([(
                "NORMAL_SETTING".into(),
                "some value".into()
            )]))
            .is_ok()
        );
        let temp = tempfile::tempdir().unwrap();
        assert!(background_data(&temp.path().join("config.json"), "../secret").is_err());
    }
    #[test]
    fn imported_background_is_copied_and_survives_removal_of_original() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.png");
        image::RgbaImage::new(16, 16).save(&source).unwrap();
        let config = temp.path().join("config.json");
        let id = import_background(&config, &source).unwrap();
        fs::remove_file(source).unwrap();
        assert!(
            background_data(&config, &id)
                .unwrap()
                .starts_with("data:image/png;base64,")
        );
    }
}
