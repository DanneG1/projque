use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{de::DeserializeOwned, Serialize};

use crate::error::AppError;

pub const SUPPORTED_CONFIG_VERSION: u32 = 1;

/// Health of a config file on disk, reported to the UI via `app_config_status`.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FileState {
    Ok,
    Missing,
    Recovered { backup_path: String },
    LockedNewerVersion { found: u32 },
}

/// Load a config file, recovering from corruption without data loss:
/// - missing file -> defaults; nothing is written until the first user mutation,
///   so a read-only launch leaves no trace on disk
/// - unparseable file -> renamed to a timestamped `.bak` (the rename IS the
///   backup, and frees the canonical path), defaults returned
/// - `configVersion` newer than this build supports -> parsed best-effort,
///   but all writes are refused so an old build never downgrades a newer config
pub fn load_or_recover<T: DeserializeOwned + Default>(path: &Path) -> (T, FileState) {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return (T::default(), FileState::Missing),
    };
    let value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return (T::default(), back_up_invalid(path)),
    };
    let version = value.get("configVersion").and_then(|v| v.as_u64());
    let parsed = match serde_json::from_value::<T>(value) {
        Ok(p) => p,
        Err(_) => return (T::default(), back_up_invalid(path)),
    };
    match version {
        Some(found) if found > u64::from(SUPPORTED_CONFIG_VERSION) => {
            (parsed, FileState::LockedNewerVersion { found: found as u32 })
        }
        _ => (parsed, FileState::Ok),
    }
}

fn back_up_invalid(path: &Path) -> FileState {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup = path.with_extension(format!("json.invalid-{ts}.bak"));
    match fs::rename(path, &backup) {
        Ok(()) => FileState::Recovered {
            backup_path: backup.display().to_string(),
        },
        Err(e) => FileState::Recovered {
            backup_path: format!("(backup failed: {e})"),
        },
    }
}

/// Atomic write: pretty JSON to a `.tmp` in the same directory, then rename.
/// No torn files on crash or power loss.
pub fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let file = path
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::ConfigWrite { file: file.clone(), detail: e.to_string() })?;
    let payload = json + "\n";
    let write = || -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, payload.as_bytes())?;
        fs::rename(&tmp, path)
    };
    write().map_err(|e| AppError::ConfigWrite { file, detail: e.to_string() })
}
