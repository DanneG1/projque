//! The safe, deliberately small set of git operations the UI can trigger.
//! Nothing here can rewrite history, discard changes, or push: the verbs are
//! fetch, ff-only pull, branch listing, and branch switch (which git itself
//! refuses when it would clobber uncommitted changes — we never pass -f or
//! --discard-changes). push / merge / rebase / reset / clean / stash /
//! checkout / branch -D are excluded by design and must stay excluded.

use std::path::Path;

use serde::Serialize;

use crate::error::AppError;

use super::runner::{self, NET_TIMEOUT};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    pub branches: Vec<BranchInfo>,
    pub remote_branches: Vec<String>,
    pub detached: bool,
}

pub fn list_branches(dir: &Path) -> Result<BranchList, AppError> {
    let out = runner::git(
        dir,
        &[
            "for-each-ref",
            "refs/heads",
            "--format=%(HEAD)%09%(refname:short)%09%(upstream:short)%09%(upstream:track)",
        ],
    )?;
    if !out.success {
        return Err(AppError::GitFailed { detail: out.stderr.trim().to_string() });
    }
    let mut branches = Vec::new();
    let mut any_current = false;
    for line in out.stdout.lines() {
        let mut cols = line.split('\t');
        let head = cols.next().unwrap_or("");
        let Some(name) = cols.next().filter(|n| !n.is_empty()) else { continue };
        let upstream = cols.next().filter(|u| !u.is_empty()).map(str::to_string);
        let track = cols.next().unwrap_or("");
        let (ahead, behind) = parse_track(track);
        let current = head == "*";
        any_current |= current;
        branches.push(BranchInfo { name: name.to_string(), current, upstream, ahead, behind });
    }
    // Remote branches are for display only; never accepted back as input.
    let remote_branches = runner::git(
        dir,
        &["for-each-ref", "refs/remotes", "--format=%(refname:short)"],
    )
    .ok()
    .filter(|o| o.success)
    .map(|o| {
        o.stdout
            .lines()
            .filter(|l| !l.is_empty() && !l.ends_with("/HEAD"))
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default();
    Ok(BranchList { branches, remote_branches, detached: !any_current })
}

/// "[ahead 2, behind 1]" | "[ahead 2]" | "[gone]" | ""
fn parse_track(track: &str) -> (u32, u32) {
    let inner = track.trim_start_matches('[').trim_end_matches(']');
    let mut ahead = 0;
    let mut behind = 0;
    for token in inner.split(',') {
        let token = token.trim();
        if let Some(n) = token.strip_prefix("ahead ").and_then(|n| n.parse().ok()) {
            ahead = n;
        }
        if let Some(n) = token.strip_prefix("behind ").and_then(|n| n.parse().ok()) {
            behind = n;
        }
    }
    (ahead, behind)
}

/// Explicit, user-initiated network operation.
pub fn fetch(dir: &Path) -> Result<(), AppError> {
    let out = runner::git_with_timeout(dir, &["fetch", "--prune", "--quiet"], NET_TIMEOUT, true)?;
    if !out.success {
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }
    Ok(())
}

/// Fast-forward-only pull: cannot create merge commits; aborts cleanly on
/// divergence or when files would be clobbered.
pub fn pull_ff(dir: &Path) -> Result<(), AppError> {
    let out = runner::git_with_timeout(dir, &["pull", "--ff-only", "--quiet"], NET_TIMEOUT, true)?;
    if !out.success {
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }
    Ok(())
}

/// Switch branches. `branch` is frontend-supplied and therefore validated by
/// exact byte match against a fresh enumeration of this repository's own
/// `refs/heads`, re-run at call time — the value provably names a local ref,
/// so option or command injection is impossible. Defense in depth: leading
/// '-' and control characters are rejected anyway.
pub fn switch(dir: &Path, branch: &str) -> Result<(), AppError> {
    if branch.starts_with('-') || branch.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::BranchNotFound { branch: branch.to_string() });
    }
    let known = list_branches(dir)?;
    if !known.branches.iter().any(|b| b.name == branch) {
        return Err(AppError::BranchNotFound { branch: branch.to_string() });
    }
    let out = runner::git(dir, &["switch", branch])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }
    Ok(())
}

fn failure_detail(out: &runner::GitOutput) -> String {
    let detail = out.stderr.trim();
    if detail.is_empty() {
        "git command failed".to_string()
    } else {
        // Keep toasts readable for multi-line git errors.
        detail.lines().take(3).collect::<Vec<_>>().join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_track_tokens() {
        assert_eq!(parse_track("[ahead 2, behind 1]"), (2, 1));
        assert_eq!(parse_track("[ahead 3]"), (3, 0));
        assert_eq!(parse_track("[behind 7]"), (0, 7));
        assert_eq!(parse_track("[gone]"), (0, 0));
        assert_eq!(parse_track(""), (0, 0));
    }
}
