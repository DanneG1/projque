//! GitHub CLI (`gh`) integration. `gh` is treated exactly like `git`: an
//! allowlisted binary the user installed and authenticated themselves,
//! invoked with fixed argv (never a shell), touching the network only on
//! explicit user action (create repository, check PR). Everything degrades
//! gracefully when gh is missing or unauthenticated.

pub mod secrets;

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::AppError;
use crate::launcher::which;

const LOCAL_TIMEOUT: Duration = Duration::from_secs(10);
const NET_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GhStatus {
    pub installed: bool,
    pub authenticated: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrStatus {
    pub title: String,
    pub url: String,
    pub state: String,
    pub checks_passing: Option<bool>,
    pub checks_total: u32,
}

struct GhOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

fn run_gh(
    dir: &Path,
    args: &[&str],
    timeout: Duration,
    path_additions: &[String],
) -> Result<GhOutput, AppError> {
    let program = which::resolve_program("gh", path_additions).ok_or(AppError::GhUnavailable)?;
    let mut child = Command::new(program)
        .args(args)
        .current_dir(dir)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::GhFailed { detail: e.to_string() })?;

    let mut stdout_pipe = child.stdout.take().expect("stdout was piped");
    let stdout_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });
    let mut stderr_pipe = child.stderr.take().expect("stderr was piped");
    let stderr_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf);
        buf
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AppError::GhFailed { detail: "gh timed out".into() });
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(AppError::GhFailed { detail: e.to_string() }),
        }
    };
    Ok(GhOutput {
        success: status.success(),
        stdout: String::from_utf8_lossy(&stdout_reader.join().unwrap_or_default()).into_owned(),
        stderr: String::from_utf8_lossy(&stderr_reader.join().unwrap_or_default()).into_owned(),
    })
}

fn failure_detail(out: &GhOutput) -> String {
    let detail = if out.stderr.trim().is_empty() { &out.stdout } else { &out.stderr };
    let detail = detail.trim();
    if detail.is_empty() {
        "gh command failed".to_string()
    } else {
        detail.lines().take(3).collect::<Vec<_>>().join(" ")
    }
}

/// Installed + authenticated probe. `gh auth status` reads the local hosts
/// file - no network.
pub fn status(path_additions: &[String]) -> GhStatus {
    let installed = which::resolve_program("gh", path_additions).is_some();
    if !installed {
        return GhStatus { installed: false, authenticated: false };
    }
    let authenticated = run_gh(Path::new("."), &["auth", "status"], LOCAL_TIMEOUT, path_additions)
        .map(|o| o.success)
        .unwrap_or(false);
    GhStatus { installed, authenticated }
}

/// Create the GitHub repository for a freshly initialized local project and
/// push. `name` is validated by the caller (project_create's strict charset).
pub fn repo_create(
    dir: &Path,
    name: &str,
    private: bool,
    path_additions: &[String],
) -> Result<(), AppError> {
    let visibility = if private { "--private" } else { "--public" };
    let out = run_gh(
        dir,
        &["repo", "create", name, visibility, "--source", ".", "--remote", "origin", "--push"],
        NET_TIMEOUT,
        path_additions,
    )?;
    if !out.success {
        return Err(AppError::GhFailed { detail: failure_detail(&out) });
    }
    Ok(())
}

/// PR + CI status for the current branch. `Ok(None)` = no open PR.
pub fn pr_status(dir: &Path, path_additions: &[String]) -> Result<Option<PrStatus>, AppError> {
    let out = run_gh(
        dir,
        &["pr", "view", "--json", "title,url,state,statusCheckRollup"],
        NET_TIMEOUT,
        path_additions,
    )?;
    if !out.success {
        // gh exits non-zero with "no pull requests found" - not an error.
        if out.stderr.to_lowercase().contains("no pull requests found") {
            return Ok(None);
        }
        return Err(AppError::GhFailed { detail: failure_detail(&out) });
    }
    let json: serde_json::Value = serde_json::from_str(&out.stdout)
        .map_err(|e| AppError::GhFailed { detail: e.to_string() })?;
    let checks = json
        .get("statusCheckRollup")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();
    let concluded: Vec<String> = checks
        .iter()
        .filter_map(|c| {
            c.get("conclusion")
                .or_else(|| c.get("state"))
                .and_then(|v| v.as_str())
                .map(str::to_uppercase)
        })
        .collect();
    let checks_total = checks.len() as u32;
    let checks_passing = if checks_total == 0 {
        None
    } else {
        Some(concluded.iter().all(|c| matches!(c.as_str(), "SUCCESS" | "NEUTRAL" | "SKIPPED")))
    };
    Ok(Some(PrStatus {
        title: json.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        url: json.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        state: json.get("state").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        checks_passing,
        checks_total,
    }))
}

// ---------------------------------------------------------------------------
// Publish to GitHub Pages
//
// Free-tier only by design: GitHub Pages on a public repository costs
// nothing, so the flow can never surprise the user with a bill. The frontend
// shows an explicit consent dialog ("your code becomes public", "this is
// free") and the secrets scan runs both before the dialog and again inside
// publish() as defense in depth.

/// Everything the publish dialog needs to render, computed locally (the only
/// spawn that could touch the network is `gh auth status`, which reads the
/// local hosts file).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PublishPreflight {
    pub gh_installed: bool,
    pub gh_authenticated: bool,
    pub has_remote: bool,
    pub has_commits: bool,
    pub dirty: bool,
    /// Pages source path when the project looks like a static site
    /// ("/" or "/docs"); None = repository publish only, no website.
    pub static_path: Option<String>,
    /// None when the directory name is valid as a GitHub repository name;
    /// otherwise the reason it is not.
    pub name_problem: Option<String>,
    pub findings: Vec<secrets::SecretFinding>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PublishOutcome {
    pub repo_url: Option<String>,
    pub pages_url: Option<String>,
    /// Pages enablement failed but the push succeeded - shown as a warning.
    pub pages_error: Option<String>,
}

fn detect_static_path(dir: &Path) -> Option<String> {
    if dir.join("index.html").is_file() {
        Some("/".to_string())
    } else if dir.join("docs/index.html").is_file() {
        Some("/docs".to_string())
    } else {
        None
    }
}

pub fn publish_preflight(dir: &Path, path_additions: &[String]) -> Result<PublishPreflight, AppError> {
    let gh = status(path_additions);
    let info = crate::git::fetch_info("preflight", dir);
    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    Ok(PublishPreflight {
        gh_installed: gh.installed,
        gh_authenticated: gh.authenticated,
        has_remote: info.remote_url.is_some(),
        has_commits: info.last_commit.is_some(),
        dirty: info.dirty,
        static_path: detect_static_path(dir),
        name_problem: validate_name(name).err().map(|e| e.to_string()),
        findings: secrets::scan(dir)?,
    })
}

/// The publish itself: push (creating the public repository first if there
/// is no remote yet), then enable GitHub Pages when the project is a static
/// site. Refuses to run while the secrets scan reports findings - the
/// frontend surfaces them before this is ever called; this re-check only
/// defends against a bypassed dialog.
pub fn publish(dir: &Path, path_additions: &[String]) -> Result<PublishOutcome, AppError> {
    let findings = secrets::scan(dir)?;
    if !findings.is_empty() {
        let files: Vec<&str> = findings.iter().map(|f| f.file.as_str()).take(5).collect();
        return Err(AppError::InvalidInput {
            detail: format!("publish blocked - possible secrets in: {}", files.join(", ")),
        });
    }

    let info = crate::git::fetch_info("publish", dir);
    if info.last_commit.is_none() {
        return Err(AppError::InvalidInput { detail: "commit your work before publishing".into() });
    }
    if info.remote_url.is_none() {
        let name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| AppError::InvalidInput { detail: "unreadable project folder name".into() })?
            .to_string();
        validate_name(&name)?;
        repo_create(dir, &name, false, path_additions)?;
    } else {
        crate::git::ops::push_current(dir)?;
    }

    // Owner/name straight from gh itself - never derived from the URL string.
    let view = run_gh(dir, &["repo", "view", "--json", "nameWithOwner,url"], NET_TIMEOUT, path_additions)?;
    if !view.success {
        return Err(AppError::GhFailed { detail: failure_detail(&view) });
    }
    let json: serde_json::Value = serde_json::from_str(&view.stdout)
        .map_err(|e| AppError::GhFailed { detail: e.to_string() })?;
    let nwo = json
        .get("nameWithOwner")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::GhFailed { detail: "could not determine repository".into() })?
        .to_string();
    let repo_url = json.get("url").and_then(|v| v.as_str()).map(str::to_string);

    let Some(static_path) = detect_static_path(dir) else {
        return Ok(PublishOutcome { repo_url, pages_url: None, pages_error: None });
    };
    let branch = crate::git::runner::git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .filter(|o| o.success)
        .map(|o| o.stdout.trim().to_string())
        .filter(|b| !b.is_empty() && b != "HEAD")
        .ok_or_else(|| AppError::GitFailed { detail: "could not determine current branch".into() })?;

    // Enable Pages; 409 means it is already enabled - not an error.
    let api_path = format!("repos/{nwo}/pages");
    let enable = run_gh(
        dir,
        &[
            "api", "-X", "POST", &api_path,
            "-f", &format!("source[branch]={branch}"),
            "-f", &format!("source[path]={static_path}"),
        ],
        NET_TIMEOUT,
        path_additions,
    )?;
    let already = !enable.success
        && (enable.stdout.contains("already exists") || enable.stderr.contains("HTTP 409"));
    if !enable.success && !already {
        return Ok(PublishOutcome {
            repo_url,
            pages_url: None,
            pages_error: Some(failure_detail(&enable)),
        });
    }

    let pages = run_gh(dir, &["api", &api_path], NET_TIMEOUT, path_additions)?;
    let pages_url = pages
        .success
        .then(|| serde_json::from_str::<serde_json::Value>(&pages.stdout).ok())
        .flatten()
        .and_then(|v| v.get("html_url").and_then(|u| u.as_str()).map(str::to_string));
    Ok(PublishOutcome { repo_url, pages_url, pages_error: None })
}

/// Back up a project that has no remote: create a PRIVATE repository under
/// the user's account and push. Same secrets gate as publish - private is
/// not a reason to upload credentials. Returns the repository URL.
pub fn backup(dir: &Path, path_additions: &[String]) -> Result<String, AppError> {
    let findings = secrets::scan(dir)?;
    if !findings.is_empty() {
        let files: Vec<&str> = findings.iter().map(|f| f.file.as_str()).take(5).collect();
        return Err(AppError::InvalidInput {
            detail: format!("backup blocked - possible secrets in: {}", files.join(", ")),
        });
    }
    let info = crate::git::fetch_info("backup", dir);
    if info.last_commit.is_none() {
        return Err(AppError::InvalidInput { detail: "commit your work before backing it up".into() });
    }
    if info.remote_url.is_some() {
        return Err(AppError::InvalidInput { detail: "this project already has a remote".into() });
    }
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::InvalidInput { detail: "unreadable project folder name".into() })?
        .to_string();
    validate_name(&name)?;
    repo_create(dir, &name, true, path_additions)?;
    let view = run_gh(dir, &["repo", "view", "--json", "url"], NET_TIMEOUT, path_additions)?;
    if !view.success {
        return Err(AppError::GhFailed { detail: failure_detail(&view) });
    }
    let json: serde_json::Value = serde_json::from_str(&view.stdout)
        .map_err(|e| AppError::GhFailed { detail: e.to_string() })?;
    Ok(json.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string())
}

/// Validate a project/repository name: also used as the directory name.
pub fn validate_name(name: &str) -> Result<(), AppError> {
    let ok = !name.is_empty()
        && name.len() <= 100
        && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(AppError::NameInvalid {
            detail: "use letters, digits, '.', '_' or '-', starting with a letter or digit (max 100)"
                .into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::validate_name;

    #[test]
    fn validates_names() {
        assert!(validate_name("my-project").is_ok());
        assert!(validate_name("Proj.que_2").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name("-flag").is_err());
        assert!(validate_name(".hidden").is_err());
        assert!(validate_name("has space").is_err());
        assert!(validate_name("semi;colon").is_err());
        assert!(validate_name(&"x".repeat(101)).is_err());
    }
}
