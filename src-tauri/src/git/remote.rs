//! Repository URL normalization. Version 1 recognizes GitHub only, per the
//! product spec; other providers slot in as additional match arms.

/// Convert a git remote URL into a browser URL, or None when the host is not
/// recognized (the UI then hides the Repository button).
pub fn normalize_repository_url(remote: &str) -> Option<String> {
    let remote = remote.trim();
    let path = if let Some(rest) = remote.strip_prefix("git@github.com:") {
        rest
    } else if let Some(rest) = remote.strip_prefix("ssh://git@github.com/") {
        rest
    } else if let Some(rest) = remote.strip_prefix("https://github.com/") {
        rest
    } else {
        remote.strip_prefix("http://github.com/")?
    };
    let path = path.trim_end_matches('/').trim_end_matches(".git");
    if path.is_empty() || path.contains("..") {
        return None;
    }
    Some(format!("https://github.com/{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_common_github_urls() {
        for (input, expected) in [
            ("git@github.com:user/project.git", "https://github.com/user/project"),
            ("git@github.com:user/project", "https://github.com/user/project"),
            ("ssh://git@github.com/user/project.git", "https://github.com/user/project"),
            ("https://github.com/user/project.git", "https://github.com/user/project"),
            ("https://github.com/user/project", "https://github.com/user/project"),
            ("https://github.com/user/project/", "https://github.com/user/project"),
        ] {
            assert_eq!(normalize_repository_url(input).as_deref(), Some(expected));
        }
    }

    #[test]
    fn rejects_unknown_hosts() {
        assert_eq!(normalize_repository_url("git@gitlab.com:user/project.git"), None);
        assert_eq!(normalize_repository_url("https://example.com/user/project"), None);
        assert_eq!(normalize_repository_url(""), None);
    }
}
