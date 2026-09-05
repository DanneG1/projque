//! Local settings (`.env`) helper for people who will not open a dotfile:
//! compares `.env.example` (or `.env.sample` / `.env.template`) with `.env`,
//! reports which settings are still missing, and writes values into `.env`
//! only. Values are secrets by nature: they never leave this module except
//! masked, and are never logged.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;

const EXAMPLES: &[&str] = &[".env.example", ".env.sample", ".env.template", ".env.dist"];
const ENV_FILE: &str = ".env";
const MAX_VALUE: usize = 4096;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnvKey {
    pub key: String,
    /// Listed in the example file (i.e. the project expects it).
    pub expected: bool,
    /// Present with a non-empty value in .env.
    pub set: bool,
    /// First characters plus asterisks, or None when unset.
    pub masked: Option<String>,
    /// Comment line directly above the key in the example, if any.
    pub hint: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvStatus {
    pub example_file: Option<String>,
    pub has_env: bool,
    pub keys: Vec<EnvKey>,
    pub missing: u32,
    /// `.env` is matched by .gitignore (or there is no repository to leak into).
    pub ignored: bool,
}

fn parse(text: &str) -> Vec<(String, String, Option<String>)> {
    let mut out = Vec::new();
    let mut last_comment: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            last_comment = None;
            continue;
        }
        if let Some(c) = line.strip_prefix('#') {
            last_comment = Some(c.trim().to_string()).filter(|c| !c.is_empty());
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            if valid_key(key) {
                let value = unquote(v.trim());
                out.push((key.to_string(), value, last_comment.take()));
            }
        }
        last_comment = None;
    }
    out
}

fn unquote(v: &str) -> String {
    let v = v.split(" #").next().unwrap_or(v).trim();
    if v.len() >= 2 && ((v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\''))) {
        v[1..v.len() - 1].to_string()
    } else {
        v.to_string()
    }
}

pub fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn mask(value: &str) -> String {
    let shown: String = value.chars().take(2).collect();
    format!("{shown}{}", "•".repeat(value.chars().count().clamp(4, 12).saturating_sub(shown.chars().count())))
}

/// `.env` must be a plain file directly in the project (never a symlink
/// pointing elsewhere): we only ever write to this one path.
fn env_path(dir: &Path) -> Result<PathBuf, AppError> {
    let path = dir.join(ENV_FILE);
    if let Ok(meta) = std::fs::symlink_metadata(&path) {
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err(AppError::InvalidInput { detail: ".env is not a plain file".into() });
        }
    }
    Ok(path)
}

fn is_ignored(dir: &Path) -> bool {
    if !dir.join(".git").exists() {
        return true;
    }
    crate::git::runner::git(dir, &["check-ignore", "-q", ENV_FILE])
        .map(|o| o.success)
        .unwrap_or(false)
}

pub fn status(dir: &Path) -> Result<EnvStatus, AppError> {
    let example = EXAMPLES.iter().find(|f| dir.join(f).is_file());
    let expected = example
        .map(|f| std::fs::read_to_string(dir.join(f)).unwrap_or_default())
        .map(|t| parse(&t))
        .unwrap_or_default();
    let env_file = env_path(dir)?;
    let has_env = env_file.is_file();
    let actual = if has_env {
        parse(&std::fs::read_to_string(&env_file).unwrap_or_default())
    } else {
        Vec::new()
    };
    let mut keys: Vec<EnvKey> = Vec::new();
    for (key, _, hint) in &expected {
        let value = actual.iter().find(|(k, _, _)| k == key).map(|(_, v, _)| v.as_str()).unwrap_or("");
        keys.push(EnvKey {
            key: key.clone(),
            expected: true,
            set: !value.is_empty(),
            masked: (!value.is_empty()).then(|| mask(value)),
            hint: hint.clone(),
        });
    }
    for (key, value, _) in &actual {
        if !keys.iter().any(|k| &k.key == key) {
            keys.push(EnvKey {
                key: key.clone(),
                expected: false,
                set: !value.is_empty(),
                masked: (!value.is_empty()).then(|| mask(value)),
                hint: None,
            });
        }
    }
    let missing = keys.iter().filter(|k| k.expected && !k.set).count() as u32;
    Ok(EnvStatus {
        example_file: example.map(|s| s.to_string()),
        has_env,
        keys,
        missing,
        ignored: is_ignored(dir),
    })
}

/// Set (or clear, with an empty value) one key in `.env`, preserving every
/// other line. Creates the file when needed.
pub fn set(dir: &Path, key: &str, value: &str) -> Result<(), AppError> {
    if !valid_key(key) {
        return Err(AppError::InvalidInput { detail: "setting names use letters, digits and underscores".into() });
    }
    let value: String = value.chars().filter(|c| !c.is_control()).take(MAX_VALUE).collect();
    let path = env_path(dir)?;
    let existing = if path.is_file() { std::fs::read_to_string(&path).unwrap_or_default() } else { String::new() };
    let rendered = if value.is_empty() {
        format!("{key}=")
    } else if value.chars().any(|c| c.is_whitespace() || c == '#' || c == '"' || c == '\'') {
        format!("{key}=\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        format!("{key}={value}")
    };
    let mut lines: Vec<String> = existing.lines().map(str::to_string).collect();
    let mut replaced = false;
    for line in lines.iter_mut() {
        let t = line.trim();
        let t = t.strip_prefix("export ").unwrap_or(t);
        if t.split_once('=').map(|(k, _)| k.trim() == key).unwrap_or(false) {
            *line = rendered.clone();
            replaced = true;
            break;
        }
    }
    if !replaced {
        lines.push(rendered);
    }
    let mut text = lines.join("\n");
    text.push('\n');
    let tmp = dir.join(".env.projque-tmp");
    std::fs::write(&tmp, text).map_err(|e| AppError::Io { detail: e.to_string() })?;
    std::fs::rename(&tmp, &path).map_err(|e| AppError::Io { detail: e.to_string() })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_example_with_env_and_writes_values() {
        let tmp = std::env::temp_dir().join(format!("projque-env-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(
            tmp.join(".env.example"),
            "# Your OpenAI key\nAPI_KEY=\nDB_URL=postgres://localhost/app\nexport PORT=3000\n",
        )
        .unwrap();
        let s = status(&tmp).unwrap();
        assert_eq!(s.example_file.as_deref(), Some(".env.example"));
        assert!(!s.has_env);
        assert_eq!(s.missing, 3);
        assert_eq!(s.keys[0].hint.as_deref(), Some("Your OpenAI key"));

        set(&tmp, "API_KEY", "sk-abcdef123456").unwrap();
        set(&tmp, "DB_URL", "postgres://u:p@h/db with space").unwrap();
        let s = status(&tmp).unwrap();
        assert!(s.has_env);
        assert_eq!(s.missing, 1);
        let api = s.keys.iter().find(|k| k.key == "API_KEY").unwrap();
        assert!(api.set);
        assert_eq!(api.masked.as_deref(), Some("sk••••••••••"));
        assert!(!s.keys.iter().find(|k| k.key == "DB_URL").unwrap().masked.as_deref().unwrap().contains("space"));

        // Update in place keeps other lines; clearing works; bad keys refused.
        set(&tmp, "API_KEY", "new").unwrap();
        let text = std::fs::read_to_string(tmp.join(".env")).unwrap();
        assert_eq!(text.matches("API_KEY=").count(), 1);
        assert!(text.contains("DB_URL=\"postgres://u:p@h/db with space\""));
        set(&tmp, "API_KEY", "").unwrap();
        assert_eq!(status(&tmp).unwrap().missing, 2);
        assert!(set(&tmp, "bad key", "x").is_err());
        assert!(set(&tmp, "../x", "x").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
