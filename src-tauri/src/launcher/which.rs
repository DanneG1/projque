//! Program resolution against an augmented PATH.
//!
//! A GUI-launched macOS app inherits only `/usr/bin:/bin:/usr/sbin:/sbin`,
//! so tools installed via Homebrew, npm, cargo etc. would never resolve in a
//! bundled build. We augment the search path with the usual install
//! locations plus the file-only `pathAdditions` setting.

use std::path::{Path, PathBuf};

fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    #[cfg(not(target_os = "windows"))]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            dirs.push(home.join(".local/bin"));
            dirs.push(home.join(".cargo/bin"));
            dirs.push(home.join(".bun/bin"));
            dirs.push(home.join(".volta/bin"));
            dirs.push(home.join(".npm-global/bin"));
        }
    }
    dirs
}

#[cfg(target_os = "windows")]
const EXECUTABLE_EXTENSIONS: &[&str] = &["exe", "cmd", "bat", "com"];

fn candidate_in_dir(dir: &Path, program: &str) -> Option<PathBuf> {
    let direct = dir.join(program);
    if direct.is_file() {
        return Some(direct);
    }
    #[cfg(target_os = "windows")]
    for ext in EXECUTABLE_EXTENSIONS {
        let with_ext = dir.join(format!("{program}.{ext}"));
        if with_ext.is_file() {
            return Some(with_ext);
        }
    }
    None
}

/// Resolve a bare program name to an absolute path, or None if not found.
/// Names containing path separators are rejected: catalog entries are always
/// bare names, and a hand-edited absolute `command` is checked directly.
pub fn resolve_program(program: &str, path_additions: &[String]) -> Option<PathBuf> {
    let as_path = Path::new(program);
    if as_path.components().count() > 1 {
        // Hand-edited full path in settings.json: accept only if it exists.
        return as_path.is_file().then(|| as_path.to_path_buf());
    }
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    let dirs = std::env::split_paths(&path_var)
        .chain(extra_dirs())
        .chain(path_additions.iter().map(PathBuf::from));
    for dir in dirs {
        if let Some(found) = candidate_in_dir(&dir, program) {
            return Some(found);
        }
    }
    None
}

/// Is a macOS application (by `open -a` name) present?
#[cfg(target_os = "macos")]
pub fn mac_app_installed(app_name: &str) -> bool {
    Path::new(&format!("/Applications/{app_name}.app")).exists()
        || Path::new(&format!("/System/Applications/{app_name}.app")).exists()
        || Path::new(&format!("/System/Applications/Utilities/{app_name}.app")).exists()
        || std::env::var_os("HOME")
            .map(|h| Path::new(&h).join(format!("Applications/{app_name}.app")).exists())
            .unwrap_or(false)
}

/// The PATH used for embedded agent sessions: the process PATH plus the
/// usual install locations plus the file-only `pathAdditions` setting —
/// same resolution universe as `resolve_program`.
pub fn augmented_path(path_additions: &[String]) -> std::ffi::OsString {
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    let dirs: Vec<PathBuf> = std::env::split_paths(&path_var)
        .chain(extra_dirs())
        .chain(path_additions.iter().map(PathBuf::from))
        .collect();
    std::env::join_paths(dirs).unwrap_or(path_var)
}
