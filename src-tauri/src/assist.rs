//! Plain-language explanations powered by the user's own Claude Code CLI.
//!
//! `claude --print` is spawned exactly like the embedded agent sessions -
//! the allowlisted binary resolved on the augmented PATH, fixed argv, no
//! shell - but headless: one prompt in, one text answer out. It runs only on
//! an explicit click (it spends the user's Claude usage), with cwd pinned to
//! the project so the model has repository context.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::launcher::which;

/// Summaries should feel snappy but Claude may take a while on big diffs.
const SUMMARY_TIMEOUT: Duration = Duration::from_secs(120);
/// Diff budget in the prompt - beyond this the diff is cut and the model is
/// told so. Keeps the call fast and cheap.
const MAX_DIFF_BYTES: usize = 48 * 1024;

/// Summarize the uncommitted changes (worktree vs HEAD) in plain language.
pub fn change_summary(dir: &Path, path_additions: &[String]) -> Result<String, AppError> {
    let diff = uncommitted_diff(dir)?;
    if diff.trim().is_empty() {
        return Ok("No changes since the last commit.".to_string());
    }
    let prompt = format!(
        "Summarize the following uncommitted changes to a software project for someone \
         who is not a programmer. 2-4 short sentences, plain language, no jargon, no file \
         paths unless essential. Describe what changed in terms of what the project does. \
         Then on a final line output exactly: SUGGESTED COMMIT MESSAGE: <a concise one-line \
         description, max 65 characters>.\n\n{diff}"
    );
    run_claude(dir, &prompt, path_additions)
}

/// Explain error-shaped terminal output in plain language, with a short
/// suggestion of what to do. `excerpt` is the tail of a run session's own
/// scrollback (read backend-side), never frontend text.
pub fn explain_error(dir: &Path, excerpt: &str, path_additions: &[String]) -> Result<String, AppError> {
    let prompt = format!(
        "The following is the end of the terminal output from running a software project. \
         Explain to someone who is not a programmer what went wrong, in 2-4 short sentences \
         and plain language. Then on a final line output exactly: WHAT TO DO: <one sentence: \
         the most likely fix, or 'ask the agent to fix it' if it needs a code change>. \
         Do not change any files.\n\n---\n{excerpt}\n---"
    );
    run_claude(dir, &prompt, path_additions)
}

/// `git diff HEAD` plus the names of untracked files, capped.
fn uncommitted_diff(dir: &Path) -> Result<String, AppError> {
    let mut text = String::new();
    let diff = crate::git::runner::git_env(dir, &["diff", "HEAD", "--no-color"], &[])?;
    if diff.success {
        text.push_str(&diff.stdout);
    }
    let status = crate::git::runner::git(dir, &["status", "--porcelain=v1", "-uall"])?;
    if status.success {
        let untracked: Vec<&str> = status
            .stdout
            .lines()
            .filter_map(|l| l.strip_prefix("?? "))
            .collect();
        if !untracked.is_empty() {
            text.push_str("\n\nNew files not yet tracked:\n");
            for f in untracked.iter().take(50) {
                text.push_str(f);
                text.push('\n');
            }
        }
    }
    if text.len() > MAX_DIFF_BYTES {
        let mut cut = MAX_DIFF_BYTES;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push_str("\n\n[diff truncated - summarize what is shown]");
    }
    Ok(text)
}

fn run_claude(dir: &Path, prompt: &str, path_additions: &[String]) -> Result<String, AppError> {
    let program = which::resolve_program("claude", path_additions)
        .ok_or_else(|| AppError::ProgramNotFound { program: "claude".into() })?;
    let path_env = which::augmented_path(path_additions);
    let mut child = Command::new(program)
        .arg("--print")
        .arg(prompt)
        .current_dir(dir)
        .env("PATH", path_env)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::LaunchFailed { program: "claude".into(), detail: e.to_string() })?;

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
                if started.elapsed() > SUMMARY_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AppError::LaunchFailed {
                        program: "claude".into(),
                        detail: "summary timed out".into(),
                    });
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                return Err(AppError::LaunchFailed { program: "claude".into(), detail: e.to_string() })
            }
        }
    };

    let stdout = String::from_utf8_lossy(&stdout_reader.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&stderr_reader.join().unwrap_or_default()).into_owned();
    if !status.success() {
        let detail = stderr.trim().lines().take(3).collect::<Vec<_>>().join(" ");
        return Err(AppError::LaunchFailed {
            program: "claude".into(),
            detail: if detail.is_empty() { "claude exited with an error".into() } else { detail },
        });
    }
    let mut answer = stdout.trim().to_string();
    if answer.len() > 4000 {
        let mut cut = 4000;
        while !answer.is_char_boundary(cut) {
            cut -= 1;
        }
        answer.truncate(cut);
    }
    if answer.is_empty() {
        return Err(AppError::LaunchFailed {
            program: "claude".into(),
            detail: "claude returned no output".into(),
        });
    }
    Ok(answer)
}
