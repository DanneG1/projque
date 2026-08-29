use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;
use walkdir::WalkDir;

/// Directory names never descended into during a scan. Hidden directories
/// are skipped as well (see `should_descend`).
const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "vendor",
    "dist",
    "build",
    "out",
    "__pycache__",
];

const MAX_CANDIDATES: usize = 500;

/// A repository found during a scan. The frontend only ever gets the opaque
/// `candidate_id` as a handle — `display_path` is for rendering and is never
/// accepted back.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRepo {
    pub candidate_id: String,
    pub name: String,
    pub display_path: String,
    pub root_index: usize,
    pub depth: usize,
    pub already_imported: bool,
    pub nested_inside: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanIssue {
    pub path: String,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub candidates: Vec<DiscoveredRepo>,
    pub roots_scanned: Vec<String>,
    pub errors: Vec<ScanIssue>,
    pub truncated: bool,
    pub duration_ms: u64,
}

fn should_descend(entry: &walkdir::DirEntry) -> bool {
    if !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    !name.starts_with('.') && !IGNORED_DIRS.contains(&name.as_ref())
}

/// Scan the configured roots for git repositories. Only explicitly
/// configured roots are visited, recursion is depth-capped, symlinks are
/// never followed, and hidden/ignored directories are pruned before descent.
///
/// Returns the result plus the candidate-id -> path table the import command
/// resolves against.
pub fn scan(
    roots: &[PathBuf],
    max_depth: usize,
    imported_paths: &[PathBuf],
) -> (ScanResult, HashMap<String, PathBuf>) {
    let started = Instant::now();
    let mut candidates = Vec::new();
    let mut errors = Vec::new();
    let mut table: HashMap<String, PathBuf> = HashMap::new();
    let mut seen: HashMap<PathBuf, String> = HashMap::new(); // canonical path -> candidate id
    let mut truncated = false;
    let mut seq = 0usize;

    for (root_index, root) in roots.iter().enumerate() {
        if !root.is_dir() {
            errors.push(ScanIssue {
                path: root.display().to_string(),
                detail: "root folder not found".into(),
            });
            continue;
        }
        let walker = WalkDir::new(root)
            .min_depth(1)
            .max_depth(max_depth)
            .follow_links(false)
            .into_iter()
            .filter_entry(should_descend);
        for entry in walker {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    errors.push(ScanIssue {
                        path: e.path().map(|p| p.display().to_string()).unwrap_or_default(),
                        detail: e.to_string(),
                    });
                    continue;
                }
            };
            // `.git` can be a directory (normal repo) or a file (worktree).
            if !entry.path().join(".git").exists() {
                continue;
            }
            let canon = match std::fs::canonicalize(entry.path()) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if seen.contains_key(&canon) {
                continue;
            }
            if candidates.len() >= MAX_CANDIDATES {
                truncated = true;
                break;
            }
            seq += 1;
            let candidate_id = format!("cand-{seq}");
            let nested_inside = nearest_ancestor_candidate(&canon, &seen);
            let already_imported = imported_paths.iter().any(|p| p == &canon);
            candidates.push(DiscoveredRepo {
                candidate_id: candidate_id.clone(),
                name: canon
                    .file_name()
                    .map(|f| f.to_string_lossy().into_owned())
                    .unwrap_or_else(|| canon.display().to_string()),
                display_path: entry.path().display().to_string(),
                root_index,
                depth: entry.depth(),
                already_imported,
                nested_inside,
            });
            seen.insert(canon.clone(), candidate_id.clone());
            table.insert(candidate_id, canon);
        }
    }

    let result = ScanResult {
        candidates,
        roots_scanned: roots.iter().map(|r| r.display().to_string()).collect(),
        errors,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    (result, table)
}

fn nearest_ancestor_candidate(
    path: &Path,
    seen: &HashMap<PathBuf, String>,
) -> Option<String> {
    let mut current = path.parent();
    while let Some(p) = current {
        if let Some(id) = seen.get(p) {
            return Some(id.clone());
        }
        current = p.parent();
    }
    None
}
