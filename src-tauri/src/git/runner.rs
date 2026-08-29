//! The single place a `git` process is spawned. Argv-only (no shell), cwd
//! pinned to the repository, hardened environment so git can never prompt,
//! touch the network, or take locks in the user's repo, and a watchdog so a
//! pathological repository cannot hang the app.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::AppError;

const TIMEOUT: Duration = Duration::from_secs(5);

pub struct GitOutput {
    pub success: bool,
    pub stdout: String,
}

pub fn git(dir: &Path, args: &[&str]) -> Result<GitOutput, AppError> {
    let mut child = Command::new("git")
        .arg("--no-optional-locks")
        .args(args)
        .current_dir(dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_ASKPASS", "")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::GitUnavailable
            } else {
                AppError::GitFailed { detail: e.to_string() }
            }
        })?;

    // Drain stdout on a separate thread so a full pipe can never deadlock
    // the timeout loop below.
    let mut stdout_pipe = child.stdout.take().expect("stdout was piped");
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if started.elapsed() > TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AppError::GitFailed { detail: "git timed out".into() });
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(AppError::GitFailed { detail: e.to_string() }),
        }
    };

    let stdout = reader.join().unwrap_or_default();
    Ok(GitOutput {
        success: status.success(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
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
