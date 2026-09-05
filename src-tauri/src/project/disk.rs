//! Reclaimable disk space: folders a project can regenerate (installed
//! dependencies, build output, caches). Read-only scan, then an explicit
//! delete that only ever removes entries the scan reported - by name, from
//! a fixed allowlist, never following symlinks, never outside the project.

use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

use crate::error::AppError;

/// (folder name, plain-language label, sibling file that proves it is
/// regenerable - None = the name alone is proof enough).
const REGENERABLE: &[(&str, &str, Option<&str>)] = &[
    ("node_modules", "installed packages", None),
    ("target", "Rust build output", Some("Cargo.toml")),
    (".next", "Next.js build cache", None),
    (".nuxt", "Nuxt build cache", None),
    (".svelte-kit", "SvelteKit build cache", None),
    (".turbo", "Turborepo cache", None),
    (".parcel-cache", "Parcel cache", None),
    (".cache", "build cache", None),
    ("__pycache__", "Python bytecode cache", None),
    (".pytest_cache", "pytest cache", None),
    (".mypy_cache", "mypy cache", None),
    (".venv", "Python virtual environment", None),
    ("venv", "Python virtual environment", None),
    (".gradle", "Gradle cache", None),
    ("bin", ".NET build output", Some("*.csproj")),
    ("obj", ".NET build output", Some("*.csproj")),
];
/// How deep to look for regenerable folders (monorepo packages live a few
/// levels down; anything deeper is inside one of the folders we found).
const MAX_DEPTH: usize = 4;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiskEntry {
    /// Project-relative path, display only (and the delete key).
    pub rel: String,
    pub label: String,
    pub bytes: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub total_bytes: u64,
    pub entries: Vec<DiskEntry>,
}

fn sibling_present(dir: &Path, pattern: &str) -> bool {
    if let Some(ext) = pattern.strip_prefix("*.") {
        std::fs::read_dir(dir)
            .map(|rd| {
                rd.flatten()
                    .any(|e| e.path().extension().and_then(|x| x.to_str()) == Some(ext))
            })
            .unwrap_or(false)
    } else {
        dir.join(pattern).is_file()
    }
}

fn dir_size(path: &Path) -> u64 {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

/// Regenerable folders in `root`, largest first. Symlinks are never
/// followed or reported; `.git` is never entered.
pub fn scan(root: &Path) -> DiskUsage {
    let mut entries = Vec::new();
    let mut it = WalkDir::new(root)
        .follow_links(false)
        .max_depth(MAX_DEPTH)
        .into_iter();
    while let Some(Ok(entry)) = it.next() {
        if entry.depth() == 0 || !entry.file_type().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            it.skip_current_dir();
            continue;
        }
        let parent = entry.path().parent().unwrap_or(root);
        let hit = REGENERABLE
            .iter()
            .find(|(n, _, proof)| *n == name && proof.map(|p| sibling_present(parent, p)).unwrap_or(true));
        if let Some((_, label, _)) = hit {
            let bytes = dir_size(entry.path());
            let rel = entry
                .path()
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| name.clone());
            entries.push(DiskEntry { rel, label: (*label).to_string(), bytes });
            it.skip_current_dir();
        }
    }
    entries.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    DiskUsage { total_bytes: entries.iter().map(|e| e.bytes).sum(), entries }
}

/// Delete the listed entries. Each must be reported by a fresh scan (so the
/// key is something we ourselves found, from the allowlist), must still be
/// a real directory (not a symlink), and must resolve inside `root`.
pub fn clean(root: &Path, rels: &[String]) -> Result<u64, AppError> {
    let root = &std::fs::canonicalize(root)
        .map_err(|_| AppError::PathMissing { path: root.display().to_string() })?;
    let current = scan(root);
    let mut freed = 0u64;
    for rel in rels {
        let entry = current.entries.iter().find(|e| &e.rel == rel).ok_or_else(|| {
            AppError::InvalidInput { detail: format!("{rel} is not a reclaimable folder here") }
        })?;
        let path: PathBuf = root.join(rel);
        let meta = std::fs::symlink_metadata(&path)
            .map_err(|_| AppError::PathMissing { path: rel.clone() })?;
        if meta.file_type().is_symlink() || !meta.is_dir() {
            return Err(AppError::InvalidInput { detail: format!("{rel} is not a plain folder") });
        }
        let canon = std::fs::canonicalize(&path).map_err(|_| AppError::PathMissing { path: rel.clone() })?;
        if !canon.starts_with(root) {
            return Err(AppError::InvalidInput { detail: format!("{rel} is outside the project") });
        }
        std::fs::remove_dir_all(&canon).map_err(|e| AppError::Io { detail: e.to_string() })?;
        freed += entry.bytes;
    }
    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_regenerable_folders_and_cleans_only_those() {
        let tmp = std::env::temp_dir().join(format!("projque-disk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("node_modules/x")).unwrap();
        std::fs::write(tmp.join("node_modules/x/a.js"), vec![0u8; 1000]).unwrap();
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        std::fs::write(tmp.join("src/main.ts"), "x").unwrap();
        // "target" without Cargo.toml is not build output - leave it alone.
        std::fs::create_dir_all(tmp.join("target")).unwrap();
        std::fs::write(tmp.join("target/data.txt"), "keep").unwrap();
        // nested package in a monorepo
        std::fs::create_dir_all(tmp.join("packages/app/node_modules/y")).unwrap();
        std::fs::write(tmp.join("packages/app/node_modules/y/b.js"), vec![0u8; 500]).unwrap();

        let usage = scan(&tmp);
        let rels: Vec<&str> = usage.entries.iter().map(|e| e.rel.as_str()).collect();
        assert_eq!(rels, vec!["node_modules", "packages/app/node_modules"]);
        assert_eq!(usage.total_bytes, 1500);

        assert!(clean(&tmp, &["src".into()]).is_err());
        assert!(clean(&tmp, &["target".into()]).is_err());
        let freed = clean(&tmp, &["node_modules".into()]).unwrap();
        assert_eq!(freed, 1000);
        assert!(!tmp.join("node_modules").exists());
        assert!(tmp.join("src/main.ts").exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
