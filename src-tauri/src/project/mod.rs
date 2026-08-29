mod model;

pub use model::*;

use std::path::Path;

/// Derive a stable, human-readable id from a display name:
/// "Gusta Draw" -> "gusta-draw". Collisions get a numeric suffix.
pub fn slug_id(name: &str, taken: &[&str]) -> String {
    let mut slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-');
    let base = if slug.is_empty() { "project" } else { slug };
    if !taken.contains(&base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if !taken.contains(&candidate.as_str()) {
            return candidate;
        }
        n += 1;
    }
}

/// Build the runtime view of a project: the persisted metadata plus cheap
/// derived facts the UI needs in one round trip. Never persisted.
pub fn view(project: &Project) -> ProjectView {
    let path: &Path = &project.path;
    let path_exists = path.is_dir();
    let is_git_repo = path_exists && path.join(".git").exists();
    let resolved_description = match project.description_source {
        DescriptionSource::Custom => project.description.clone(),
        // README extraction lands with the markdown milestone.
        DescriptionSource::Readme => None,
        DescriptionSource::None => None,
    };
    ProjectView {
        project: project.clone(),
        path_exists,
        is_git_repo,
        resolved_description,
    }
}
