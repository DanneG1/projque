//! Parse and update the checklist in IDEAS.md, the file idea_capture writes
//! (`- [ ] text *(YYYY-MM-DD)*`, continuation lines indented two spaces).
//! Hand-edited files are handled gracefully: anything that isn't a checklist
//! item is simply not an idea, and set_done verifies the addressed line is
//! still an item before rewriting it.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IdeaItem {
    /// 0-based line number of the item's first line - the handle set_done
    /// takes back. Positional, not an opaque ID: validated again on write.
    pub line: u32,
    pub text: String,
    pub done: bool,
    pub date: Option<String>,
}

fn item_prefix(line: &str) -> Option<bool> {
    let trimmed = line.trim_start();
    if let Some(rest) = trimmed.strip_prefix("- [") {
        let mut chars = rest.chars();
        let mark = chars.next()?;
        if chars.next()? == ']' {
            return match mark {
                ' ' => Some(false),
                'x' | 'X' => Some(true),
                _ => None,
            };
        }
    }
    None
}

fn item_text(line: &str) -> &str {
    let trimmed = line.trim_start();
    trimmed.get(5..).unwrap_or("").trim()
}

/// Pull a trailing `*(YYYY-MM-DD)*` off the text.
fn split_date(text: &str) -> (String, Option<String>) {
    if let Some(start) = text.rfind("*(") {
        let candidate = &text[start..];
        if let Some(inner) = candidate.strip_prefix("*(").and_then(|c| c.strip_suffix(")*")) {
            let looks_like_date = inner.len() == 10
                && inner.chars().enumerate().all(|(i, c)| {
                    if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }
                });
            if looks_like_date {
                return (text[..start].trim_end().to_string(), Some(inner.to_string()));
            }
        }
    }
    (text.to_string(), None)
}

pub fn parse(content: &str) -> Vec<IdeaItem> {
    let lines: Vec<&str> = content.lines().collect();
    let mut items = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if let Some(done) = item_prefix(lines[i]) {
            let mut text = item_text(lines[i]).to_string();
            let start = i;
            // Continuation lines: indented, not themselves items.
            while i + 1 < lines.len() {
                let next = lines[i + 1];
                let continuation = next.starts_with("  ")
                    && !next.trim().is_empty()
                    && item_prefix(next).is_none();
                if !continuation {
                    break;
                }
                text.push(' ');
                text.push_str(next.trim());
                i += 1;
            }
            let (text, date) = split_date(&text);
            if !text.is_empty() {
                items.push(IdeaItem { line: start as u32, text, done, date });
            }
        }
        i += 1;
    }
    items
}

/// Toggle the checkbox on the item starting at `line`. Returns the rewritten
/// content, or None when that line is no longer a checklist item (the file
/// changed since it was listed - the caller reports a friendly conflict).
pub fn set_done(content: &str, line: u32, done: bool) -> Option<String> {
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let target = lines.get_mut(line as usize)?;
    item_prefix(target)?;
    let marker_start = target.find("- [")? + 3;
    let mut updated = target.clone();
    updated.replace_range(marker_start..marker_start + 1, if done { "x" } else { " " });
    *target = updated;
    let trailing_newline = content.ends_with('\n');
    let mut result = lines.join("\n");
    if trailing_newline {
        result.push('\n');
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# Ideas\n\n- [ ] Add a dark mode *(2026-08-30)*\n- [x] Fix the login bug *(2026-08-01)*\n- [ ] Multi-line idea\n  with a continuation *(2026-08-15)*\nnot an item\n";

    #[test]
    fn parses_items() {
        let items = parse(SAMPLE);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].text, "Add a dark mode");
        assert_eq!(items[0].date.as_deref(), Some("2026-08-30"));
        assert!(!items[0].done);
        assert!(items[1].done);
        assert_eq!(items[2].text, "Multi-line idea with a continuation");
        assert_eq!(items[2].line, 4);
    }

    #[test]
    fn toggles_done() {
        let updated = set_done(SAMPLE, 2, true).unwrap();
        assert!(updated.contains("- [x] Add a dark mode"));
        let reverted = set_done(&updated, 3, false).unwrap();
        assert!(reverted.contains("- [ ] Fix the login bug"));
        // Line that is not an item -> conflict.
        assert!(set_done(SAMPLE, 0, true).is_none());
        assert!(set_done(SAMPLE, 99, true).is_none());
    }
}
