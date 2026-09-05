use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::config::SUPPORTED_CONFIG_VERSION;

/// Persisted as `settings.json` in the app config directory. Human-editable:
/// every field has a default so hand-edited files with missing fields still
/// load, and unknown fields are tolerated (forward compatibility).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_version")]
    pub config_version: u32,
    #[serde(default)]
    pub project_roots: Vec<PathBuf>,
    #[serde(default = "default_scan_depth")]
    pub scan_depth: u8,
    #[serde(default = "default_editor")]
    pub editor: ToolConfig,
    #[serde(default = "default_terminal")]
    pub terminal: ToolConfig,
    #[serde(default = "default_agent")]
    pub agent: ToolConfig,
    #[serde(default)]
    pub display: DisplaySettings,
    #[serde(default)]
    pub notifications: NotificationSettings,
    /// Extra PATH entries for resolving launcher programs. File-only escape
    /// hatch - the UI never sets this.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub path_additions: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            config_version: default_version(),
            project_roots: Vec::new(),
            scan_depth: default_scan_depth(),
            editor: default_editor(),
            terminal: default_terminal(),
            agent: default_agent(),
            display: DisplaySettings::default(),
            notifications: NotificationSettings::default(),
            path_additions: Vec::new(),
        }
    }
}

/// One configured tool (editor, terminal, or agent). The UI can only set
/// `kind`, chosen from the static launcher catalog. `command`/`args` are
/// honored when hand-written in settings.json (same trust level as the
/// user's shell rc) but are exec'd as argv, never through a shell.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolConfig {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
}

impl ToolConfig {
    fn of(kind: &str) -> Self {
        Self { kind: kind.to_string(), command: None, args: Vec::new() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySettings {
    #[serde(default)]
    pub show_archived: bool,
    #[serde(default)]
    pub theme: Theme,
}

/// System notifications (agent finished / waiting, test verdicts). In-app
/// toasts and the inbox are unaffected by these.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    #[serde(default = "default_true")]
    pub system: bool,
    /// Suppress system notifications between quiet_from and quiet_to (hours, local time).
    #[serde(default)]
    pub quiet_hours: bool,
    #[serde(default = "default_quiet_from")]
    pub quiet_from: u8,
    #[serde(default = "default_quiet_to")]
    pub quiet_to: u8,
}

fn default_true() -> bool {
    true
}
fn default_quiet_from() -> u8 {
    22
}
fn default_quiet_to() -> u8 {
    8
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self { system: true, quiet_hours: false, quiet_from: 22, quiet_to: 8 }
    }
}

impl NotificationSettings {
    /// Whether a system notification may be shown at `hour` (0-23).
    pub fn allows_at(&self, hour: u8) -> bool {
        if !self.system {
            return false;
        }
        if !self.quiet_hours || self.quiet_from == self.quiet_to {
            return true;
        }
        let quiet = if self.quiet_from < self.quiet_to {
            hour >= self.quiet_from && hour < self.quiet_to
        } else {
            hour >= self.quiet_from || hour < self.quiet_to
        };
        !quiet
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

fn default_version() -> u32 {
    SUPPORTED_CONFIG_VERSION
}

fn default_scan_depth() -> u8 {
    3
}

fn default_editor() -> ToolConfig {
    ToolConfig::of("vscode")
}

fn default_terminal() -> ToolConfig {
    if cfg!(target_os = "macos") {
        ToolConfig::of("macos-terminal")
    } else if cfg!(target_os = "windows") {
        ToolConfig::of("windows-terminal")
    } else {
        ToolConfig::of("gnome-terminal")
    }
}

fn default_agent() -> ToolConfig {
    ToolConfig::of("claude")
}

#[cfg(test)]
mod notification_tests {
    use super::NotificationSettings;

    #[test]
    fn quiet_hours_wrap_past_midnight() {
        let n = NotificationSettings { system: true, quiet_hours: true, quiet_from: 22, quiet_to: 8 };
        assert!(!n.allows_at(23));
        assert!(!n.allows_at(3));
        assert!(!n.allows_at(7));
        assert!(n.allows_at(8));
        assert!(n.allows_at(12));
        assert!(n.allows_at(21));
    }

    #[test]
    fn quiet_hours_same_day_and_off_switch() {
        let n = NotificationSettings { system: true, quiet_hours: true, quiet_from: 9, quiet_to: 17 };
        assert!(!n.allows_at(12));
        assert!(n.allows_at(18));
        let off = NotificationSettings { system: false, ..n.clone() };
        assert!(!off.allows_at(18));
        let disabled = NotificationSettings { quiet_hours: false, ..n };
        assert!(disabled.allows_at(12));
    }
}
