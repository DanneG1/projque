use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Persisted in `projects.json` - kept byte-compatible with the shape in the
/// product spec so hand-editing and backups stay trivial. Derived data lives
/// in `ProjectView`, never here.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    #[serde(default)]
    pub status: ProjectStatus,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub description_source: DescriptionSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roadmap_file: Option<String>,
    /// Where this project runs for real. Set by hand or automatically by a
    /// successful publish. Presence = "shipped to production".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub production_url: Option<String>,
    /// Free-form labels ("client", "hobby", "tool") for filtering. Validated
    /// in project_update: lowercase, short, letters/digits/dash only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Last "Run tests" outcome, stamped by the backend when a test run
    /// session exits. Presence = the project has been checked at least once.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_verified: Option<Verification>,
    /// When the "Tidy up the code" agent was last started, and the commit it
    /// started from - the baseline the tidy-up nudge counts churn against.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_cleanup: Option<Cleanup>,
    /// Last dependency vulnerability check (npm/pnpm audit), stamped in Rust.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_audit: Option<AuditStamp>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuditStamp {
    pub at: i64,
    pub total: u32,
    pub fixable: u32,
    pub critical: u32,
    pub high: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    pub at: i64,
    pub commit: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    pub at: i64,
    pub passed: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Idea,
    #[default]
    Active,
    Paused,
    Maintenance,
    Done,
    Archived,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DescriptionSource {
    Custom,
    Readme,
    #[default]
    None,
}

/// Runtime view returned to the UI: persisted fields flattened together with
/// cheap derived facts.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    pub project: Project,
    pub path_exists: bool,
    pub is_git_repo: bool,
    pub has_readme: bool,
    pub has_roadmap: bool,
    pub has_ideas: bool,
    pub has_run_targets: bool,
    /// A package-manager project the built-in vulnerability check supports
    /// (drives the "long time since a package check" suggestion).
    pub auditable: bool,
    pub resolved_description: Option<String>,
}

/// Partial update sent by the UI. Empty strings clear optional fields.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub status: Option<ProjectStatus>,
    pub favorite: Option<bool>,
    pub description: Option<String>,
    pub description_source: Option<DescriptionSource>,
    pub roadmap_file: Option<String>,
    pub production_url: Option<String>,
    pub tags: Option<Vec<String>>,
}
