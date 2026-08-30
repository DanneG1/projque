//! The single place a `git` process is spawned. Argv-only (no shell), cwd
//! pinned to the repository, hardened environment so git can never prompt or
//! take locks in the user's repo, and a watchdog so a pathological
//! repository (or a stalled network transfer) cannot hang the app.
//!
//! Two timeout classes: local read/switch operations use the 5s default;
//! the explicit user-initiated network operations (fetch, pull) use 120s
//! plus SSH BatchMode so a passphrase prompt fails in milliseconds instead
//! of eating the timeout.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::AppError;

const LOCAL_TIMEOUT: Duration = Duration::from_secs(5);
pub const NET_TIMEOUT: Duration = Duration::from_secs(120);

pub struct GitOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Local (non-network) git invocation with the default 5s watchdog.
pub fn git(dir: &Path, args: &[&str]) -> Result<GitOutput, AppError> {
    git_with_timeout(dir, args, LOCAL_TIMEOUT, false)
}

/// Local git invocation with extra environment variables (e.g. a scratch
/// GIT_INDEX_FILE for snapshots, or identity fallbacks for plumbing commits).
/// Longer watchdog: populating a fresh scratch index re-hashes every file.
pub fn git_env(dir: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<GitOutput, AppError> {
    git_full(dir, args, Duration::from_secs(30), false, envs)
}

pub fn git_with_timeout(
    dir: &Path,
    args: &[&str],
    timeout: Duration,
    net: bool,
) -> Result<GitOutput, AppError> {
    git_full(dir, args, timeout, net, &[])
}

fn git_full(
    dir: &Path,
    args: &[&str],
    timeout: Duration,
    net: bool,
    envs: &[(&str, &str)],
) -> Result<GitOutput, AppError> {
    let mut cmd = Command::new("git");
    cmd.arg("--no-optional-locks")
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_ASKPASS", "")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if net {
        // Fail fast on interactive SSH auth instead of stalling: fetch/pull
        // require non-interactive credentials (ssh-agent / credential helper).
        cmd.env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes");
    }
    for (key, value) in envs {
        cmd.env(key, value);
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::GitUnavailable
        } else {
            AppError::GitFailed { detail: e.to_string() }
        }
    })?;

    // Drain both pipes on separate threads so a full pipe can never deadlock
    // the timeout loop below.
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
                    return Err(AppError::GitFailed { detail: "git timed out".into() });
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(AppError::GitFailed { detail: e.to_string() }),
        }
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    Ok(GitOutput {
        success: status.success(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

/// Probe once whether git exists at all (used for graceful degradation).
pub fn version() -> Option<String> {
    let output = Command::new("git")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}
