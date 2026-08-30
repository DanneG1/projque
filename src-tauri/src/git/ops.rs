//! The safe, deliberately small set of git operations the UI can trigger.
//! Nothing here can rewrite history: the verbs are fetch, ff-only pull,
//! branch listing/create/safe-delete, branch switch (which git itself
//! refuses when it would clobber uncommitted changes — we never pass -f or
//! --discard-changes), commit, log, restore-as-new-commit, push of the
//! current branch, and merge (clean tree required; stops on conflicts; the
//! only exits are complete-after-resolve or abort). Restore is additive —
//! it snapshots the current working tree to a hidden ref first (see
//! backup.rs) and lands the old version as a NEW commit, so every state
//! remains reachable. rebase / reset / clean / stash / branch -D (capital) /
//! forced anything are excluded by design and must stay excluded.

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

/// Stage everything and commit. The message is an audited free-form IPC
/// exception: it becomes the value of `-m` (a single argv element, so git
/// can never parse it as an option) — sanitized to printable text plus
/// newlines, length-capped.
pub fn commit_all(dir: &Path, message: &str) -> Result<(), AppError> {
    let message: String = message
        .replace("\r\n", "\n")
        .chars()
        .map(|c| if c == '\n' || !c.is_control() { c } else { ' ' })
        .collect();
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::InvalidInput { detail: "commit message is empty".into() });
    }
    if message.len() > 1000 {
        return Err(AppError::InvalidInput { detail: "commit message too long".into() });
    }
    let add = runner::git_env(dir, &["add", "-A"], &[])?;
    if !add.success {
        return Err(AppError::GitFailed { detail: failure_detail(&add) });
    }
    let out = runner::git_env(dir, &["commit", "-m", message], &[])?;
    if !out.success {
        let combined = format!("{} {}", out.stdout.trim(), out.stderr.trim());
        if combined.contains("nothing to commit") {
            return Err(AppError::InvalidInput { detail: "nothing to commit — no changes".into() });
        }
        if combined.contains("Please tell me who you are") || combined.contains("empty ident") {
            return Err(AppError::GitFailed {
                detail: "git needs your name first — see Setup check in Settings".into(),
            });
        }
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }
    Ok(())
}

/// Recent commits, newest first.
pub fn history(dir: &Path, limit: u32) -> Result<Vec<super::GitCommit>, AppError> {
    let limit = limit.clamp(1, 100).to_string();
    let out = runner::git(dir, &["log", "-n", &limit, "--pretty=format:%H%x09%h%x09%ct%x09%s"])?;
    if !out.success {
        // A repo with no commits yet: log exits non-zero — empty history.
        return Ok(Vec::new());
    }
    Ok(out
        .stdout
        .lines()
        .filter_map(|line| {
            let mut cols = line.split('\t');
            Some(super::GitCommit {
                hash: cols.next()?.to_string(),
                short_hash: cols.next()?.to_string(),
                timestamp: cols.next()?.parse().ok()?,
                subject: cols.next().unwrap_or("").to_string(),
            })
        })
        .collect())
}

/// Bring the working files back to the state of `hash` (a commit or a
/// snapshot), recorded as a NEW commit on the current branch — history is
/// never rewritten, and the pre-restore working tree is snapshotted to a
/// hidden ref first so nothing can be lost.
///
/// `hash` is frontend-supplied and validated: hex only (so it can never be
/// an option or a revision expression), then resolved by `rev-parse
/// --verify` to prove it names a commit that exists in this repository.
pub fn restore(dir: &Path, hash: &str) -> Result<(), AppError> {
    if hash.len() < 7 || hash.len() > 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::InvalidInput { detail: "invalid commit id".into() });
    }
    let verify = runner::git(dir, &["rev-parse", "--verify", "-q", &format!("{hash}^{{commit}}")])?;
    let full = verify.stdout.trim().to_string();
    if !verify.success || full.is_empty() {
        return Err(AppError::InvalidInput { detail: "no such version in this project".into() });
    }

    super::backup::create_snapshot(dir, "Before restoring an earlier version")?;

    // Make index + working tree match the target tree exactly (adds, edits,
    // and deletions of tracked files; untracked files are left alone).
    let out = runner::git_env(dir, &["read-tree", "-u", "--reset", &full], &[])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }

    // Commit the restored state — unless it matches HEAD already (restoring
    // uncommitted edits away), where there is nothing new to record.
    let staged = runner::git(dir, &["diff", "--cached", "--quiet"])?;
    if !staged.success {
        let short: String = full.chars().take(7).collect();
        let msg = format!("Restore version {short}");
        let commit = runner::git_env(dir, &["commit", "-m", &msg], &[])?;
        if !commit.success {
            return Err(AppError::GitFailed { detail: failure_detail(&commit) });
        }
    }
    Ok(())
}

/// Create a branch at HEAD and switch to it. `name` is frontend-supplied:
/// strict charset validation first (which excludes options, whitespace,
/// control characters and revision operators), then git's own
/// `check-ref-format --branch` as the final authority.
pub fn branch_create(dir: &Path, name: &str) -> Result<(), AppError> {
    let shape_ok = !name.is_empty()
        && name.len() <= 100
        && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'))
        && !name.contains("..")
        && !name.contains("//")
        && !name.ends_with('/')
        && !name.ends_with(".lock");
    if !shape_ok {
        return Err(AppError::NameInvalid {
            detail: "branch names use letters, digits, '.', '_', '-' and '/', starting with a letter or digit".into(),
        });
    }
    let check = runner::git(dir, &["check-ref-format", "--branch", name])?;
    if !check.success {
        return Err(AppError::NameInvalid { detail: "not a valid branch name".into() });
    }
    let out = runner::git(dir, &["switch", "-c", name])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }
    Ok(())
}

/// Delete a local branch — safe delete only (`-d` refuses unmerged work).
/// Validated exactly like switch: exact byte match against refs/heads.
pub fn branch_delete(dir: &Path, branch: &str) -> Result<(), AppError> {
    if branch.starts_with('-') || branch.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::BranchNotFound { branch: branch.to_string() });
    }
    let known = list_branches(dir)?;
    let Some(info) = known.branches.iter().find(|b| b.name == branch) else {
        return Err(AppError::BranchNotFound { branch: branch.to_string() });
    };
    if info.current {
        return Err(AppError::InvalidInput {
            detail: "cannot delete the branch you are on — switch first".into(),
        });
    }
    let out = runner::git(dir, &["branch", "-d", branch])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum MergeOutcome {
    Merged,
    /// The merge stopped on conflicts and is now in progress: the user
    /// resolves the listed files, then completes or aborts.
    Conflicts { files: Vec<String> },
}

/// Merge `branch` into the current branch. Requires a clean tracked working
/// tree (commit first — so aborting always returns to a known-good state).
/// The branch is validated by exact match against refs/heads, like switch.
/// Never `-f`, never `-X theirs/ours`, never a rewrite: on conflicts git
/// stops and we report the files; the ONLY exits are merge_complete (after
/// the user resolved) and merge_abort.
pub fn merge(dir: &Path, branch: &str) -> Result<MergeOutcome, AppError> {
    if branch.starts_with('-') || branch.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::BranchNotFound { branch: branch.to_string() });
    }
    let known = list_branches(dir)?;
    let Some(info) = known.branches.iter().find(|b| b.name == branch) else {
        return Err(AppError::BranchNotFound { branch: branch.to_string() });
    };
    if info.current {
        return Err(AppError::InvalidInput { detail: "that is the branch you are on".into() });
    }
    if merge_in_progress(dir) {
        return Err(AppError::InvalidInput {
            detail: "a merge is already in progress — complete or abort it first".into(),
        });
    }
    let status = runner::git(dir, &["status", "--porcelain=v1", "-uno"])?;
    if !status.success || !status.stdout.trim().is_empty() {
        return Err(AppError::InvalidInput {
            detail: "commit your changes before merging, so the merge can be safely undone".into(),
        });
    }
    let out = runner::git_env(dir, &["merge", "--no-edit", branch], &[])?;
    if out.success {
        return Ok(MergeOutcome::Merged);
    }
    if merge_in_progress(dir) {
        return Ok(MergeOutcome::Conflicts { files: conflicted_files(dir)? });
    }
    Err(AppError::GitFailed { detail: failure_detail(&out) })
}

/// The user's mental model of merging: "take the branch I'm standing on and
/// merge it into <target>". Validates the target like switch, switches to
/// it, then merges the previous branch. On success or conflicts you are on
/// the target (where the result lives); if the merge fails outright the
/// switch is undone so you stay where you were.
pub fn merge_into(dir: &Path, target: &str) -> Result<MergeOutcome, AppError> {
    let head = runner::git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let source = head.stdout.trim().to_string();
    if !head.success || source.is_empty() || source == "HEAD" {
        return Err(AppError::InvalidInput {
            detail: "not on a branch — switch to a branch first".into(),
        });
    }
    if merge_in_progress(dir) {
        return Err(AppError::InvalidInput {
            detail: "a merge is already in progress — complete or abort it first".into(),
        });
    }
    // Clean-tree check up front so we never switch away with loose changes.
    let status = runner::git(dir, &["status", "--porcelain=v1", "-uno"])?;
    if !status.success || !status.stdout.trim().is_empty() {
        return Err(AppError::InvalidInput {
            detail: "commit your changes before merging, so the merge can be safely undone".into(),
        });
    }
    switch(dir, target)?;
    match merge(dir, &source) {
        Ok(outcome) => Ok(outcome),
        Err(e) => {
            // Total failure (no conflict state): return to where the user stood.
            let _ = switch(dir, &source);
            Err(e)
        }
    }
}

pub fn merge_in_progress(dir: &Path) -> bool {
    dir.join(".git/MERGE_HEAD").exists()
}

pub fn conflicted_files(dir: &Path) -> Result<Vec<String>, AppError> {
    let out = runner::git(dir, &["diff", "--name-only", "--diff-filter=U"])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }
    Ok(out.stdout.lines().filter(|l| !l.is_empty()).map(str::to_string).collect())
}

/// Abort the in-progress merge and return to the pre-merge state.
pub fn merge_abort(dir: &Path) -> Result<(), AppError> {
    if !merge_in_progress(dir) {
        return Err(AppError::InvalidInput { detail: "no merge in progress".into() });
    }
    let out = runner::git(dir, &["merge", "--abort"])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }
    Ok(())
}

/// Complete an in-progress merge after the user resolved the conflicts.
/// Refuses while any conflicted file still contains conflict markers, so a
/// half-resolved file cannot be committed by accident.
pub fn merge_complete(dir: &Path) -> Result<(), AppError> {
    if !merge_in_progress(dir) {
        return Err(AppError::InvalidInput { detail: "no merge in progress".into() });
    }
    let unresolved: Vec<String> = conflicted_files(dir)?
        .into_iter()
        .filter(|rel| {
            std::fs::read_to_string(dir.join(rel))
                .map(|c| c.lines().any(|l| l.starts_with("<<<<<<< ")))
                .unwrap_or(false)
        })
        .collect();
    if !unresolved.is_empty() {
        return Err(AppError::InvalidInput {
            detail: format!(
                "conflict markers still present in: {}",
                unresolved.iter().take(5).cloned().collect::<Vec<_>>().join(", ")
            ),
        });
    }
    let add = runner::git_env(dir, &["add", "-A"], &[])?;
    if !add.success {
        return Err(AppError::GitFailed { detail: failure_detail(&add) });
    }
    let still = runner::git(dir, &["diff", "--name-only", "--diff-filter=U"])?;
    if !still.stdout.trim().is_empty() {
        return Err(AppError::InvalidInput { detail: "some files are still unresolved".into() });
    }
    let out = runner::git_env(dir, &["commit", "--no-edit"], &[])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: failure_detail(&out) });
    }
    Ok(())
}

/// Push the current branch to origin, setting upstream. Explicit click only
/// (Push button / publish flow) — never a background action, never forced.
pub fn push_current(dir: &Path) -> Result<(), AppError> {
    let out = runner::git_with_timeout(dir, &["push", "-u", "origin", "HEAD"], NET_TIMEOUT, true)?;
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

    fn git_in(dir: &Path, args: &[&str]) {
        let out = runner::git(dir, args).expect("git runs");
        assert!(out.success, "git {args:?} failed: {}", out.stderr);
    }

    /// The user's workflow end-to-end: branch, commit, merge — including the
    /// conflict path (stop → resolve → complete) and abort. Skipped when git
    /// is not installed.
    #[test]
    fn branch_merge_conflict_flow() {
        if crate::git::version().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("projque-merge-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git_in(&dir, &["init", "-q", "-b", "main"]);
        git_in(&dir, &["config", "user.name", "Test"]);
        git_in(&dir, &["config", "user.email", "t@t"]);
        std::fs::write(dir.join("app.txt"), "base\n").unwrap();
        commit_all(&dir, "base").unwrap();

        // Feature branch with a clean, non-conflicting change merges fine.
        branch_create(&dir, "feature/one").unwrap();
        std::fs::write(dir.join("other.txt"), "feature\n").unwrap();
        commit_all(&dir, "feature work").unwrap();
        switch(&dir, "main").unwrap();
        assert!(matches!(merge(&dir, "feature/one").unwrap(), MergeOutcome::Merged));
        branch_delete(&dir, "feature/one").unwrap();

        // Conflicting change: merge stops, reports the file, refuses
        // completion while markers remain, completes after resolution.
        branch_create(&dir, "feature/two").unwrap();
        std::fs::write(dir.join("app.txt"), "from feature\n").unwrap();
        commit_all(&dir, "feature edit").unwrap();
        switch(&dir, "main").unwrap();
        std::fs::write(dir.join("app.txt"), "from main\n").unwrap();
        commit_all(&dir, "main edit").unwrap();
        match merge(&dir, "feature/two").unwrap() {
            MergeOutcome::Conflicts { files } => assert_eq!(files, vec!["app.txt"]),
            other => panic!("expected conflicts, got {other:?}"),
        }
        assert!(merge_in_progress(&dir));
        // Markers still present -> completion refused.
        assert!(merge_complete(&dir).is_err());
        // Resolve and complete.
        std::fs::write(dir.join("app.txt"), "resolved\n").unwrap();
        merge_complete(&dir).unwrap();
        assert!(!merge_in_progress(&dir));
        assert_eq!(std::fs::read_to_string(dir.join("app.txt")).unwrap(), "resolved\n");

        // Abort path: same setup, then abort returns to pre-merge state.
        branch_create(&dir, "feature/three").unwrap();
        std::fs::write(dir.join("app.txt"), "three\n").unwrap();
        commit_all(&dir, "three").unwrap();
        switch(&dir, "main").unwrap();
        std::fs::write(dir.join("app.txt"), "main again\n").unwrap();
        commit_all(&dir, "main again").unwrap();
        assert!(matches!(merge(&dir, "feature/three").unwrap(), MergeOutcome::Conflicts { .. }));
        merge_abort(&dir).unwrap();
        assert!(!merge_in_progress(&dir));
        assert_eq!(std::fs::read_to_string(dir.join("app.txt")).unwrap(), "main again\n");

        // Dirty tree refuses to merge.
        std::fs::write(dir.join("app.txt"), "uncommitted\n").unwrap();
        assert!(merge(&dir, "feature/three").is_err());
        commit_all(&dir, "cleanup").unwrap();

        // merge_into — the user-facing direction: standing on a feature
        // branch, merge it INTO main; ends up standing on main, merged.
        branch_create(&dir, "feature/four").unwrap();
        std::fs::write(dir.join("four.txt"), "four\n").unwrap();
        commit_all(&dir, "four").unwrap();
        assert!(matches!(merge_into(&dir, "main").unwrap(), MergeOutcome::Merged));
        let on = runner::git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap();
        assert_eq!(on.stdout.trim(), "main");
        assert!(dir.join("four.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_track_tokens() {
        assert_eq!(parse_track("[ahead 2, behind 1]"), (2, 1));
        assert_eq!(parse_track("[ahead 3]"), (3, 0));
        assert_eq!(parse_track("[behind 7]"), (0, 7));
        assert_eq!(parse_track("[gone]"), (0, 0));
        assert_eq!(parse_track(""), (0, 0));
    }
}
