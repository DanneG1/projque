//! Parsing of `git status --porcelain=v1 -b` output.

#[derive(Debug, Default, Clone)]
pub struct StatusInfo {
    pub branch: Option<String>,
    pub detached: bool,
    pub changed_files: u32,
    pub has_untracked: bool,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

pub fn parse_status(raw: &str) -> StatusInfo {
    let mut info = StatusInfo::default();
    for line in raw.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            parse_header(header, &mut info);
        } else if !line.is_empty() {
            info.changed_files += 1;
            if line.starts_with("??") {
                info.has_untracked = true;
            }
        }
    }
    info
}

fn parse_header(header: &str, info: &mut StatusInfo) {
    if header.starts_with("HEAD (no branch)") {
        info.detached = true;
        return;
    }
    // "No commits yet on main" (fresh init)
    if let Some(rest) = header.strip_prefix("No commits yet on ") {
        info.branch = Some(rest.trim().to_string());
        return;
    }
    // "main...origin/main [ahead 1, behind 2]" | "main...origin/main" | "main"
    let name_part = header.split("...").next().unwrap_or(header);
    info.branch = Some(name_part.trim().to_string());
    if let Some(bracket) = header.split('[').nth(1).and_then(|s| s.strip_suffix(']')) {
        for token in bracket.split(',') {
            let token = token.trim();
            if let Some(n) = token.strip_prefix("ahead ").and_then(|n| n.parse().ok()) {
                info.ahead = Some(n);
            }
            if let Some(n) = token.strip_prefix("behind ").and_then(|n| n.parse().ok()) {
                info.behind = Some(n);
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub timestamp: i64,
}

/// Parse `git log -1 --pretty=format:%H%n%h%n%s%n%ct`.
pub fn parse_last_commit(raw: &str) -> Option<CommitInfo> {
    let mut lines = raw.lines();
    let hash = lines.next()?.trim().to_string();
    let short_hash = lines.next()?.trim().to_string();
    let subject = lines.next().unwrap_or("").trim().to_string();
    let timestamp = lines.next()?.trim().parse().ok()?;
    if hash.is_empty() {
        return None;
    }
    Some(CommitInfo { hash, short_hash, subject, timestamp })
}
