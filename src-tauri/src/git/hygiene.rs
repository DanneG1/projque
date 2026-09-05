//! Commit-time safety checks for people who don't know what belongs in git:
//! a secrets scan over exactly the files a commit would add or change, and
//! a small catalog of things that should almost never be committed
//! (`node_modules`, build output, OS junk). The fix appends fixed catalog
//! patterns to `.gitignore` - the frontend selects catalog *ids*, never the
//! pattern text, so nothing free-form reaches the file.

use std::path::Path;

use serde::Serialize;

use crate::error::AppError;
use crate::github::secrets::{self, SecretFinding};

use super::runner;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreWarning {
    /// Catalog id, accepted back by `apply_ignores`.
    pub kind: String,
    /// Plain-language label ("Installed packages (node_modules)").
    pub label: String,
    /// Display only.
    pub example: String,
    pub files: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitPreflight {
    /// Files the commit would include (tracked changes + untracked).
    pub changed: u32,
    pub findings: Vec<SecretFinding>,
    pub ignore_warnings: Vec<IgnoreWarning>,
}

/// (id, label, .gitignore lines, matcher over a repo-relative path)
struct IgnoreRule {
    kind: &'static str,
    label: &'static str,
    patterns: &'static [&'static str],
    matches: fn(&str) -> bool,
}

fn segments(rel: &str) -> impl Iterator<Item = &str> {
    rel.split('/').filter(|s| !s.is_empty())
}

fn has_dir(rel: &str, name: &str) -> bool {
    // A directory somewhere in the path (not the final file name).
    let parts: Vec<&str> = segments(rel).collect();
    parts.len() > 1 && parts[..parts.len() - 1].iter().any(|p| *p == name)
}

fn base(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

const RULES: &[IgnoreRule] = &[
    IgnoreRule {
        kind: "nodeModules",
        label: "Installed packages (node_modules)",
        patterns: &["node_modules/"],
        matches: |rel| has_dir(rel, "node_modules"),
    },
    IgnoreRule {
        kind: "buildOutput",
        label: "Build output (dist, build, out)",
        patterns: &["dist/", "build/", "out/"],
        matches: |rel| has_dir(rel, "dist") || has_dir(rel, "build") || has_dir(rel, "out"),
    },
    IgnoreRule {
        kind: "rustTarget",
        label: "Rust build directory (target)",
        patterns: &["target/"],
        matches: |rel| has_dir(rel, "target"),
    },
    IgnoreRule {
        kind: "pythonCache",
        label: "Python caches and virtual environments",
        patterns: &["__pycache__/", "*.pyc", ".venv/", "venv/"],
        matches: |rel| {
            has_dir(rel, "__pycache__")
                || has_dir(rel, ".venv")
                || has_dir(rel, "venv")
                || base(rel).ends_with(".pyc")
        },
    },
    IgnoreRule {
        kind: "osJunk",
        label: "Operating system files (.DS_Store, Thumbs.db)",
        patterns: &[".DS_Store", "Thumbs.db"],
        matches: |rel| matches!(base(rel), ".DS_Store" | "Thumbs.db"),
    },
    IgnoreRule {
        kind: "logs",
        label: "Log files",
        patterns: &["*.log", "npm-debug.log*"],
        matches: |rel| base(rel).ends_with(".log"),
    },
    IgnoreRule {
        kind: "envFiles",
        label: "Environment files with secrets (.env)",
        patterns: &[".env", ".env.*", "!.env.example"],
        matches: |rel| {
            let b = base(rel);
            b == ".env" || (b.starts_with(".env.") && !matches!(b, ".env.example" | ".env.sample" | ".env.template"))
        },
    },
];

/// Files a commit would touch: modified/added/deleted tracked files plus
/// untracked (non-ignored) files, from porcelain status.
fn changed_paths(dir: &Path) -> Result<Vec<String>, AppError> {
    let out = runner::git(dir, &["status", "--porcelain=v1", "-uall", "-z"])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: out.stderr.trim().lines().take(3).collect::<Vec<_>>().join(" ") });
    }
    let mut paths = Vec::new();
    let mut entries = out.stdout.split('\0').filter(|s| !s.is_empty()).peekable();
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        let code = &entry[..2];
        let path = &entry[3..];
        // Renames carry the original name as a second NUL-separated field.
        if code.contains('R') || code.contains('C') {
            entries.next();
        }
        if code.contains('D') && !code.contains('M') && !code.contains('A') {
            continue; // deleted: nothing to scan
        }
        paths.push(path.to_string());
    }
    Ok(paths)
}

pub fn commit_preflight(dir: &Path) -> Result<CommitPreflight, AppError> {
    let paths = changed_paths(dir)?;
    let rels: Vec<&str> = paths.iter().map(String::as_str).collect();
    let findings = secrets::scan_paths(dir, &rels);
    let mut ignore_warnings = Vec::new();
    for rule in RULES {
        let hits: Vec<&str> = rels.iter().copied().filter(|r| (rule.matches)(r)).collect();
        if let Some(first) = hits.first() {
            ignore_warnings.push(IgnoreWarning {
                kind: rule.kind.to_string(),
                label: rule.label.to_string(),
                example: (*first).to_string(),
                files: hits.len() as u32,
            });
        }
    }
    Ok(CommitPreflight { changed: rels.len() as u32, findings, ignore_warnings })
}

/// Secrets in what a commit would add - the backend re-check behind the
/// preflight the UI shows. Empty = safe to commit.
pub fn secrets_in_changes(dir: &Path) -> Result<Vec<SecretFinding>, AppError> {
    let paths = changed_paths(dir)?;
    let rels: Vec<&str> = paths.iter().map(String::as_str).collect();
    Ok(secrets::scan_paths(dir, &rels))
}

/// Append the catalog patterns for the given rule ids to `.gitignore`
/// (created if missing), skipping lines already present, and un-stage any
/// now-ignored files so the next commit leaves them out. Unknown ids are
/// rejected; nothing from the frontend becomes file content.
pub fn apply_ignores(dir: &Path, kinds: &[String]) -> Result<(), AppError> {
    let rules: Vec<&IgnoreRule> = kinds
        .iter()
        .map(|k| {
            RULES
                .iter()
                .find(|r| r.kind == k)
                .ok_or_else(|| AppError::InvalidInput { detail: format!("unknown ignore rule {k}") })
        })
        .collect::<Result<_, _>>()?;
    if rules.is_empty() {
        return Ok(());
    }
    let path = dir.join(".gitignore");
    if path.is_symlink() {
        return Err(AppError::InvalidInput { detail: ".gitignore is a symlink - edit it by hand".into() });
    }
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let present: std::collections::HashSet<&str> = existing.lines().map(str::trim).collect();
    let mut additions: Vec<&str> = Vec::new();
    for rule in rules {
        for p in rule.patterns {
            if !present.contains(p) && !additions.contains(p) {
                additions.push(p);
            }
        }
    }
    if additions.is_empty() {
        return Ok(());
    }
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    if !content.is_empty() {
        content.push('\n');
    }
    content.push_str("# Added by ProjQue\n");
    for p in additions {
        content.push_str(p);
        content.push('\n');
    }
    std::fs::write(&path, content)?;
    // Files already staged (or tracked) that the new rules cover would still
    // be committed; drop them from the index only - the files stay on disk.
    let _ = runner::git(dir, &["rm", "-r", "-q", "--cached", "--ignore-unmatch", "."]);
    let _ = runner::git(dir, &["add", "-A"]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_match_expected_paths() {
        let find = |k: &str| RULES.iter().find(|r| r.kind == k).unwrap();
        assert!((find("nodeModules").matches)("node_modules/react/index.js"));
        assert!(!(find("nodeModules").matches)("src/node_modules.ts"));
        assert!((find("buildOutput").matches)("dist/index.js"));
        assert!(!(find("buildOutput").matches)("src/build.rs"));
        assert!((find("osJunk").matches)("assets/.DS_Store"));
        assert!((find("envFiles").matches)(".env"));
        assert!((find("envFiles").matches)("api/.env.production"));
        assert!(!(find("envFiles").matches)(".env.example"));
        assert!((find("pythonCache").matches)("app/__pycache__/x.pyc"));
    }

    /// Real repo: the preflight sees exactly the files a commit would add,
    /// flags a pasted key, and commit_all refuses until it is gone.
    #[test]
    fn preflight_and_commit_block_over_real_repo() {
        if crate::git::version().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("projque-preflight-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        let git = |args: &[&str]| {
            let out = runner::git(&dir, args).expect("git runs");
            assert!(out.success, "git {args:?}: {}", out.stderr);
        };
        git(&["init", "-q"]);
        git(&["config", "user.name", "T"]);
        git(&["config", "user.email", "t@t"]);
        std::fs::write(dir.join("app.js"), concat!("const key = 'AKIA", "JQ7RJ2K9M3XB5W1C';\n")).unwrap();
        std::fs::write(dir.join("node_modules/x/index.js"), "x").unwrap();

        let pre = commit_preflight(&dir).unwrap();
        assert_eq!(pre.changed, 2);
        assert_eq!(pre.findings.len(), 1);
        assert_eq!(pre.findings[0].file, "app.js");
        assert!(pre.ignore_warnings.iter().any(|w| w.kind == "nodeModules"));
        assert!(crate::git::ops::commit_all(&dir, "leak").is_err());
        // The explicit override commits anyway (the user vouched for it).
        crate::git::ops::commit_all_checked(&dir, "leak anyway", true).unwrap();
        std::fs::write(dir.join("app.js"), concat!("const key2 = 'AKIA", "JQ7RJ2K9M3XB5W1D';\n")).unwrap();
        assert!(crate::git::ops::commit_all(&dir, "leak").is_err());

        std::fs::write(dir.join("app.js"), "const key = process.env.KEY;\n").unwrap();
        apply_ignores(&dir, &["nodeModules".into()]).unwrap();
        let pre = commit_preflight(&dir).unwrap();
        assert!(pre.findings.is_empty());
        assert!(pre.ignore_warnings.is_empty(), "{:?}", pre.ignore_warnings);
        crate::git::ops::commit_all(&dir, "clean").unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_ignores_appends_once() {
        let dir = std::env::temp_dir().join(format!("projque-hygiene-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".gitignore"), "dist/\n").unwrap();
        apply_ignores(&dir, &["buildOutput".into(), "osJunk".into()]).unwrap();
        let content = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(content.matches("dist/").count(), 1);
        assert!(content.contains("build/"));
        assert!(content.contains(".DS_Store"));
        assert!(apply_ignores(&dir, &["bogus".into()]).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
