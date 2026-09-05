//! "Try an idea safely": an experiment is a throwaway branch the agent
//! works on. Keep = commit + merge into the base branch; throw away = pin
//! the work under a snapshot ref (so History can still bring it back),
//! return to the base branch and delete the try branch. Nothing here
//! rewrites history and nothing becomes unreachable.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::backup;
use super::ops::{self, MergeOutcome};
use super::runner;
use crate::error::AppError;

pub const BRANCH_PREFIX: &str = "try/";

/// A short branch-safe slug from a free-form label ("Add dark mode!" ->
/// "add-dark-mode"). ASCII letters and digits only; never empty.
pub fn slug(label: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in label.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
        if out.len() >= 30 {
            break;
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "idea".into() } else { out }
}

fn current_branch(dir: &Path) -> Result<String, AppError> {
    let head = runner::git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let name = head.stdout.trim().to_string();
    if !head.success || name.is_empty() || name == "HEAD" {
        return Err(AppError::InvalidInput { detail: "not on a branch - switch to a branch first".into() });
    }
    Ok(name)
}

fn tracked_clean(dir: &Path) -> Result<bool, AppError> {
    let status = runner::git(dir, &["status", "--porcelain=v1", "-uno"])?;
    Ok(status.success && status.stdout.trim().is_empty())
}

fn dirty_any(dir: &Path) -> Result<bool, AppError> {
    let status = runner::git(dir, &["status", "--porcelain=v1"])?;
    Ok(status.success && !status.stdout.trim().is_empty())
}

/// Create and switch to a new `try/<slug>-<stamp>` branch from the current
/// one. Requires a clean tracked tree so "throw away" can never lose
/// anything that existed before the experiment. Returns (base, branch).
pub fn start(dir: &Path, label: &str) -> Result<(String, String), AppError> {
    if ops::merge_in_progress(dir) {
        return Err(AppError::InvalidInput { detail: "finish or abort the merge first".into() });
    }
    let base = current_branch(dir)?;
    if base.starts_with(BRANCH_PREFIX) {
        return Err(AppError::InvalidInput { detail: "already on a try branch - keep or throw it away first".into() });
    }
    if !tracked_clean(dir)? {
        return Err(AppError::InvalidInput {
            detail: "commit your current changes first, so the experiment starts from a saved version".into(),
        });
    }
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let branch = format!("{BRANCH_PREFIX}{}-{}", slug(label), secs % 1_000_000);
    ops::branch_create(dir, &branch)?;
    Ok((base, branch))
}

/// Commit whatever the experiment produced and merge it into `base`. On
/// conflicts the repository is left in the ordinary merge-in-progress
/// state (MergeBanner takes over); the try branch is deleted only after a
/// clean merge.
pub fn keep(dir: &Path, base: &str, branch: &str, message: &str) -> Result<MergeOutcome, AppError> {
    if current_branch(dir)? != branch {
        return Err(AppError::InvalidInput {
            detail: format!("switch to {branch} first - the experiment lives there"),
        });
    }
    if dirty_any(dir)? {
        ops::commit_all_checked(dir, message, false)?;
    }
    let same = runner::git(dir, &["rev-parse", branch, base])?;
    let mut lines = same.stdout.lines();
    if same.success && lines.next() == lines.next() {
        // Nothing was produced: just go back and tidy up.
        ops::switch(dir, base)?;
        ops::branch_delete(dir, branch)?;
        return Ok(MergeOutcome::Merged);
    }
    let outcome = ops::merge_into(dir, base)?;
    if matches!(outcome, MergeOutcome::Merged) {
        ops::branch_delete(dir, branch)?;
    }
    Ok(outcome)
}

/// Abandon the experiment: commit any loose work onto the try branch, pin
/// its tip under a snapshot ref (History can restore it), switch back to
/// `base` and delete the branch. `-D` is safe here precisely because the
/// tip stays reachable through the pinned ref.
pub fn discard(dir: &Path, base: &str, branch: &str, label: &str) -> Result<(), AppError> {
    if current_branch(dir)? != branch {
        return Err(AppError::InvalidInput {
            detail: format!("switch to {branch} first - the experiment lives there"),
        });
    }
    if dirty_any(dir)? {
        // Secrets are allowed here: this is a local, unreachable-by-push
        // parking spot for abandoned work, not a publication.
        let msg = format!("Abandoned try: {}", label.trim());
        ops::commit_all_checked(dir, &msg, true)?;
    }
    let out = runner::git(dir, &["rev-parse", "--verify", "HEAD"])?;
    let tip = out.stdout.trim().to_string();
    if !out.success || tip.is_empty() {
        return Err(AppError::GitFailed { detail: "could not read the branch tip".into() });
    }
    backup::pin_ref(dir, &tip)?;
    ops::switch(dir, base)?;
    let out = runner::git(dir, &["branch", "-D", branch])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: out.stderr.trim().lines().take(2).collect::<Vec<_>>().join(" ") });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_branch_safe() {
        assert_eq!(slug("Add dark mode!"), "add-dark-mode");
        assert_eq!(slug("   "), "idea");
        assert_eq!(slug("Ünïcode ✨ test"), "n-code-test");
        assert!(slug(&"x".repeat(100)).len() <= 30);
        assert!(!slug("--weird--").starts_with('-'));
    }

    #[test]
    fn full_flow_keep_and_discard() {
        let tmp = std::env::temp_dir().join(format!("projque-exp-{}-{}", std::process::id(), nanos()));
        std::fs::create_dir_all(&tmp).unwrap();
        let dir = tmp.as_path();
        let git = |args: &[&str]| {
            let out = runner::git(dir, args).unwrap();
            assert!(out.success, "git {:?}: {}", args, out.stderr);
            out.stdout
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.name", "Test"]);
        git(&["config", "user.email", "t@t"]);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-q", "-m", "init"]);

        // Keep: work lands on main, try branch is gone.
        let (base, branch) = start(dir, "Dark mode").unwrap();
        assert_eq!(base, "main");
        assert!(branch.starts_with("try/dark-mode-"));
        std::fs::write(dir.join("b.txt"), "two\n").unwrap();
        let outcome = keep(dir, &base, &branch, "Try: dark mode").unwrap();
        assert!(matches!(outcome, MergeOutcome::Merged));
        assert_eq!(current_branch(dir).unwrap(), "main");
        assert!(dir.join("b.txt").exists());
        assert!(!git(&["branch", "--list"]).contains("try/"));

        // Discard: main untouched, work pinned under a snapshot ref.
        let (base, branch) = start(dir, "Bad idea").unwrap();
        std::fs::write(dir.join("c.txt"), "three\n").unwrap();
        discard(dir, &base, &branch, "Bad idea").unwrap();
        assert_eq!(current_branch(dir).unwrap(), "main");
        assert!(!dir.join("c.txt").exists());
        assert!(!git(&["branch", "--list"]).contains("try/"));
        let snaps = backup::list_snapshots(dir).unwrap();
        assert!(!snaps.is_empty(), "abandoned work must be pinned");

        // Start refuses a dirty tree.
        std::fs::write(dir.join("a.txt"), "changed\n").unwrap();
        assert!(start(dir, "x").is_err());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    fn nanos() -> u128 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
    }
}
