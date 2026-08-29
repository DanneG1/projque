use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Persisted in `projects.json` — kept byte-compatible with the shape in the
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
}
