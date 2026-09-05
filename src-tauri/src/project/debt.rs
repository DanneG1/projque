//! Code-debt nudge: how much has changed since the code was last tidied.
//! Vibe-coded projects accumulate dead code fast - every agent session adds
//! and rarely removes - so ProjQue counts churn (commits and lines changed)
//! since the last "Tidy up the code" run and suggests another one past a
//! threshold. Read-only git, local only. Phrased as an invitation in the UI,
//! never as a failing grade.

use std::path::Path;

use serde::Serialize;

use crate::git::runner;
use crate::project::Cleanup;

/// Roughly a fortnight of active vibe-coding, or one big feature.
const NUDGE_COMMITS: u32 = 15;
const NUDGE_LINES: u32 = 2000;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DebtInfo {
    pub commits_since: u32,
    pub lines_changed: u32,
    pub files_changed: u32,
    /// Unix time of the last tidy-up, None if never.
    pub last_cleanup_at: Option<i64>,
    /// Churn passed the threshold - worth suggesting a tidy-up.
    pub nudge: bool,
    /// The baseline is the last 30 days rather than a real tidy-up.
    pub window_fallback: bool,
}

fn line(out: runner::GitOutput) -> Option<String> {
    out.success.then(|| out.stdout.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn measure(dir: &Path, cleanup: Option<&Cleanup>) -> DebtInfo {
    let mut info = DebtInfo { last_cleanup_at: cleanup.map(|c| c.at), ..Default::default() };
    if !dir.join(".git").exists() {
        return info;
    }
    // Baseline: the tidy-up's commit if it still exists here, else the
    // oldest commit of the last 30 days.
    let mut base = cleanup
        .and_then(|c| c.commit.as_deref())
        .filter(|h| h.chars().all(|c| c.is_ascii_hexdigit()))
        .and_then(|h| runner::git(dir, &["rev-parse", "--verify", "-q", &format!("{h}^{{commit}}")]).ok())
        .and_then(line);
    if base.is_none() {
        info.window_fallback = true;
        base = runner::git(dir, &["rev-list", "--since=30.days", "--reverse", "--max-count=500", "HEAD"])
            .ok()
            .and_then(line)
            .and_then(|list| list.lines().next().map(str::to_string));
    }
    let Some(base) = base else { return info };

    info.commits_since = runner::git(dir, &["rev-list", "--count", &format!("{base}..HEAD")])
        .ok()
        .and_then(line)
        .and_then(|n| n.parse().ok())
        .unwrap_or(0);
    // In the fallback the base commit itself is part of the window.
    if info.window_fallback {
        info.commits_since += 1;
    }
    let range = if info.window_fallback { format!("{base}^") } else { base.clone() };
    // A root commit has no parent: fall back to the empty tree.
    let range_ok = runner::git(dir, &["rev-parse", "--verify", "-q", &range]).ok().and_then(line).is_some();
    let from = if range_ok { range } else { "4b825dc642cb6eb9a060e54bf8d69288fbee4904".to_string() };
    if let Some(stat) = runner::git(dir, &["diff", "--shortstat", &from, "HEAD"]).ok().and_then(line) {
        let (files, lines) = parse_shortstat(&stat);
        info.files_changed = files;
        info.lines_changed = lines;
    }
    info.nudge = info.commits_since >= NUDGE_COMMITS || info.lines_changed >= NUDGE_LINES;
    info
}

/// " 12 files changed, 340 insertions(+), 120 deletions(-)" -> (12, 460)
fn parse_shortstat(stat: &str) -> (u32, u32) {
    let mut files = 0;
    let mut lines = 0;
    for part in stat.split(',') {
        let part = part.trim();
        let n: u32 = part.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
        if part.contains("file") {
            files = n;
        } else if part.contains("insertion") || part.contains("deletion") {
            lines += n;
        }
    }
    (files, lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_shortstat() {
        assert_eq!(parse_shortstat(" 12 files changed, 340 insertions(+), 120 deletions(-)"), (12, 460));
        assert_eq!(parse_shortstat(" 1 file changed, 2 deletions(-)"), (1, 2));
        assert_eq!(parse_shortstat(""), (0, 0));
    }
}
