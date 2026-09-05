//! Time on project: one line per finished session in
//! `<config dir>/sessions.jsonl` (project id, kind, start, end). Local-only
//! bookkeeping for the Progress page; a session counts as time spent on
//! the project it ran in.

use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

const FILE: &str = "sessions.jsonl";
/// Sessions longer than this are capped (a dev server left running
/// overnight is not eight hours of work).
const CAP_SECS: i64 = 4 * 3600;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub project_id: String,
    pub kind: String,
    pub started_at: i64,
    pub ended_at: i64,
}

pub fn record(config_dir: &Path, project_id: &str, kind: &str, started_at: i64, ended_at: i64) {
    if ended_at <= started_at {
        return;
    }
    let rec = SessionRecord {
        project_id: project_id.to_string(),
        kind: kind.to_string(),
        started_at,
        ended_at: ended_at.min(started_at + CAP_SECS),
    };
    let Ok(line) = serde_json::to_string(&rec) else { return };
    let _ = std::fs::create_dir_all(config_dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(config_dir.join(FILE)) {
        let _ = writeln!(f, "{line}");
    }
}

/// All records, oldest first. A corrupt line is skipped, never fatal.
pub fn load(config_dir: &Path) -> Vec<SessionRecord> {
    std::fs::read_to_string(config_dir.join(FILE))
        .map(|t| t.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_caps() {
        let tmp = std::env::temp_dir().join(format!("projque-timelog-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        record(&tmp, "a", "agent", 1000, 1600);
        record(&tmp, "a", "run", 1000, 1000 + 10 * 3600);
        record(&tmp, "b", "agent", 5, 3); // ignored
        let all = load(&tmp);
        assert_eq!(all.len(), 2);
        assert_eq!(all[1].ended_at - all[1].started_at, CAP_SECS);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
