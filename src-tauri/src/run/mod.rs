//! Run-target detection: how a project is started, derived exclusively from
//! the project's OWN manifest files (package.json scripts, Cargo.toml,
//! go.mod, *.csproj/*.sln). Nothing here is typed into the UI - the frontend
//! picks an enumerated `target_id`, and launch re-derives this enumeration
//! and requires an exact match (the same validation pattern as git_switch).
//! Running a target executes the project's own code: the identical,
//! user-initiated trust decision as running it in a terminal.

use std::path::Path;

use serde::Serialize;

const MAX_TARGETS: usize = 50;
const DETAIL_MAX: usize = 80;
/// Script names surfaced before the alphabetical rest.
const PREFERRED_SCRIPTS: &[&str] = &["dev", "start", "serve", "watch"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunTarget {
    pub target_id: String,
    pub label: String,
    pub runner: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Enumerate everything this project can run. Pure derivation from files in
/// the project root; safe to call repeatedly (launch-time revalidation).
pub fn detect_targets(dir: &Path) -> Vec<RunTarget> {
    let mut targets = Vec::new();
    detect_package_json(dir, &mut targets);
    if dir.join("Cargo.toml").is_file() {
        targets.push(RunTarget {
            target_id: "cargo:run".into(),
            label: "cargo run".into(),
            runner: "cargo".into(),
            detail: None,
        });
    }
    if dir.join("go.mod").is_file() {
        targets.push(RunTarget {
            target_id: "go:run".into(),
            label: "go run .".into(),
            runner: "go".into(),
            detail: None,
        });
    }
    if has_dotnet_project(dir) {
        targets.push(RunTarget {
            target_id: "dotnet:run".into(),
            label: "dotnet run".into(),
            runner: "dotnet".into(),
            detail: None,
        });
    }
    targets.truncate(MAX_TARGETS);
    targets
}

/// The argv for a detected target. Always an argv array - no shell.
pub fn argv_for(target: &RunTarget) -> (String, Vec<String>) {
    match target.target_id.split_once(':') {
        Some(("pm", script)) => (
            target.runner.clone(),
            vec!["run".to_string(), script.to_string()],
        ),
        Some(("go", _)) => ("go".into(), vec!["run".into(), ".".into()]),
        Some(("dotnet", _)) => ("dotnet".into(), vec!["run".into()]),
        // cargo:run and any future single-verb runner
        _ => (target.runner.clone(), vec!["run".into()]),
    }
}

fn detect_package_json(dir: &Path, targets: &mut Vec<RunTarget>) {
    let Ok(raw) = std::fs::read_to_string(dir.join("package.json")) else { return };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else { return };
    let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) else { return };
    let manager = package_manager(dir);

    let mut names: Vec<(&String, &serde_json::Value)> = scripts
        .iter()
        // Defense in depth: a script name can never look like a flag.
        .filter(|(name, value)| !name.starts_with('-') && value.is_string())
        .collect();
    names.sort_by_key(|(name, _)| {
        let preferred = PREFERRED_SCRIPTS
            .iter()
            .position(|p| p == name)
            .unwrap_or(usize::MAX);
        (preferred, name.to_string())
    });

    for (name, value) in names {
        targets.push(RunTarget {
            target_id: format!("pm:{name}"),
            label: format!("{manager} run {name}"),
            runner: manager.to_string(),
            detail: value.as_str().map(truncate_detail),
        });
    }
}

fn package_manager(dir: &Path) -> &'static str {
    if dir.join("bun.lockb").is_file() || dir.join("bun.lock").is_file() {
        "bun"
    } else if dir.join("pnpm-lock.yaml").is_file() {
        "pnpm"
    } else if dir.join("yarn.lock").is_file() {
        "yarn"
    } else {
        "npm"
    }
}

/// Does this directory look like a project root by its own manifest files?
/// Used by discovery to surface non-git projects (e.g. a folder that hasn't
/// been `git init`'d yet).
pub fn has_manifest(dir: &Path) -> bool {
    const MANIFESTS: &[&str] = &[
        "package.json",
        "Cargo.toml",
        "go.mod",
        "pyproject.toml",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "Gemfile",
        "composer.json",
    ];
    if MANIFESTS.iter().any(|m| dir.join(m).is_file()) {
        return true;
    }
    has_dotnet_project(dir)
}

pub fn has_dotnet_project(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    entries.flatten().any(|entry| {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        name.ends_with(".csproj") || name.ends_with(".sln")
    })
}

fn truncate_detail(script: &str) -> String {
    if script.chars().count() <= DETAIL_MAX {
        script.to_string()
    } else {
        script.chars().take(DETAIL_MAX - 1).collect::<String>() + "…"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("projque-run-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_scripts_with_manager_and_ordering() {
        let dir = tmp("scripts");
        fs::write(
            dir.join("package.json"),
            r#"{"scripts":{"build":"vite build","dev":"vite","-evil":"rm -rf /","test":"vitest"}}"#,
        )
        .unwrap();
        fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        let targets = detect_targets(&dir);
        let ids: Vec<&str> = targets.iter().map(|t| t.target_id.as_str()).collect();
        assert_eq!(ids, vec!["pm:dev", "pm:build", "pm:test"]); // dev first, -evil excluded
        assert_eq!(targets[0].label, "pnpm run dev");
        assert_eq!(argv_for(&targets[0]), ("pnpm".to_string(), vec!["run".to_string(), "dev".to_string()]));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lockfile_manager_matrix() {
        for (lockfile, expected) in [
            ("bun.lockb", "bun"),
            ("pnpm-lock.yaml", "pnpm"),
            ("yarn.lock", "yarn"),
        ] {
            let dir = tmp(expected);
            fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"x"}}"#).unwrap();
            fs::write(dir.join(lockfile), "").unwrap();
            assert_eq!(detect_targets(&dir)[0].runner, expected);
            let _ = fs::remove_dir_all(&dir);
        }
        let dir = tmp("npm-default");
        fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"x"}}"#).unwrap();
        assert_eq!(detect_targets(&dir)[0].runner, "npm");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_cargo_go_dotnet() {
        let dir = tmp("native");
        fs::write(dir.join("Cargo.toml"), "[package]").unwrap();
        fs::write(dir.join("go.mod"), "module x").unwrap();
        fs::write(dir.join("App.csproj"), "<Project/>").unwrap();
        let ids: Vec<String> = detect_targets(&dir).iter().map(|t| t.target_id.clone()).collect();
        assert!(ids.contains(&"cargo:run".to_string()));
        assert!(ids.contains(&"go:run".to_string()));
        assert!(ids.contains(&"dotnet:run".to_string()));
        assert_eq!(argv_for(&detect_targets(&dir)[0]).1, vec!["run"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_project_has_no_targets() {
        let dir = tmp("empty");
        assert!(detect_targets(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
