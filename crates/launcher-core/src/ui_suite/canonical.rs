//! Canonical scalar-key JSON and the shared length-framed original-byte digest.
use super::model::{MAX_SAFE, UiFile, UiSuiteBundle};
use anyhow::{Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
pub fn bytes(file: &UiFile) -> Result<Vec<u8>> {
    match file {
        UiFile::Utf8 { text } => Ok(text.as_bytes().to_vec()),
        UiFile::Base64 { data, .. } => {
            let raw = STANDARD.decode(data)?;
            ensure!(STANDARD.encode(&raw) == *data, "Invalid suite base64");
            Ok(raw)
        }
    }
}
pub fn canonical<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let value = serde_json::to_value(value)?;
    let mut out = Vec::new();
    emit(&value, &mut out)?;
    Ok(out)
}
fn emit(v: &Value, out: &mut Vec<u8>) -> Result<()> {
    match v {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(b) => out.extend_from_slice(if *b { b"true" } else { b"false" }),
        Value::Number(n) => {
            let n = n
                .as_f64()
                .ok_or_else(|| anyhow::anyhow!("Invalid suite number"))?;
            ensure!(
                n.is_finite() && n.fract() == 0.0 && n.abs() <= MAX_SAFE as f64,
                "Invalid suite number"
            );
            out.extend_from_slice((n as i64).to_string().as_bytes());
        }
        Value::String(s) => out.extend_from_slice(serde_json::to_string(s)?.as_bytes()),
        Value::Array(a) => {
            out.push(b'[');
            for (i, v) in a.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                emit(v, out)?;
            }
            out.push(b']');
        }
        Value::Object(o) => {
            out.push(b'{');
            let mut keys: Vec<_> = o.keys().collect();
            keys.sort(); // UTF-8 lexical order is Unicode scalar order.
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                out.extend_from_slice(serde_json::to_string(k)?.as_bytes());
                out.push(b':');
                emit(&o[*k], out)?;
            }
            out.push(b'}');
        }
    }
    Ok(())
}
pub fn digest(bundle: &UiSuiteBundle) -> Result<String> {
    let mut hash = Sha256::new();
    hash.update(b"PARADOX-UI-BUNDLE\0\x01");
    fn append(hash: &mut Sha256, bytes: &[u8]) {
        hash.update((bytes.len() as u32).to_be_bytes());
        hash.update(bytes);
    }
    append(&mut hash, &canonical(&bundle.manifest)?);
    hash.update((bundle.files.len() as u32).to_be_bytes());
    for (path, file) in &bundle.files {
        append(&mut hash, path.as_bytes());
        append(&mut hash, &bytes(file)?);
    }
    Ok(hex::encode(hash.finalize()))
}
