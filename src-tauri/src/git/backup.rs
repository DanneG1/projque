//! Automatic snapshots on hidden refs (`refs/projque/snapshots/<millis>`).
//!
//! A snapshot records the complete working tree as a commit object WITHOUT
//! touching the user's branch, index, or working files: the tree is built in
//! a scratch index file (`GIT_INDEX_FILE`), committed with `commit-tree`,
//! and stored under a ref namespace that `git log`/`git status` never show
//! and that is never pushed. `.gitignore` is respected, so ignored files
//! (node_modules, .env, build output) are never captured.
//!
//! Snapshots are taken before every embedded agent session and before every
//! restore, so "go back" can never lose work. The newest `KEEP` are retained.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::error::AppError;

use super::runner;

const KEEP: usize = 20;
const REF_PREFIX: &str = "refs/projque/snapshots/";

/// Snapshot identity is fixed: these are app-internal safety commits, not
/// the user's authored history, and must never depend on git config being
/// set up (a first-time user may not have user.name yet).
const IDENTITY: &[(&str, &str)] = &[
    ("GIT_AUTHOR_NAME", "ProjQue"),
    ("GIT_AUTHOR_EMAIL", "snapshot@projque.local"),
    ("GIT_COMMITTER_NAME", "ProjQue"),
    ("GIT_COMMITTER_EMAIL", "snapshot@projque.local"),
];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub hash: String,
    pub short_hash: String,
    pub reason: String,
    pub timestamp: i64,
}

fn ok_line(out: runner::GitOutput) -> Option<String> {
    out.success.then(|| out.stdout.trim().to_string()).filter(|s| !s.is_empty())
}

/// Snapshot the working tree if it differs from HEAD. Returns `None` when
/// there is nothing to capture (clean tree, or a repo with no commits yet).
/// `reason` is a fixed backend-side string, never frontend input.
pub fn create_snapshot(dir: &Path, reason: &str) -> Result<Option<Snapshot>, AppError> {
    let Some(head) = runner::git(dir, &["rev-parse", "--verify", "-q", "HEAD"]).ok().and_then(ok_line)
    else {
        return Ok(None); // no commits yet - nothing safe to diff against
    };

    // Build the working tree in a scratch index so the user's real index is
    // never touched. Unique per call; best-effort removal on every path.
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let scratch = std::env::temp_dir().join(format!("projque-index-{}-{millis}", std::process::id()));
    let scratch_s = scratch.display().to_string();
    let index_env: &[(&str, &str)] = &[("GIT_INDEX_FILE", &scratch_s)];

    let result = (|| {
        let add = runner::git_env(dir, &["add", "-A", "."], index_env)?;
        if !add.success {
            return Err(AppError::GitFailed { detail: trim_err(&add.stderr) });
        }
        let tree = runner::git_env(dir, &["write-tree"], index_env)
            .ok()
            .and_then(ok_line)
            .ok_or_else(|| AppError::GitFailed { detail: "write-tree failed".into() })?;
        let head_tree = runner::git(dir, &["rev-parse", &format!("{head}^{{tree}}")])
            .ok()
            .and_then(ok_line);
        if head_tree.as_deref() == Some(tree.as_str()) {
            return Ok(None); // working tree identical to HEAD
        }

        let mut envs: Vec<(&str, &str)> = vec![("GIT_INDEX_FILE", &scratch_s)];
        envs.extend_from_slice(IDENTITY);
        let commit = runner::git_env(dir, &["commit-tree", &tree, "-p", &head, "-m", reason], &envs)
            .ok()
            .and_then(ok_line)
            .ok_or_else(|| AppError::GitFailed { detail: "snapshot commit failed".into() })?;

        let ref_name = format!("{REF_PREFIX}{millis}");
        let update = runner::git(dir, &["update-ref", &ref_name, &commit])?;
        if !update.success {
            return Err(AppError::GitFailed { detail: trim_err(&update.stderr) });
        }
        prune(dir);
        Ok(Some(Snapshot {
            short_hash: commit.chars().take(7).collect(),
            hash: commit,
            reason: reason.to_string(),
            timestamp: (millis / 1000) as i64,
        }))
    })();

    let _ = std::fs::remove_file(&scratch);
    result
}

/// Newest first.
pub fn list_snapshots(dir: &Path) -> Result<Vec<Snapshot>, AppError> {
    let out = runner::git(
        dir,
        &[
            "for-each-ref",
            REF_PREFIX.trim_end_matches('/'),
            "--sort=-refname",
            "--format=%(refname)%09%(objectname)%09%(subject)",
        ],
    )?;
    if !out.success {
        return Err(AppError::GitFailed { detail: trim_err(&out.stderr) });
    }
    Ok(parse_refs(&out.stdout)
        .into_iter()
        .map(|(millis, hash, subject)| Snapshot {
            short_hash: hash.chars().take(7).collect(),
            hash,
            reason: subject,
            timestamp: (millis / 1000) as i64,
        })
        .collect())
}

fn parse_refs(stdout: &str) -> Vec<(u128, String, String)> {
    stdout
        .lines()
        .filter_map(|line| {
            let mut cols = line.split('\t');
            let ref_name = cols.next()?;
            let millis: u128 = ref_name.strip_prefix(REF_PREFIX)?.parse().ok()?;
            let hash = cols.next()?.to_string();
            let subject = cols.next().unwrap_or("").to_string();
            Some((millis, hash, subject))
        })
        .collect()
}

/// Delete all but the newest KEEP snapshot refs. Best-effort.
fn prune(dir: &Path) {
    let Ok(out) = runner::git(
        dir,
        &[
            "for-each-ref",
            REF_PREFIX.trim_end_matches('/'),
            "--sort=-refname",
            "--format=%(refname)%09%(objectname)%09%(subject)",
        ],
    ) else {
        return;
    };
    if !out.success {
        return;
    }
    for (millis, _, _) in parse_refs(&out.stdout).into_iter().skip(KEEP) {
        let _ = runner::git(dir, &["update-ref", "-d", &format!("{REF_PREFIX}{millis}")]);
    }
}

fn trim_err(stderr: &str) -> String {
    let detail = stderr.trim();
    if detail.is_empty() {
        "git command failed".to_string()
    } else {
        detail.lines().take(3).collect::<Vec<_>>().join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::ops;

    fn git_in(dir: &Path, args: &[&str]) {
        let out = runner::git(dir, args).expect("git runs");
        assert!(out.success, "git {args:?} failed: {}", out.stderr);
    }

    /// End-to-end over a real repository: snapshot leaves branch/index/
    /// worktree untouched, restore round-trips content without losing
    /// anything. Skipped when git is not installed.
    #[test]
    fn snapshot_and_restore_round_trip() {
        if crate::git::version().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("projque-backup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        git_in(&dir, &["init", "-q"]);
        git_in(&dir, &["config", "user.name", "Test"]);
        git_in(&dir, &["config", "user.email", "t@t"]);
        std::fs::write(dir.join("app.txt"), "v1").unwrap();
        ops::commit_all(&dir, "v1").unwrap();
        let v1 = ops::history(&dir, 5).unwrap()[0].hash.clone();

        // Dirty the tree, snapshot it.
        std::fs::write(dir.join("app.txt"), "v2").unwrap();
        std::fs::write(dir.join("new.txt"), "extra").unwrap();
        let snap = create_snapshot(&dir, "Before agent session").unwrap().expect("snapshot taken");

        // Branch and worktree untouched by the snapshot.
        assert_eq!(ops::history(&dir, 5).unwrap().len(), 1);
        assert_eq!(std::fs::read_to_string(dir.join("app.txt")).unwrap(), "v2");
        assert_eq!(list_snapshots(&dir).unwrap().len(), 1);

        // Clean tree -> no snapshot.
        ops::commit_all(&dir, "v2").unwrap();
        assert!(create_snapshot(&dir, "noop").unwrap().is_none());

        // Restore v1 as a new commit; then recover v2 state from the snapshot.
        ops::restore(&dir, &v1).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("app.txt")).unwrap(), "v1");
        assert!(ops::history(&dir, 5).unwrap()[0].subject.starts_with("Restore version"));
        ops::restore(&dir, &snap.hash).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("app.txt")).unwrap(), "v2");
        assert_eq!(std::fs::read_to_string(dir.join("new.txt")).unwrap(), "extra");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_snapshot_refs() {
        let out = "refs/projque/snapshots/1756500000000\tabc123def\tBefore agent session\n\
                   refs/projque/snapshots/1756400000000\t0123456\tBefore restore\n\
                   refs/other/thing\tdeadbeef\tignored\n";
        let refs = parse_refs(out);
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].0, 1756500000000);
        assert_eq!(refs[0].2, "Before agent session");
    }
}
