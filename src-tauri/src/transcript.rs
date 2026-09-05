//! Agent session transcripts: the terminal scrollback of every finished
//! agent session, saved under the app config dir (never inside the
//! project - transcripts can contain anything the agent printed, including
//! secrets it read), listed per project, and summarized on request through
//! the user's own Claude CLI.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::agent::AgentSessionView;
use crate::error::AppError;

const KEEP_PER_PROJECT: usize = 30;
/// How much of a transcript goes to the summarizer (the tail - that is
/// where the agent's own wrap-up lives).
const SUMMARY_INPUT_BYTES: usize = 48 * 1024;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptMeta {
    /// File name (the delete/summarize key); never a path.
    pub file: String,
    pub agent_label: String,
    pub started_at: i64,
    pub bytes: u64,
    pub summary: Option<String>,
}

fn dir_for(config_dir: &Path, project_id: &str) -> PathBuf {
    config_dir.join("transcripts").join(safe_component(project_id))
}

/// Project ids are kebab-case slugs already; this keeps a corrupted config
/// from ever producing a path component with separators.
fn safe_component(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).take(80).collect()
}

fn valid_file(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && name.ends_with(".log")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.contains("..")
}

/// Save a finished agent session's scrollback. Errors are swallowed by the
/// caller - a transcript is a convenience, never a reason to fail an exit.
pub fn save(config_dir: &Path, view: &AgentSessionView, scrollback: &[u8]) -> std::io::Result<()> {
    if scrollback.is_empty() {
        return Ok(());
    }
    let dir = dir_for(config_dir, &view.project_id);
    std::fs::create_dir_all(&dir)?;
    let agent = safe_component(&view.agent_kind);
    let file = format!("{}-{agent}-{}.log", view.started_at, safe_component(&view.session_id));
    std::fs::write(dir.join(file), scrollback)?;
    prune(&dir);
    Ok(())
}

fn prune(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut logs: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("log"))
        .collect();
    logs.sort();
    while logs.len() > KEEP_PER_PROJECT {
        let old = logs.remove(0);
        let _ = std::fs::remove_file(summary_path(&old));
        let _ = std::fs::remove_file(old);
    }
}

fn summary_path(log: &Path) -> PathBuf {
    log.with_extension("summary.txt")
}

pub fn list(config_dir: &Path, project_id: &str) -> Vec<TranscriptMeta> {
    let dir = dir_for(config_dir, project_id);
    let Ok(rd) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut out: Vec<TranscriptMeta> = rd
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let file = path.file_name()?.to_str()?.to_string();
            if !valid_file(&file) {
                return None;
            }
            let mut parts = file.trim_end_matches(".log").splitn(3, '-');
            let started_at: i64 = parts.next()?.parse().ok()?;
            let agent = parts.next().unwrap_or("agent").to_string();
            let bytes = e.metadata().ok()?.len();
            let summary = std::fs::read_to_string(summary_path(&path)).ok().filter(|s| !s.trim().is_empty());
            Some(TranscriptMeta { file, agent_label: agent, started_at, bytes, summary })
        })
        .collect();
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    out
}

/// Terminal output minus escape sequences (CSI, OSC, single-char escapes)
/// and carriage-return overwrites, so the summarizer sees prose.
pub fn strip_ansi(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.next() {
                Some('[') => {
                    // CSI: parameters/intermediates, then a final byte 0x40-0x7e
                    while let Some(&n) = chars.peek() {
                        chars.next();
                        if ('\u{40}'..='\u{7e}').contains(&n) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    // OSC: until BEL or ESC \
                    while let Some(n) = chars.next() {
                        if n == '\u{7}' {
                            break;
                        }
                        if n == '\u{1b}' {
                            chars.next();
                            break;
                        }
                    }
                }
                Some(_) | None => {}
            }
            continue;
        }
        if c == '\r' || c == '\u{7}' {
            continue;
        }
        if c.is_control() && c != '\n' && c != '\t' {
            continue;
        }
        out.push(c);
    }
    // Collapse the spinner/redraw noise: runs of blank lines.
    let mut collapsed = String::with_capacity(out.len());
    let mut blank = 0;
    for line in out.lines() {
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        collapsed.push_str(line.trim_end());
        collapsed.push('\n');
    }
    collapsed
}

/// Plain-language summary of one transcript, cached next to it.
pub fn summarize(
    config_dir: &Path,
    project_dir: &Path,
    project_id: &str,
    file: &str,
    path_additions: &[String],
) -> Result<String, AppError> {
    if !valid_file(file) {
        return Err(AppError::InvalidInput { detail: "unknown transcript".into() });
    }
    let path = dir_for(config_dir, project_id).join(file);
    let bytes = std::fs::read(&path).map_err(|_| AppError::PathMissing { path: file.to_string() })?;
    let mut text = strip_ansi(&bytes);
    if text.len() > SUMMARY_INPUT_BYTES {
        let mut cut = text.len() - SUMMARY_INPUT_BYTES;
        while !text.is_char_boundary(cut) {
            cut += 1;
        }
        text = format!("[earlier part of the session omitted]\n{}", &text[cut..]);
    }
    let prompt = format!(
        "Below is the terminal transcript of a coding-agent session in this project. Summarize for \
         someone who is not a programmer, in 3-6 short bullet points: what was asked, what the agent \
         changed or did, and anything left unfinished or worth checking. Plain language, no file \
         paths unless essential. Do not change any files.\n\n---\n{text}\n---"
    );
    let summary = crate::assist::run_claude_pub(project_dir, &prompt, path_additions)?;
    let _ = std::fs::write(summary_path(&path), &summary);
    Ok(summary)
}

pub fn delete(config_dir: &Path, project_id: &str, file: &str) -> Result<(), AppError> {
    if !valid_file(file) {
        return Err(AppError::InvalidInput { detail: "unknown transcript".into() });
    }
    let path = dir_for(config_dir, project_id).join(file);
    let _ = std::fs::remove_file(summary_path(&path));
    std::fs::remove_file(&path).map_err(|e| AppError::Io { detail: e.to_string() })
}

pub fn folder(config_dir: &Path, project_id: &str) -> PathBuf {
    dir_for(config_dir, project_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_escape_sequences_and_collapses_noise() {
        let raw = b"\x1b[32mHello\x1b[0m world\r\n\x1b]0;title\x07\n\n\n\x1b[2K\rDone.\n";
        let s = strip_ansi(raw);
        assert_eq!(s, "Hello world\n\nDone.\n");
    }

    #[test]
    fn file_names_are_validated() {
        assert!(valid_file("1725000000-claude-s1.log"));
        assert!(!valid_file("../x.log"));
        assert!(!valid_file("a/b.log"));
        assert!(!valid_file("x.txt"));
    }
}
