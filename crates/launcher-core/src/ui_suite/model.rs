//! Persisted types. Manifest/selector values are checked strictly by validation.
use serde::{Deserialize, Deserializer, Serialize, de::Error};
use serde_json::Value;
use std::collections::BTreeMap;

pub const MAX_SAFE: u64 = 9_007_199_254_740_991;
pub const SOURCE: usize = 1_048_576;
pub const ASSET: usize = 8_388_608;
pub const FILES: usize = 512;
pub const MANIFEST: usize = 65_536;
pub const TOTAL: usize = 33_554_432;
pub const LIBRARY: usize = 134_217_728;

fn integer<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    let v = Value::deserialize(d)?;
    let n = v
        .as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= MAX_SAFE as f64)
        .ok_or_else(|| D::Error::custom("Invalid suite integer"))?;
    Ok(n as u64)
}
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct UiSuiteLibrary {
    pub kind: String,
    #[serde(deserialize_with = "integer")]
    pub schema_version: u64,
    #[serde(deserialize_with = "integer")]
    pub revision: u64,
    #[serde(deserialize_with = "nullable")]
    pub active_suite_id: Option<String>,
    pub suites: Vec<UiSuiteRecord>,
}
impl Default for UiSuiteLibrary {
    fn default() -> Self {
        Self {
            kind: "paradox-ui-suite-library".into(),
            schema_version: 1,
            revision: 0,
            active_suite_id: None,
            suites: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct UiSuiteRecord {
    pub instance_id: String,
    pub manifest: Value,
    #[serde(deserialize_with = "nullable")]
    pub parent_snapshot: Option<ParentSnapshot>,
    pub overlay: BTreeMap<String, UiFile>,
    pub deleted: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ParentSnapshot {
    pub digest: String,
    pub bundle: UiSuiteBundle,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct UiSuiteBundle {
    pub manifest: Value,
    pub files: BTreeMap<String, UiFile>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "encoding", deny_unknown_fields)]
pub enum UiFile {
    #[serde(rename = "utf8")]
    Utf8 { text: String },
    #[serde(rename = "base64")]
    Base64 { media_type: String, data: String },
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RecoveryToken {
    Missing,
    Raw { sha256: String },
}
impl<'de> Deserialize<'de> for RecoveryToken {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(d)?;
        let o = value
            .as_object()
            .ok_or_else(|| D::Error::custom("Invalid recovery token"))?;
        match o.get("kind").and_then(Value::as_str) {
            Some("missing") if o.len() == 1 => Ok(Self::Missing),
            Some("raw") if o.len() == 2 => {
                let hash = o
                    .get("sha256")
                    .and_then(Value::as_str)
                    .filter(|s| {
                        s.len() == 64
                            && s.bytes()
                                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    })
                    .ok_or_else(|| D::Error::custom("Invalid recovery hash"))?;
                Ok(Self::Raw {
                    sha256: hash.into(),
                })
            }
            _ => Err(D::Error::custom("Invalid recovery token fields")),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryInspection {
    pub raw: Vec<u8>,
    pub token: RecoveryToken,
}
