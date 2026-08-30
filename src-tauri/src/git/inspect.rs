//! Read-only repository inspection for the advanced git view: the commit
//! graph and structured diffs. Everything here is local `git log/show/diff`
//! output, parsed and size-capped; nothing mutates the repository and no
//! filesystem paths cross IPC (file paths in diffs are repo-relative names
//! from git's own output, used for display only).

use std::path::Path;

use serde::Serialize;

use crate::error::AppError;

use super::runner;

/// Per-file patch cap — beyond this the patch is cut and flagged.
const MAX_FILE_PATCH: usize = 48 * 1024;
/// Whole-response cap: remaining files keep their header but lose the patch.
const MAX_TOTAL_PATCH: usize = 640 * 1024;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author: String,
    pub timestamp: i64,
    /// Decorations from %D: branch names, remote branches, tags, "HEAD".
    pub refs: Vec<String>,
    pub is_head: bool,
}

/// Newest-first, topologically ordered, across all branches and tags
/// (snapshot refs deliberately excluded).
pub fn graph(dir: &Path, limit: u32) -> Result<Vec<GraphCommit>, AppError> {
    let limit = limit.clamp(1, 300).to_string();
    let out = runner::git(
        dir,
        &[
            "log",
            // NOT --all: that would include the hidden snapshot refs
            // (refs/projque/snapshots) in the graph.
            "--branches",
            "--tags",
            "--remotes",
            "--topo-order",
            "-n",
            &limit,
            "--pretty=format:%H%x09%h%x09%P%x09%ct%x09%an%x09%D%x09%s",
        ],
    )?;
    if !out.success {
        return Ok(Vec::new()); // repo with no commits
    }
    Ok(out.stdout.lines().filter_map(parse_graph_line).collect())
}

fn parse_graph_line(line: &str) -> Option<GraphCommit> {
    let mut cols = line.split('\t');
    let hash = cols.next()?.to_string();
    let short_hash = cols.next()?.to_string();
    let parents = cols
        .next()?
        .split(' ')
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect();
    let timestamp = cols.next()?.parse().ok()?;
    let author = cols.next()?.to_string();
    let decorations = cols.next().unwrap_or("");
    let subject = cols.next().unwrap_or("").to_string();
    let mut is_head = false;
    let refs = decorations
        .split(", ")
        .filter(|d| !d.is_empty())
        .filter_map(|d| {
            if let Some(target) = d.strip_prefix("HEAD -> ") {
                is_head = true;
                Some(target.to_string())
            } else if d == "HEAD" {
                is_head = true;
                None
            } else {
                Some(d.strip_prefix("tag: ").unwrap_or(d).to_string())
            }
        })
        .collect();
    Some(GraphCommit { hash, short_hash, parents, subject, author, timestamp, refs, is_head })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// Repo-relative display path (new path for renames).
    pub path: String,
    pub old_path: Option<String>,
    /// added | modified | deleted | renamed | untracked
    pub status: String,
    /// Unified diff body for this file ("" when elided by the total cap).
    pub patch: String,
    pub truncated: bool,
}

/// Diff of one commit against its (first) parent.
/// `hash` follows the git_restore validation contract: hex-only, then
/// verified to name a commit in this repository.
pub fn commit_diff(dir: &Path, hash: &str) -> Result<Vec<FileDiff>, AppError> {
    if hash.len() < 7 || hash.len() > 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::InvalidInput { detail: "invalid commit id".into() });
    }
    let verify = runner::git(dir, &["rev-parse", "--verify", "-q", &format!("{hash}^{{commit}}")])?;
    if !verify.success {
        return Err(AppError::InvalidInput { detail: "no such version in this project".into() });
    }
    let full = verify.stdout.trim();
    let names = runner::git(dir, &["show", "--format=", "--name-status", "-z", full])?;
    let patch = runner::git_env(dir, &["show", "--format=", "--patch", "--no-color", full], &[])?;
    Ok(assemble(
        parse_name_status(&names.stdout),
        if patch.success { &patch.stdout } else { "" },
    ))
}

/// Diff of the working tree against HEAD, untracked files included.
pub fn workdir_diff(dir: &Path) -> Result<Vec<FileDiff>, AppError> {
    let names = runner::git(dir, &["diff", "HEAD", "--name-status", "-z"])?;
    let patch = runner::git_env(dir, &["diff", "HEAD", "--no-color"], &[])?;
    let mut files = assemble(
        if names.success { parse_name_status(&names.stdout) } else { Vec::new() },
        if patch.success { &patch.stdout } else { "" },
    );
    // Untracked files rendered as all-added content (git diff won't show them).
    if let Ok(status) = runner::git(dir, &["status", "--porcelain=v1", "-uall", "-z"]) {
        for entry in status.stdout.split('\0') {
            let Some(rel) = entry.strip_prefix("?? ") else { continue };
            if files.len() >= 500 {
                break;
            }
            files.push(untracked_entry(dir, rel));
        }
    }
    Ok(files)
}

fn untracked_entry(dir: &Path, rel: &str) -> FileDiff {
    let mut patch = String::new();
    let mut truncated = false;
    if let Ok(bytes) = std::fs::read(dir.join(rel)) {
        if !bytes[..bytes.len().min(8000)].contains(&0) {
            let text = String::from_utf8_lossy(&bytes);
            for line in text.lines() {
                if patch.len() > MAX_FILE_PATCH {
                    truncated = true;
                    break;
                }
                patch.push('+');
                patch.push_str(line);
                patch.push('\n');
            }
        } else {
            patch = "(binary file)".into();
        }
    }
    FileDiff {
        path: rel.to_string(),
        old_path: None,
        status: "untracked".into(),
        patch,
        truncated,
    }
}

/// NUL-separated `--name-status -z` records: `M\0path` or `R100\0old\0new`.
fn parse_name_status(stdout: &str) -> Vec<(String, Option<String>, String)> {
    let mut fields = stdout.split('\0').filter(|s| !s.is_empty());
    let mut out = Vec::new();
    while let Some(code) = fields.next() {
        let status = match code.chars().next() {
            Some('A') => "added",
            Some('D') => "deleted",
            Some('R') => "renamed",
            Some('C') => "renamed",
            Some('M') | Some('T') => "modified",
            _ => "modified",
        };
        if status == "renamed" {
            let (Some(old), Some(new)) = (fields.next(), fields.next()) else { break };
            out.push((new.to_string(), Some(old.to_string()), status.to_string()));
        } else {
            let Some(path) = fields.next() else { break };
            out.push((path.to_string(), None, status.to_string()));
        }
    }
    out
}

/// Zip the ordered file list with the patch text split per file. `git show`
/// and `--name-status` emit files in the same order; on any mismatch the
/// file keeps its header and simply has no patch body.
fn assemble(names: Vec<(String, Option<String>, String)>, patch: &str) -> Vec<FileDiff> {
    let mut sections: Vec<&str> = Vec::new();
    let mut rest = patch;
    while let Some(idx) = rest[1..].find("\ndiff --git ").map(|i| i + 1) {
        sections.push(&rest[..=idx]);
        rest = &rest[idx + 1..];
    }
    if !rest.trim().is_empty() {
        sections.push(rest);
    }
    let mut total = 0usize;
    names
        .into_iter()
        .enumerate()
        .map(|(i, (path, old_path, status))| {
            let raw = sections.get(i).copied().unwrap_or("");
            let mut truncated = false;
            let mut body = raw;
            if body.len() > MAX_FILE_PATCH {
                let mut cut = MAX_FILE_PATCH;
                while !body.is_char_boundary(cut) {
                    cut -= 1;
                }
                body = &body[..cut];
                truncated = true;
            }
            if total + body.len() > MAX_TOTAL_PATCH {
                body = "";
                truncated = true;
            }
            total += body.len();
            FileDiff { path, old_path, status, patch: body.to_string(), truncated }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_graph_line_with_decorations() {
        let line = "abc\tab1\tdef 123\t1700000000\tDaniel\tHEAD -> master, origin/master, tag: v1\tSubject here";
        let c = parse_graph_line(line).unwrap();
        assert_eq!(c.parents, vec!["def", "123"]);
        assert!(c.is_head);
        assert_eq!(c.refs, vec!["master", "origin/master", "v1"]);
        assert_eq!(c.subject, "Subject here");
    }

    #[test]
    fn parses_name_status_with_rename() {
        let parsed = parse_name_status("M\0src/a.rs\0R100\0old.txt\0new.txt\0A\0added.md\0");
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[1], ("new.txt".into(), Some("old.txt".into()), "renamed".into()));
        assert_eq!(parsed[2].2, "added");
    }

    #[test]
    fn assemble_zips_sections() {
        let patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-1\n+2\n";
        let files = assemble(
            vec![
                ("a".into(), None, "modified".into()),
                ("b".into(), None, "modified".into()),
            ],
            patch,
        );
        assert_eq!(files.len(), 2);
        assert!(files[0].patch.contains("+y"));
        assert!(files[1].patch.contains("+2"));
        assert!(!files[0].patch.contains("+2"));
    }
}
