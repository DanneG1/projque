pub mod ops;
mod parse;
mod remote;
mod runner;

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

pub use remote::normalize_repository_url;
pub use runner::version;

use crate::error::AppError;

/// Local git invocation used by project setup (init / add / commit) and
/// cloning. Same hardened runner as everything else.
pub fn run_in(dir: &Path, args: &[&str]) -> Result<(), AppError> {
    let out = runner::git(dir, args)?;
    if !out.success {
        let detail = out.stderr.trim();
        return Err(AppError::GitFailed {
            detail: if detail.is_empty() { "git command failed".into() } else { detail.lines().take(3).collect::<Vec<_>>().join(" ") },
        });
    }
    Ok(())
}

/// Network clone with a long timeout (large repositories).
pub fn clone_into(root: &Path, url: &str, dir_name: &str) -> Result<(), AppError> {
    let out = runner::git_with_timeout(
        root,
        &["clone", "--", url, dir_name],
        std::time::Duration::from_secs(600),
        true,
    )?;
    if !out.success {
        let detail = out.stderr.trim();
        return Err(AppError::GitFailed {
            detail: if detail.is_empty() { "git clone failed".into() } else { detail.lines().take(3).collect::<Vec<_>>().join(" ") },
        });
    }
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub timestamp: i64,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitState {
    Available,
    NotARepository,
    GitMissing,
    Error,
}

/// Everything the UI shows about a repository, produced from local git only.
/// Failures degrade per-field: a repo with no commits still reports its
/// branch, a repo with no remote simply has `repository_url: None`.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub project_id: String,
    pub state: GitState,
    pub branch: Option<String>,
    pub detached: bool,
    pub changed_files: u32,
    pub dirty: bool,
    pub has_untracked: bool,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub last_commit: Option<GitCommit>,
    pub remote_url: Option<String>,
    pub repository_url: Option<String>,
    pub fetched_at: i64,
    pub error: Option<String>,
}

impl GitInfo {
    /// A blank record in the Error state — used when the project directory
    /// itself is unresolvable or git is missing.
    pub fn missing(project_id: &str) -> Self {
        Self::empty(project_id, GitState::Error)
    }

    fn empty(project_id: &str, state: GitState) -> Self {
        Self {
            project_id: project_id.to_string(),
            state,
            branch: None,
            detached: false,
            changed_files: 0,
            dirty: false,
            has_untracked: false,
            ahead: None,
            behind: None,
            last_commit: None,
            remote_url: None,
            repository_url: None,
            fetched_at: now(),
            error: None,
        }
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Fetch all git info for one repository: three local-only spawns.
pub fn fetch_info(project_id: &str, dir: &Path) -> GitInfo {
    if !dir.join(".git").exists() {
        return GitInfo::empty(project_id, GitState::NotARepository);
    }

    let status = match runner::git(dir, &["status", "--porcelain=v1", "-b", "-uall"]) {
        Ok(out) if out.success => parse::parse_status(&out.stdout),
        Ok(_) => parse::StatusInfo::default(),
        Err(crate::error::AppError::GitUnavailable) => {
            return GitInfo::empty(project_id, GitState::GitMissing);
        }
        Err(e) => {
            let mut info = GitInfo::empty(project_id, GitState::Error);
            info.error = Some(e.to_string());
            return info;
        }
    };

    // Exit status is non-zero for a repo with no commits — that's fine,
    // the commit line is simply omitted.
    let last_commit = runner::git(dir, &["log", "-1", "--pretty=format:%H%n%h%n%s%n%ct"])
        .ok()
        .filter(|out| out.success)
        .and_then(|out| parse::parse_last_commit(&out.stdout))
        .map(|c| GitCommit {
            hash: c.hash,
            short_hash: c.short_hash,
            subject: c.subject,
            timestamp: c.timestamp,
        });

    // Exit code 1 = no remote configured; the Repository button stays hidden.
    let remote_url = runner::git(dir, &["config", "--get", "remote.origin.url"])
        .ok()
        .filter(|out| out.success)
        .map(|out| out.stdout.trim().to_string())
        .filter(|s| !s.is_empty());
    let repository_url = remote_url.as_deref().and_then(normalize_repository_url);

    GitInfo {
        project_id: project_id.to_string(),
        state: GitState::Available,
        branch: status.branch,
        detached: status.detached,
        changed_files: status.changed_files,
        dirty: status.changed_files > 0,
        has_untracked: status.has_untracked,
        ahead: status.ahead,
        behind: status.behind,
        last_commit,
        remote_url,
        repository_url,
        fetched_at: now(),
        error: None,
    }
}
