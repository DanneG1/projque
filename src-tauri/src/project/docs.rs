//! README / ROADMAP discovery and reading. All reads are confined to the
//! project directory: a configured roadmap path is canonicalized and must
//! still resolve inside the (canonical) project dir, which also defeats
//! symlink escapes. Content is size-capped and treated as untrusted — the
//! frontend renders it through a sanitizing markdown pipeline.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MAX_DOC_BYTES: usize = 512 * 1024;

const ROADMAP_NAMES: &[&str] = &["ROADMAP.md", "roadmap.md", "Roadmap.md"];
const README_NAMES: &[&str] = &["README.md", "readme.md", "Readme.md"];
const IDEAS_NAMES: &[&str] = &["IDEAS.md", "ideas.md", "Ideas.md"];

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DocKind {
    Roadmap,
    Readme,
    Ideas,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocument {
    pub file_name: String,
    pub markdown: String,
    pub truncated: bool,
}

/// Locate the document for a project. `configured` (roadmap only) overrides
/// the default name variants.
pub fn find_doc(dir: &Path, kind: DocKind, configured: Option<&str>) -> Option<PathBuf> {
    if let (DocKind::Roadmap, Some(rel)) = (kind, configured) {
        return resolve_inside(dir, rel);
    }
    let names = match kind {
        DocKind::Roadmap => ROADMAP_NAMES,
        DocKind::Readme => README_NAMES,
        DocKind::Ideas => IDEAS_NAMES,
    };
    // Every candidate — default names included — goes through the same
    // containment check, so a `README.md` symlink pointing outside the
    // project (e.g. -> /etc/passwd in a hostile repo) is never read.
    names.iter().find_map(|n| resolve_inside(dir, n))
}

/// Canonicalize `dir/rel` and require the result to stay inside `dir`.
/// Canonicalization resolves symlinks, so a link whose target escapes the
/// project directory fails the `starts_with` check.
fn resolve_inside(dir: &Path, rel: &str) -> Option<PathBuf> {
    let dir = std::fs::canonicalize(dir).ok()?;
    let candidate = std::fs::canonicalize(dir.join(rel)).ok()?;
    (candidate.starts_with(&dir) && candidate.is_file()).then_some(candidate)
}

/// Read a document with the size cap applied on a char boundary.
pub fn read_doc(path: &Path) -> std::io::Result<(String, bool)> {
    let raw = std::fs::read_to_string(path)?;
    if raw.len() <= MAX_DOC_BYTES {
        return Ok((raw, false));
    }
    let mut end = MAX_DOC_BYTES;
    while !raw.is_char_boundary(end) {
        end -= 1;
    }
    Ok((raw[..end].to_string(), true))
}

/// Extract the first meaningful paragraph of a README for use as a project
/// description: skips headings, badges, images, HTML and code fences.
pub fn first_paragraph(markdown: &str) -> Option<String> {
    let mut in_fence = false;
    let mut paragraph: Vec<&str> = Vec::new();
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let skip = trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with('>')
            || trimmed.starts_with("![")
            || trimmed.starts_with('<')
            || trimmed.starts_with("---")
            || trimmed.starts_with("===")
            || trimmed.starts_with("[!");
        if skip {
            if !paragraph.is_empty() {
                break;
            }
            continue;
        }
        paragraph.push(trimmed);
    }
    if paragraph.is_empty() {
        return None;
    }
    let mut text = paragraph.join(" ");
    // Reduce [label](url) links to their label for the one-line summary.
    while let (Some(open), Some(mid)) = (text.find('['), text.find("](")) {
        if open < mid {
            if let Some(close_rel) = text[mid..].find(')') {
                let label = text[open + 1..mid].to_string();
                text.replace_range(open..mid + close_rel + 1, &label);
                continue;
            }
        }
        break;
    }
    text = text.replace("**", "").replace('`', "");
    if text.chars().count() > 220 {
        text = text.chars().take(219).collect::<String>() + "…";
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_paragraph_skips_headings_badges_and_fences() {
        let md = "# Title\n\n[![CI](https://x/badge.svg)](https://x)\n\n```sh\nnpm i\n```\n\nThe **actual** [description](https://example.com) here.\nSecond line.\n\nNext paragraph.";
        assert_eq!(
            first_paragraph(md).as_deref(),
            Some("The actual description here. Second line.")
        );
    }

    #[test]
    fn first_paragraph_empty_for_headings_only() {
        assert_eq!(first_paragraph("# Just a title\n\n## And more"), None);
    }

    #[cfg(unix)]
    #[test]
    fn default_readme_symlink_escaping_project_is_rejected() {
        use std::fs;
        let base = std::env::temp_dir().join(format!("projque-docs-{}", std::process::id()));
        let project = base.join("project");
        let outside = base.join("secret.txt");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&project).unwrap();
        fs::write(&outside, "TOP SECRET").unwrap();
        // README.md is a symlink pointing outside the project directory.
        std::os::unix::fs::symlink(&outside, project.join("README.md")).unwrap();
        assert_eq!(find_doc(&project, DocKind::Readme, None), None);

        // A real in-project README is still found.
        fs::remove_file(project.join("README.md")).unwrap();
        fs::write(project.join("README.md"), "# ok").unwrap();
        assert!(find_doc(&project, DocKind::Readme, None).is_some());
        let _ = fs::remove_dir_all(&base);
    }
}
