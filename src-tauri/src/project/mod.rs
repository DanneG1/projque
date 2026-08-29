pub mod docs;
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
    let readme = path_exists
        .then(|| docs::find_doc(path, docs::DocKind::Readme, None))
        .flatten();
    let roadmap = path_exists
        .then(|| docs::find_doc(path, docs::DocKind::Roadmap, project.roadmap_file.as_deref()))
        .flatten();
    let resolved_description = match project.description_source {
        DescriptionSource::Custom => project.description.clone(),
        DescriptionSource::Readme => readme
            .as_deref()
            .and_then(|p| docs::read_doc(p).ok())
            .and_then(|(markdown, _)| docs::first_paragraph(&markdown)),
        DescriptionSource::None => None,
    };
    let has_run_targets = path_exists
        && (path.join("package.json").is_file()
            || path.join("Cargo.toml").is_file()
            || path.join("go.mod").is_file()
            || crate::run::has_dotnet_project(path));
    ProjectView {
        project: project.clone(),
        path_exists,
        is_git_repo,
        has_readme: readme.is_some(),
        has_roadmap: roadmap.is_some(),
        has_run_targets,
        resolved_description,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_kebab_and_collision_safe() {
        assert_eq!(slug_id("Gusta Draw", &[]), "gusta-draw");
        assert_eq!(slug_id("Gusta Draw", &["gusta-draw"]), "gusta-draw-2");
        assert_eq!(slug_id("Gusta Draw", &["gusta-draw", "gusta-draw-2"]), "gusta-draw-3");
        assert_eq!(slug_id("...", &[]), "project");
        assert_eq!(slug_id("Ünïcode & Co.", &[]), "n-code-co");
    }
}
