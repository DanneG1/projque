//! The complete IPC surface. Command bodies contain only validation and
//! delegation — business logic lives in the service modules. The frontend
//! never sends filesystem paths or shell strings: only opaque IDs and
//! closed enum values cross this boundary.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::config::FileState;
use crate::error::AppError;
use crate::settings::{Settings, Theme};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatus {
    pub config_dir: String,
    pub settings: FileState,
    pub projects: FileState,
}

#[tauri::command]
pub async fn app_config_status(state: State<'_, Arc<AppState>>) -> Result<ConfigStatus, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (_, settings_state) = state.settings();
        let (_, projects_state) = state.projects();
        Ok(ConfigStatus {
            config_dir: state.config_dir.display().to_string(),
            settings: settings_state,
            projects: projects_state,
        })
    })
    .await
}

#[tauri::command]
pub async fn app_open_config_dir(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        std::fs::create_dir_all(&state.config_dir)?;
        tauri_plugin_opener::open_path(&state.config_dir, None::<&str>).map_err(|e| {
            AppError::LaunchFailed { program: "file manager".into(), detail: e.to_string() }
        })
    })
    .await
}

#[tauri::command]
pub async fn settings_get(state: State<'_, Arc<AppState>>) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || Ok(state.settings().0)).await
}

#[tauri::command]
pub async fn settings_set_display(
    state: State<'_, Arc<AppState>>,
    show_archived: Option<bool>,
    theme: Option<Theme>,
) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        state.update_settings(|s| {
            if let Some(v) = show_archived {
                s.display.show_archived = v;
            }
            if let Some(t) = theme {
                s.display.theme = t;
            }
        })
    })
    .await
}

/// All blocking work (filesystem, git, process spawns) runs off the async
/// runtime so the webview's IPC thread is never blocked.
pub(crate) async fn run_blocking<T, F>(f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io { detail: format!("task join error: {e}") })?
}

// ---------------------------------------------------------------------------
// Projects

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::project::{self, Project, ProjectPatch, ProjectStatus, ProjectView};

#[tauri::command]
pub async fn projects_list(state: State<'_, Arc<AppState>>) -> Result<Vec<ProjectView>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (projects, _) = state.projects();
        Ok(projects.iter().map(project::view).collect())
    })
    .await
}

#[tauri::command]
pub async fn project_add_manual(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ProjectView>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        // The folder picker runs entirely in the backend: the chosen path
        // never round-trips through the webview.
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|e| AppError::InvalidInput { detail: e.to_string() })?;
        let project = add_project_at(&state, path)?;
        Ok(Some(project::view(&project)))
    })
    .await
}

/// Shared by manual add and (later) discovery import: canonicalize, reject
/// duplicates, derive name + slug id, persist.
pub(crate) fn add_project_at(state: &AppState, path: std::path::PathBuf) -> Result<Project, AppError> {
    let canon = std::fs::canonicalize(&path)
        .map_err(|_| AppError::PathMissing { path: path.display().to_string() })?;
    if !canon.is_dir() {
        return Err(AppError::NotADirectory { path: canon.display().to_string() });
    }
    let name = canon
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".to_string());
    state.update_projects(|projects| {
        for existing in projects.iter() {
            if let Ok(existing_canon) = std::fs::canonicalize(&existing.path) {
                if existing_canon == canon {
                    return Err(AppError::DuplicateProject {
                        id: existing.id.clone(),
                        name: existing.name.clone(),
                    });
                }
            }
        }
        let taken: Vec<&str> = projects.iter().map(|p| p.id.as_str()).collect();
        let id = project::slug_id(&name, &taken);
        let new = Project {
            id,
            name,
            path: canon,
            status: ProjectStatus::Active,
            favorite: false,
            description: None,
            description_source: Default::default(),
            roadmap_file: None,
        };
        projects.push(new.clone());
        Ok(new)
    })
}

#[tauri::command]
pub async fn project_update(
    state: State<'_, Arc<AppState>>,
    id: String,
    patch: ProjectPatch,
) -> Result<ProjectView, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        if let Some(roadmap) = patch.roadmap_file.as_deref() {
            validate_roadmap_file(roadmap)?;
        }
        let updated = state.update_projects(|projects| {
            let project = projects
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProjectNotFound { id: id.clone() })?;
            if let Some(name) = patch.name {
                let trimmed = name.trim();
                if trimmed.is_empty() {
                    return Err(AppError::InvalidInput { detail: "name cannot be empty".into() });
                }
                project.name = trimmed.to_string();
            }
            if let Some(status) = patch.status {
                project.status = status;
            }
            if let Some(favorite) = patch.favorite {
                project.favorite = favorite;
            }
            if let Some(description) = patch.description {
                let trimmed = description.trim().to_string();
                project.description = (!trimmed.is_empty()).then_some(trimmed);
            }
            if let Some(source) = patch.description_source {
                project.description_source = source;
            }
            if let Some(roadmap) = patch.roadmap_file {
                let trimmed = roadmap.trim().to_string();
                project.roadmap_file = (!trimmed.is_empty()).then_some(trimmed);
            }
            Ok(project.clone())
        })?;
        Ok(project::view(&updated))
    })
    .await
}

/// A configured roadmap path must stay inside the project directory:
/// relative, no parent-dir components, no absolute paths. (The symlink
/// escape check happens again at read time, against the real file.)
fn validate_roadmap_file(value: &str) -> Result<(), AppError> {
    let path = std::path::Path::new(value);
    if path.is_absolute() {
        return Err(AppError::InvalidInput { detail: "roadmap path must be relative".into() });
    }
    use std::path::Component;
    if path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(AppError::InvalidInput {
            detail: "roadmap path must not contain '..' or special components".into(),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn project_remove(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        state.update_projects(|projects| {
            let before = projects.len();
            projects.retain(|p| p.id != id);
            if projects.len() == before {
                return Err(AppError::ProjectNotFound { id: id.clone() });
            }
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn project_relocate(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Option<ProjectView>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|e| AppError::InvalidInput { detail: e.to_string() })?;
        let canon = std::fs::canonicalize(&path)
            .map_err(|_| AppError::PathMissing { path: path.display().to_string() })?;
        if !canon.is_dir() {
            return Err(AppError::NotADirectory { path: canon.display().to_string() });
        }
        let updated = state.update_projects(|projects| {
            let project = projects
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProjectNotFound { id: id.clone() })?;
            project.path = canon;
            Ok(project.clone())
        })?;
        Ok(Some(project::view(&updated)))
    })
    .await
}
