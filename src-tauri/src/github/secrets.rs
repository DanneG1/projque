//! Pre-publish secrets scan. Publishing makes the repository public, and the
//! audience ProjQue serves pastes API keys into source files - so every file
//! that would be pushed (`git ls-files -co --exclude-standard`: tracked plus
//! untracked-but-not-ignored) is checked for high-signal credential shapes
//! before the first push. Deliberately precise over exhaustive: every
//! pattern here is a near-certain secret, so a finding can hard-block the
//! publish without false-positive fatigue.

use std::path::Path;

use serde::Serialize;

use crate::error::AppError;

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_FILES: usize = 5000;
const MAX_FINDINGS: usize = 50;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SecretFinding {
    /// Repository-relative path - display only, never used to open anything.
    pub file: String,
    /// 1-based line, 0 when the finding is about the file itself.
    pub line: u32,
    pub kind: String,
}

/// Fixed-prefix token patterns: (label, prefix, allowed charset test, min length after prefix).
type Charset = fn(char) -> bool;
const TOKEN_PATTERNS: &[(&str, &str, Charset, usize)] = &[
    ("AWS access key", "AKIA", |c| c.is_ascii_uppercase() || c.is_ascii_digit(), 16),
    ("GitHub token", "ghp_", |c| c.is_ascii_alphanumeric(), 36),
    ("GitHub token", "gho_", |c| c.is_ascii_alphanumeric(), 36),
    ("GitHub token", "github_pat_", |c| c.is_ascii_alphanumeric() || c == '_', 22),
    ("Anthropic API key", "sk-ant-", |c| c.is_ascii_alphanumeric() || c == '-' || c == '_', 20),
    ("OpenAI API key", "sk-proj-", |c| c.is_ascii_alphanumeric() || c == '-' || c == '_', 20),
    ("Slack token", "xoxb-", |c| c.is_ascii_alphanumeric() || c == '-', 10),
    ("Slack token", "xoxp-", |c| c.is_ascii_alphanumeric() || c == '-', 10),
    ("Google API key", "AIza", |c| c.is_ascii_alphanumeric() || c == '_' || c == '-', 35),
    ("Stripe secret key", "sk_live_", |c| c.is_ascii_alphanumeric(), 20),
];

/// Scan everything `git push` would publish. Returns at most MAX_FINDINGS.
pub fn scan(dir: &Path) -> Result<Vec<SecretFinding>, AppError> {
    let out = crate::git::runner::git_env(dir, &["ls-files", "-co", "--exclude-standard", "-z"], &[])?;
    if !out.success {
        return Err(AppError::GitFailed { detail: out.stderr.trim().lines().take(3).collect::<Vec<_>>().join(" ") });
    }
    let rels: Vec<&str> = out.stdout.split('\0').filter(|s| !s.is_empty()).collect();
    Ok(scan_paths(dir, &rels))
}

/// Scan the given repository-relative paths (e.g. what a commit would add).
/// Paths come from git's own status output, never from the frontend.
pub fn scan_paths(dir: &Path, rels: &[&str]) -> Vec<SecretFinding> {
    let mut findings = Vec::new();
    for rel in rels.iter().copied().take(MAX_FILES) {
        if findings.len() >= MAX_FINDINGS {
            break;
        }
        if let Some(kind) = env_file_kind(rel) {
            findings.push(SecretFinding { file: rel.to_string(), line: 0, kind });
            continue;
        }
        let path = dir.join(rel);
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        // Binary files can't be scanned line-wise; skip them.
        if bytes[..bytes.len().min(8000)].contains(&0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        scan_content(rel, &content, &mut findings);
    }
    findings
}

/// A committed dotenv file is a finding by itself (templates excluded).
fn env_file_kind(rel: &str) -> Option<String> {
    let base = rel.rsplit('/').next().unwrap_or(rel);
    let is_env = base == ".env" || base.starts_with(".env.");
    if !is_env {
        return None;
    }
    let suffix = base.strip_prefix(".env.").unwrap_or("");
    if matches!(suffix, "example" | "sample" | "template" | "dist" | "test") {
        return None;
    }
    Some("environment file (often contains passwords and API keys)".to_string())
}

/// Documentation example keys and test fixtures are not secrets: AWS's own
/// `AKIAIOSFODNN7EXAMPLE`, anything spelling out EXAMPLE/PLACEHOLDER/XXXX,
/// keyboard-sequence fillers like `0123456789abcdef…`, or a "key" made of
/// three or fewer distinct characters. Real credentials are random.
fn looks_like_placeholder(token: &str) -> bool {
    let upper = token.to_ascii_uppercase();
    if ["EXAMPLE", "PLACEHOLDER", "XXXXXX", "REDACTED", "YOUR_", "CHANGEME"]
        .iter()
        .any(|m| upper.contains(m))
    {
        return true;
    }
    let chars: Vec<char> = token.chars().collect();
    let distinct: std::collections::HashSet<&char> = chars.iter().collect();
    if distinct.len() <= 3 {
        return true;
    }
    // Eight or more consecutive ascending characters (0123…, abcd…).
    let mut ascending = 1;
    for w in chars.windows(2) {
        if (w[1] as u32) == (w[0] as u32) + 1 {
            ascending += 1;
            if ascending >= 8 {
                return true;
            }
        } else {
            ascending = 1;
        }
    }
    false
}

pub(crate) fn scan_content(rel: &str, content: &str, findings: &mut Vec<SecretFinding>) {
    for (line_idx, line) in content.lines().enumerate() {
        if findings.len() >= MAX_FINDINGS {
            return;
        }
        if line.contains("PRIVATE KEY-----") && line.contains("-----BEGIN") {
            findings.push(SecretFinding {
                file: rel.to_string(),
                line: (line_idx + 1) as u32,
                kind: "private key".to_string(),
            });
            continue;
        }
        for (label, prefix, charset, min_len) in TOKEN_PATTERNS {
            if let Some(pos) = line.find(prefix) {
                let tail = &line[pos + prefix.len()..];
                let token: String = tail.chars().take_while(|&c| charset(c)).collect();
                let run = token.chars().count();
                if run >= *min_len && !looks_like_placeholder(&token) {
                    findings.push(SecretFinding {
                        file: rel.to_string(),
                        line: (line_idx + 1) as u32,
                        kind: (*label).to_string(),
                    });
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn findings_in(content: &str) -> Vec<SecretFinding> {
        let mut f = Vec::new();
        scan_content("test.txt", content, &mut f);
        f
    }

    // Fixtures are assembled with concat! so this source file itself never
    // contains a credential-shaped literal - otherwise committing the
    // scanner's own tests through ProjQue would trip the scanner.
    #[test]
    fn detects_token_shapes() {
        assert_eq!(findings_in(concat!("key = AKIA", "JQ7RJ2K9M3XB5W1C")).len(), 1);
        assert_eq!(
            findings_in(concat!("token: ghp_", "q8Zr2mV7kL0pT4wY9sN6bH1cJ3xF5dG8aQ2e")).len(),
            1
        );
        assert_eq!(findings_in(concat!("ANTHROPIC=sk-ant-", "api03-Qm7xR2pL9vT4wZ1nK8bY")).len(), 1);
        assert_eq!(findings_in(concat!("-----BEGIN OPENSSH PRIVATE KEY", "-----")).len(), 1);
    }

    #[test]
    fn ignores_short_and_plain_text() {
        assert!(findings_in("the sky is blue, AKIA is a prefix").is_empty());
        assert!(findings_in("sk-ant- is the Anthropic key prefix").is_empty());
        assert!(findings_in("no secrets here").is_empty());
    }

    /// Documentation examples and fixtures must not block a commit of the
    /// scanner's own tests (or anyone's docs).
    #[test]
    fn ignores_placeholders() {
        assert!(findings_in(concat!("key = AKIA", "IOSFODNN7EXAMPLE")).is_empty());
        assert!(findings_in(concat!("token: ghp_", "0123456789abcdef0123456789abcdef0123")).is_empty());
        assert!(findings_in(concat!("ANTHROPIC=sk-ant-", "api03-abcdefghijklmnopqrst")).is_empty());
        assert!(findings_in(concat!("STRIPE=sk_live_", "XXXXXXXXXXXXXXXXXXXXXXXX")).is_empty());
        assert!(findings_in(concat!("KEY=sk-proj-", "YOUR_KEY_HERE_YOUR_KEY_HERE")).is_empty());
    }

    #[test]
    fn env_file_names() {
        assert!(env_file_kind(".env").is_some());
        assert!(env_file_kind("api/.env.production").is_some());
        assert!(env_file_kind(".env.example").is_none());
        assert!(env_file_kind("src/main.rs").is_none());
    }
}
