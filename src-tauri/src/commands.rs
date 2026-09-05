//! The complete IPC surface. Command bodies contain only validation and
//! delegation - business logic lives in the service modules. The frontend
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

#[tauri::command]
pub async fn settings_set_notifications(
    state: State<'_, Arc<AppState>>,
    system: Option<bool>,
    quiet_hours: Option<bool>,
    quiet_from: Option<u8>,
    quiet_to: Option<u8>,
) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        state.update_settings(|s| {
            let n = &mut s.notifications;
            if let Some(v) = system {
                n.system = v;
            }
            if let Some(v) = quiet_hours {
                n.quiet_hours = v;
            }
            if let Some(v) = quiet_from {
                n.quiet_from = v.min(23);
            }
            if let Some(v) = quiet_to {
                n.quiet_to = v.min(23);
            }
        })
    })
    .await
}

/// Point the filesystem watcher at the current project list. Called by the
/// frontend after anything that adds, removes or relocates projects.
#[tauri::command]
pub async fn watch_sync(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (projects, _) = state.projects();
        let list = projects.iter().map(|p| (p.id.clone(), p.path.clone())).collect();
        state.watcher.sync(app, list);
        Ok(())
    })
    .await
}

fn clean_text(s: &str, max: usize) -> String {
    s.replace("\r\n", "\n")
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Save (id = existing) or add (id = None) a prompt. Audited free-form
/// strings: label ≤ 60 chars, prompt ≤ 4000, control characters stripped;
/// they are stored in settings.json and only ever used as an agent's
/// initial prompt.
#[tauri::command]
pub async fn settings_prompt_save(
    state: State<'_, Arc<AppState>>,
    id: Option<String>,
    label: String,
    prompt: String,
) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let label = clean_text(&label, 60);
        let prompt = clean_text(&prompt, 4000);
        if label.is_empty() || prompt.is_empty() {
            return Err(AppError::InvalidInput { detail: "a prompt needs a name and some text".into() });
        }
        state.update_settings(|s| {
            if let Some(existing) = id.as_ref().and_then(|id| s.prompts.iter_mut().find(|p| &p.id == id)) {
                existing.label = label.clone();
                existing.prompt = prompt.clone();
                return;
            }
            if s.prompts.len() >= crate::settings::MAX_PROMPTS {
                return;
            }
            let id = format!("p{}", now_secs());
            s.prompts.push(crate::settings::SavedPrompt { id, label: label.clone(), prompt: prompt.clone() });
        })
    })
    .await
}

#[tauri::command]
pub async fn settings_prompt_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || state.update_settings(|s| s.prompts.retain(|p| p.id != id))).await
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
            production_url: None,
            tags: Vec::new(),
            last_verified: None,
            last_cleanup: None,
            last_audit: None,
            experiment: None,
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
        if let Some(url) = patch.production_url.as_deref() {
            let url = url.trim();
            // Same shape rules as open_external_url: scheme allowlist, no
            // whitespace/control, bounded. Empty clears the field.
            let ok = url.is_empty()
                || (url.len() <= 2048
                    && !url.chars().any(|c| c.is_control() || c.is_whitespace())
                    && (url.starts_with("https://") || url.starts_with("http://")));
            if !ok {
                return Err(AppError::InvalidInput {
                    detail: "enter an http:// or https:// URL".into(),
                });
            }
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
            if let Some(url) = patch.production_url {
                let trimmed = url.trim().to_string();
                project.production_url = (!trimmed.is_empty()).then_some(trimmed);
            }
            if let Some(tags) = patch.tags {
                project.tags = project::normalize_tags(&tags)?;
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

// ---------------------------------------------------------------------------
// Discovery & project roots

use crate::discovery::{self, ScanIssue, ScanResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRootResult {
    pub settings: Settings,
    pub added: bool,
}

#[tauri::command]
pub async fn settings_add_project_root(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<AddRootResult, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            let (settings, _) = state.settings();
            return Ok(AddRootResult { settings, added: false });
        };
        let path = picked
            .into_path()
            .map_err(|e| AppError::InvalidInput { detail: e.to_string() })?;
        let canon = std::fs::canonicalize(&path)
            .map_err(|_| AppError::PathMissing { path: path.display().to_string() })?;
        if !canon.is_dir() {
            return Err(AppError::NotADirectory { path: canon.display().to_string() });
        }
        let already = state.settings().0.project_roots.iter().any(|r| r == &canon);
        if already {
            let (settings, _) = state.settings();
            return Ok(AddRootResult { settings, added: false });
        }
        let settings = state.update_settings(|s| s.project_roots.push(canon))?;
        Ok(AddRootResult { settings, added: true })
    })
    .await
}

#[tauri::command]
pub async fn settings_remove_project_root(
    state: State<'_, Arc<AppState>>,
    index: usize,
) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        state.update_settings(|s| {
            if index < s.project_roots.len() {
                s.project_roots.remove(index);
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn settings_set_scan_depth(
    state: State<'_, Arc<AppState>>,
    depth: u8,
) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || state.update_settings(|s| s.scan_depth = depth.clamp(1, 6))).await
}

#[tauri::command]
pub async fn discovery_scan(state: State<'_, Arc<AppState>>) -> Result<ScanResult, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (settings, _) = state.settings();
        if settings.project_roots.is_empty() {
            return Err(AppError::InvalidInput {
                detail: "no project folders configured".into(),
            });
        }
        let (projects, _) = state.projects();
        let imported: Vec<std::path::PathBuf> = projects
            .iter()
            .filter_map(|p| std::fs::canonicalize(&p.path).ok())
            .collect();
        let (result, table) = discovery::scan(
            &settings.project_roots,
            settings.scan_depth as usize,
            &imported,
        );
        *state.last_scan.lock().unwrap() = table;
        Ok(result)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: Vec<ProjectView>,
    pub skipped_duplicates: Vec<String>,
    pub failed: Vec<ScanIssue>,
}

#[tauri::command]
pub async fn discovery_import(
    state: State<'_, Arc<AppState>>,
    candidate_ids: Vec<String>,
) -> Result<ImportResult, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let table = state.last_scan.lock().unwrap().clone();
        let mut imported = Vec::new();
        let mut skipped_duplicates = Vec::new();
        let mut failed = Vec::new();
        for candidate_id in candidate_ids {
            let Some(path) = table.get(&candidate_id) else {
                failed.push(ScanIssue {
                    path: String::new(),
                    detail: format!("unknown candidate: {candidate_id}"),
                });
                continue;
            };
            match add_project_at(&state, path.clone()) {
                Ok(project) => imported.push(project::view(&project)),
                Err(AppError::DuplicateProject { name, .. }) => skipped_duplicates.push(name),
                Err(e) => failed.push(ScanIssue {
                    path: path.display().to_string(),
                    detail: e.to_string(),
                }),
            }
        }
        Ok(ImportResult { imported, skipped_duplicates, failed })
    })
    .await
}

// ---------------------------------------------------------------------------
// Launcher & tool settings

use tauri::Manager;

use crate::launcher::{self, LauncherCatalog};
use crate::settings::ToolConfig;

#[derive(serde::Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
// The Open* names mirror the wire values ("openFolder", ...) and the spec.
#[allow(clippy::enum_variant_names)]
pub enum LaunchAction {
    OpenFolder,
    OpenEditor,
    OpenTerminal,
    OpenRepository,
    OpenAgent,
}

#[tauri::command]
pub async fn launcher_catalog(state: State<'_, Arc<AppState>>) -> Result<LauncherCatalog, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (settings, _) = state.settings();
        Ok(launcher::build_catalog(&settings))
    })
    .await
}

fn set_tool(
    state: &AppState,
    kind: String,
    valid: impl Fn(&str) -> bool,
    select: impl Fn(&mut crate::settings::Settings) -> &mut ToolConfig,
) -> Result<Settings, AppError> {
    if !valid(&kind) {
        return Err(AppError::InvalidInput { detail: format!("unknown tool kind '{kind}'") });
    }
    state.update_settings(|s| {
        // Choosing from the catalog clears any hand-edited override.
        *select(s) = ToolConfig { kind: kind.clone(), command: None, args: Vec::new() };
    })
}

#[tauri::command]
pub async fn settings_set_editor(
    state: State<'_, Arc<AppState>>,
    kind: String,
) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        set_tool(&state, kind, |k| launcher::catalog::find_editor(k).is_some(), |s| &mut s.editor)
    })
    .await
}

#[tauri::command]
pub async fn settings_set_terminal(
    state: State<'_, Arc<AppState>>,
    kind: String,
) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        set_tool(&state, kind, |k| launcher::catalog::find_terminal(k).is_some(), |s| &mut s.terminal)
    })
    .await
}

#[tauri::command]
pub async fn settings_set_agent(
    state: State<'_, Arc<AppState>>,
    kind: String,
) -> Result<Settings, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        set_tool(&state, kind, |k| launcher::catalog::find_agent(k).is_some(), |s| &mut s.agent)
    })
    .await
}

#[tauri::command]
pub async fn project_launch(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    action: LaunchAction,
) -> Result<(), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        // Single validation path for every action: opaque id -> canonical dir.
        let dir = state.resolve_dir(&id)?;
        let (settings, _) = state.settings();
        match action {
            LaunchAction::OpenFolder => launcher::open_folder(&dir),
            LaunchAction::OpenEditor => launcher::open_editor(&settings, &dir),
            LaunchAction::OpenTerminal => launcher::open_terminal(&settings, &dir),
            LaunchAction::OpenAgent => {
                let cache_dir = app
                    .path()
                    .app_cache_dir()
                    .map_err(|e| AppError::Io { detail: e.to_string() })?;
                launcher::open_agent(&settings, &dir, &cache_dir)
            }
            LaunchAction::OpenRepository => {
                // Derived backend-side from the git remote: a compromised
                // frontend cannot open an arbitrary URL through this path.
                let info = crate::git::fetch_info(&id, &dir);
                let url = info.repository_url.ok_or_else(|| AppError::InvalidInput {
                    detail: "no repository URL available for this project".into(),
                })?;
                tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| {
                    AppError::LaunchFailed { program: "browser".into(), detail: e.to_string() }
                })
            }
        }
    })
    .await
}

// ---------------------------------------------------------------------------
// Git

use crate::git::{self, GitInfo, GitState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAvailability {
    pub available: bool,
    pub version: Option<String>,
}

#[tauri::command]
pub async fn git_availability(state: State<'_, Arc<AppState>>) -> Result<GitAvailability, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let version = state.git_version();
        Ok(GitAvailability { available: version.is_some(), version })
    })
    .await
}

/// Fetch git info for many projects with bounded parallelism (chunks of 8
/// blocking tasks) and a short in-memory cache. Never fails per-repo: each
/// entry degrades to a `state` the UI renders gracefully.
#[tauri::command]
pub async fn git_info_many(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
    force: bool,
) -> Result<Vec<GitInfo>, AppError> {
    let state = state.inner().clone();
    let mut results = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(8) {
        let mut handles = Vec::with_capacity(chunk.len());
        for id in chunk {
            let state = state.clone();
            let id = id.clone();
            handles.push(tauri::async_runtime::spawn_blocking(move || {
                git_info_one(&state, &id, force)
            }));
        }
        for handle in handles {
            results.push(
                handle
                    .await
                    .map_err(|e| AppError::Io { detail: format!("task join error: {e}") })?,
            );
        }
    }
    Ok(results)
}

fn git_info_one(state: &AppState, id: &str, force: bool) -> GitInfo {
    if !force {
        if let Some(cached) = state.cached_git_info(id) {
            return cached;
        }
    }
    let info = match state.resolve_dir(id) {
        Ok(dir) => {
            if state.git_version().is_none() {
                let mut info = git::GitInfo::missing(id);
                info.state = GitState::GitMissing;
                info
            } else {
                git::fetch_info(id, &dir)
            }
        }
        Err(e) => {
            let mut info = git::GitInfo::missing(id);
            info.error = Some(e.to_string());
            info
        }
    };
    state.store_git_info(&info);
    info
}

// ---------------------------------------------------------------------------
// Documents & external URLs

use crate::project::docs::{self, DocKind, ProjectDocument};

#[tauri::command]
pub async fn project_document(
    state: State<'_, Arc<AppState>>,
    id: String,
    kind: DocKind,
) -> Result<Option<ProjectDocument>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        let (projects, _) = state.projects();
        let configured = projects
            .iter()
            .find(|p| p.id == id)
            .and_then(|p| p.roadmap_file.clone());
        let Some(path) = docs::find_doc(&dir, kind, configured.as_deref()) else {
            return Ok(None);
        };
        let (markdown, truncated) = docs::read_doc(&path)?;
        Ok(Some(ProjectDocument {
            file_name: path
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_default(),
            markdown,
            truncated,
        }))
    })
    .await
}

/// The single command that accepts a free-form string - documented as the
/// audited exception in SECURITY.md. A scheme-allowlisted URL can only ever
/// reach the OS default browser.
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), AppError> {
    run_blocking(move || {
        if url.len() > 2048 {
            return Err(AppError::InvalidInput { detail: "URL too long".into() });
        }
        let lower = url.to_ascii_lowercase();
        let allowed = lower.starts_with("http://") || lower.starts_with("https://");
        if !allowed || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err(AppError::InvalidInput {
                detail: "only http and https links can be opened".into(),
            });
        }
        tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| AppError::LaunchFailed {
            program: "browser".into(),
            detail: e.to_string(),
        })
    })
    .await
}

// ---------------------------------------------------------------------------
// Git controls (safe set: fetch / ff-only pull / branch list / switch)

use crate::git::ops::{self, BranchList};

fn require_git(state: &AppState) -> Result<(), AppError> {
    if state.git_version().is_none() {
        return Err(AppError::GitUnavailable);
    }
    Ok(())
}

#[tauri::command]
pub async fn git_branches(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<BranchList, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::list_branches(&dir)
    })
    .await
}

#[tauri::command]
pub async fn git_fetch(state: State<'_, Arc<AppState>>, id: String) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::fetch(&dir)?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

#[tauri::command]
pub async fn git_pull_ff(state: State<'_, Arc<AppState>>, id: String) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::pull_ff(&dir)?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

#[tauri::command]
pub async fn git_switch(
    state: State<'_, Arc<AppState>>,
    id: String,
    branch: String,
) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::switch(&dir, &branch)?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

/// Commit everything ("Save your work"). `message` is an audited free-form
/// string - see ops::commit_all for validation; it is only ever the value
/// of `-m`.
#[tauri::command]
pub async fn git_commit(
    state: State<'_, Arc<AppState>>,
    id: String,
    message: String,
    allow_secrets: Option<bool>,
) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::commit_all_checked(&dir, &message, allow_secrets.unwrap_or(false))?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

#[tauri::command]
pub async fn git_history(
    state: State<'_, Arc<AppState>>,
    id: String,
    limit: Option<u32>,
) -> Result<Vec<crate::git::GitCommit>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::history(&dir, limit.unwrap_or(20))
    })
    .await
}

#[tauri::command]
pub async fn git_snapshots(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<crate::git::backup::Snapshot>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        crate::git::backup::list_snapshots(&dir)
    })
    .await
}

/// Restore an earlier version (commit or snapshot) as a NEW commit, after
/// snapshotting the current state. `hash` is an audited free-form string -
/// hex-validated and resolved against this repository's own objects
/// (ops::restore), so it can never be an option or reach another repo.
#[tauri::command]
pub async fn git_restore(
    state: State<'_, Arc<AppState>>,
    id: String,
    hash: String,
    discard_new: Option<bool>,
) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::restore_with(&dir, &hash, discard_new.unwrap_or(false))?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

/// Commit & push as one explicit action (commit if a message is given,
/// ff-only pull when there is an upstream, push). Each step is one of the
/// audited verbs; the network steps are the same as the Pull/Push buttons.
/// `message` follows git_commit's validation.
#[tauri::command]
pub async fn git_sync(
    state: State<'_, Arc<AppState>>,
    id: String,
    message: Option<String>,
    allow_secrets: Option<bool>,
) -> Result<(ops::SyncOutcome, GitInfo), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let outcome = ops::sync(&dir, message.as_deref(), allow_secrets.unwrap_or(false))?;
        Ok((outcome, state.refresh_git_info(&id, &dir)))
    })
    .await
}

/// What a commit would include, with secrets findings (hard block) and
/// .gitignore suggestions (soft warnings with a catalog fix).
#[tauri::command]
pub async fn git_commit_preflight(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<crate::git::hygiene::CommitPreflight, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        crate::git::hygiene::commit_preflight(&dir)
    })
    .await
}

/// Append fixed catalog patterns to .gitignore. `kinds` are catalog ids
/// validated against the closed rule set - no frontend text reaches the file.
#[tauri::command]
pub async fn git_ignore_fix(
    state: State<'_, Arc<AppState>>,
    id: String,
    kinds: Vec<String>,
) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        crate::git::hygiene::apply_ignores(&dir, &kinds)?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

// --- Advanced git view (behind the display.advancedGit toggle) ---

#[tauri::command]
pub async fn git_graph(
    state: State<'_, Arc<AppState>>,
    id: String,
    limit: Option<u32>,
) -> Result<Vec<crate::git::inspect::GraphCommit>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        crate::git::inspect::graph(&dir, limit.unwrap_or(100))
    })
    .await
}

/// Structured diff of one commit vs its parent. Hash validated like
/// git_restore (hex + rev-parse verify).
#[tauri::command]
pub async fn git_commit_diff(
    state: State<'_, Arc<AppState>>,
    id: String,
    hash: String,
) -> Result<Vec<crate::git::inspect::FileDiff>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        crate::git::inspect::commit_diff(&dir, &hash)
    })
    .await
}

#[tauri::command]
pub async fn git_workdir_diff(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<crate::git::inspect::FileDiff>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        crate::git::inspect::workdir_diff(&dir)
    })
    .await
}

/// Create a branch at HEAD and switch to it. `name` is an audited free-form
/// string - strict charset + git check-ref-format (see ops::branch_create).
#[tauri::command]
pub async fn git_branch_create(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: String,
) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::branch_create(&dir, &name)?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

#[tauri::command]
pub async fn git_branch_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
    branch: String,
) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::branch_delete(&dir, &branch)?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

/// Explicit-click network operation: push the current branch to origin
/// (upstream set on first push). Never forced.
#[tauri::command]
pub async fn git_push(state: State<'_, Arc<AppState>>, id: String) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::push_current(&dir)?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

/// Merge the CURRENT branch into `target` (the user's mental model: "merge
/// what I'm standing on into develop"). Switches to the target; stops on
/// conflicts (reported back) - the only exits from that state are
/// git_merge_complete and git_merge_abort.
#[tauri::command]
pub async fn git_merge_into(
    state: State<'_, Arc<AppState>>,
    id: String,
    target: String,
) -> Result<ops::MergeOutcome, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let outcome = ops::merge_into(&dir, &target)?;
        state.refresh_git_info(&id, &dir);
        Ok(outcome)
    })
    .await
}

#[tauri::command]
pub async fn git_merge_abort(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::merge_abort(&dir)?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

#[tauri::command]
pub async fn git_merge_complete(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<GitInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::merge_complete(&dir)?;
        Ok(state.refresh_git_info(&id, &dir))
    })
    .await
}

/// Files currently in conflict during an in-progress merge (repo-relative
/// names from git's own output, display only).
#[tauri::command]
pub async fn git_conflicts(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<String>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        ops::conflicted_files(&dir)
    })
    .await
}

/// Plain-language summary of uncommitted changes via the user's own Claude
/// Code CLI. Explicit-click only - it spends the user's Claude usage.
#[tauri::command]
pub async fn git_change_summary(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<String, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let (settings, _) = state.settings();
        crate::assist::change_summary(&dir, &settings.path_additions)
    })
    .await
}

// ---------------------------------------------------------------------------
// Embedded agent sessions

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::agent::{AgentSessionView, SessionKind, StartSpec};
use crate::launcher::which;

#[tauri::command]
pub async fn agent_session_start(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    agent_kind: Option<String>,
    rows: u16,
    cols: u16,
    initial_prompt: Option<String>,
    session_label: Option<String>,
) -> Result<AgentSessionView, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&project_id)?;
        let project_label = project_label(&state, &project_id);
        let (settings, _) = state.settings();
        let agent = launcher::resolve_agent(&settings, agent_kind.as_deref())?;
        // Optional display-only pane label (e.g. a roleplay-tester persona).
        // Rendered as text in the session list/pane header/notification title
        // only - never an argument, path, or shell input.
        let agent_label: String = match session_label {
            Some(l) => {
                let l: String =
                    l.trim().chars().filter(|c| !c.is_control()).take(80).collect();
                if l.is_empty() { agent.label.clone() } else { l }
            }
            None => agent.label.clone(),
        };
        // Safety net for "the agent broke my project": snapshot the working
        // tree to a hidden ref before the agent can touch it (see
        // git/backup.rs). Best-effort - never blocks the session.
        // The snapshot (or HEAD, when the tree was already clean) is also
        // the "undo this session" point offered in the post-session review.
        let mut undo_hash = None;
        if dir.join(".git").exists() {
            let reason = format!("Before {} session", agent.label);
            undo_hash = crate::git::backup::create_snapshot(&dir, &reason)
                .ok()
                .flatten()
                .map(|s| s.hash)
                .or_else(|| ops::head_hash(&dir));
        }
        let path_env = which::augmented_path(&settings.path_additions);
        let mut args = agent.args.clone();
        // Kickoff prompt: content into the user's own agent (write-level
        // trust), passed as a positional argument only for agents that
        // support one; silently ignored otherwise.
        if let Some(prompt) = initial_prompt.filter(|p| !p.trim().is_empty()) {
            if prompt.len() > 4 * 1024 {
                return Err(AppError::InvalidInput { detail: "prompt too large".into() });
            }
            if agent.prompt_arg {
                // A leading '-' would make the agent's CLI parse the prompt
                // as a flag; a leading space keeps it a harmless positional.
                let safe = if prompt.starts_with('-') { format!(" {prompt}") } else { prompt };
                args.push(safe);
            }
        }
        state.agents.start(
            app,
            StartSpec {
                project_id: &project_id,
                project_label: &project_label,
                kind: SessionKind::Agent,
                agent_kind: &agent.kind,
                agent_label: &agent_label,
                program: &agent.program,
                args: &args,
                cwd: &dir,
                path_env: &path_env,
                rows,
                cols,
                undo_hash,
                target_id: None,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn agent_sessions_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<AgentSessionView>, AppError> {
    Ok(state.agents.list())
}

#[tauri::command]
pub async fn agent_session_attach(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    channel: Channel<InvokeResponseBody>,
) -> Result<(), AppError> {
    state.agents.attach(&session_id, channel)
}

/// Keystrokes into a PTY the user started, running an allowlisted agent in
/// their own project directory - the trust level of typing in Terminal.app.
#[tauri::command]
pub async fn agent_session_write(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    data: String,
) -> Result<(), AppError> {
    if data.len() > 64 * 1024 {
        return Err(AppError::InvalidInput { detail: "input too large".into() });
    }
    state.agents.write(&session_id, &data)
}

#[tauri::command]
pub async fn agent_session_resize(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), AppError> {
    state.agents.resize(&session_id, rows, cols)
}

#[tauri::command]
pub async fn agent_session_kill(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), AppError> {
    state.agents.kill(&session_id)
}

#[tauri::command]
pub async fn agent_session_remove(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), AppError> {
    state.agents.remove(&session_id)
}

/// Frontend reports which session is on screen and whether the app is
/// focused - IDs only; used to suppress attention for what the user is
/// already looking at.
#[tauri::command]
pub async fn sessions_set_active(
    state: State<'_, Arc<AppState>>,
    session_ids: Vec<String>,
    app_focused: bool,
) -> Result<(), AppError> {
    state.agents.set_active(session_ids, app_focused);
    Ok(())
}

/// Confirm quitting while agent sessions are running: kill them all, mark
/// the quit confirmed, and close the main window (the CloseRequested guard
/// in lib.rs then lets it through).
#[tauri::command]
pub async fn app_confirm_quit(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    state
        .agents
        .quit_confirmed
        .store(true, std::sync::atomic::Ordering::SeqCst);
    state.agents.kill_all();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
    Ok(())
}


// ---------------------------------------------------------------------------
// Run targets (dev servers etc., derived from the project's own manifests)

use crate::run::{self, RunTarget};

#[tauri::command]
pub async fn project_run_targets(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<RunTarget>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        Ok(run::detect_targets(&dir))
    })
    .await
}

/// The project's test command, when it has one (None = no "Run tests").
#[tauri::command]
pub async fn project_test_target(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Option<RunTarget>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        Ok(run::detect_test_target(&dir))
    })
    .await
}

/// Record the outcome of a test run. Called by the frontend when a test run
/// session exits; the timestamp is stamped here, only `passed` crosses IPC.
#[tauri::command]
pub async fn project_mark_verified(
    state: State<'_, Arc<AppState>>,
    id: String,
    passed: bool,
) -> Result<ProjectView, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let updated = state.update_projects(|projects| {
            let project = projects
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProjectNotFound { id: id.clone() })?;
            project.last_verified = Some(crate::project::Verification { at, passed });
            Ok(project.clone())
        })?;
        Ok(project::view(&updated))
    })
    .await
}

/// Stamp "a tidy-up started now, from this commit". Only the opaque project
/// id crosses IPC; the timestamp and HEAD hash are read in Rust.
#[tauri::command]
pub async fn project_mark_cleanup(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<ProjectView, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        let commit = ops::head_hash(&dir);
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let updated = state.update_projects(|projects| {
            let project = projects
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProjectNotFound { id: id.clone() })?;
            project.last_cleanup = Some(crate::project::Cleanup { at, commit });
            Ok(project.clone())
        })?;
        Ok(project::view(&updated))
    })
    .await
}

/// Churn since the last tidy-up (or over the last 30 days when there has
/// never been one) - the basis for the "worth a tidy-up?" nudge.
#[tauri::command]
pub async fn project_debt(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<crate::project::debt::DebtInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        let (projects, _) = state.projects();
        let cleanup = projects.iter().find(|p| p.id == id).and_then(|p| p.last_cleanup.clone());
        Ok(crate::project::debt::measure(&dir, cleanup.as_ref()))
    })
    .await
}

#[tauri::command]
pub async fn project_audit_support(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<crate::audit::AuditSupport, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        Ok(crate::audit::support(&dir))
    })
    .await
}

/// Explicit-click network operation: the project's package manager audits
/// its dependency tree against the registry's advisories. The summary is
/// stamped on the project so the card can show "checked 2h ago".
#[tauri::command]
pub async fn project_audit_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(crate::audit::AuditReport, ProjectView), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        let (settings, _) = state.settings();
        let report = crate::audit::run(&dir, &settings.path_additions)?;
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let updated = state.update_projects(|projects| {
            let project = projects
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProjectNotFound { id: id.clone() })?;
            project.last_audit = Some(crate::project::AuditStamp {
                at,
                total: report.total,
                fixable: report.fixable,
                critical: report.critical,
                high: report.high,
            });
            Ok(project.clone())
        })?;
        Ok((report, project::view(&updated)))
    })
    .await
}

/// Read-only: how this project already gets deployed (workflows, hosting
/// config files, README), so the push flow can warn before it happens.
#[tauri::command]
pub async fn project_deploy_info(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<crate::project::deploy::DeployInfo, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        Ok(crate::project::deploy::detect(&dir))
    })
    .await
}

/// Per-project setup check: tools this project's manifests ask for.
#[tauri::command]
pub async fn project_doctor(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<crate::project::doctor::ToolCheck>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        let (settings, _) = state.settings();
        Ok(crate::project::doctor::check(&dir, &settings.path_additions))
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorExplanation {
    pub explanation: String,
    /// The terminal tail that was explained - offered to the user as
    /// context for a follow-up "ask the agent to fix it" prompt.
    pub excerpt: String,
}

/// Explain the error a run session printed, in plain language, via the
/// user's own `claude --print` (explicit click). The text explained is the
/// session's own scrollback tail, read backend-side.
#[tauri::command]
pub async fn session_explain_error(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<ErrorExplanation, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (project_id, tail) = state.agents.output_tail(&session_id, 12 * 1024)?;
        let dir = state.resolve_dir(&project_id)?;
        let (settings, _) = state.settings();
        // Keep the last ~60 non-empty lines: enough for a stack trace, cheap.
        let lines: Vec<&str> = tail.lines().filter(|l| !l.trim().is_empty()).collect();
        let start = lines.len().saturating_sub(60);
        let excerpt = lines[start..].join("\n");
        if excerpt.trim().is_empty() {
            return Err(AppError::InvalidInput { detail: "nothing to explain yet".into() });
        }
        let explanation = crate::assist::explain_error(&dir, &excerpt, &settings.path_additions)?;
        Ok(ErrorExplanation { explanation, excerpt })
    })
    .await
}

#[tauri::command]
pub async fn run_session_start(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    target_id: String,
    rows: u16,
    cols: u16,
) -> Result<AgentSessionView, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&project_id)?;
        let project_label = project_label(&state, &project_id);
        // Re-derive the enumeration at launch time; the requested target
        // must match exactly (the git_switch validation pattern).
        let targets = run::all_targets(&dir);
        let target = targets
            .iter()
            .find(|t| t.target_id == target_id)
            .ok_or_else(|| AppError::RunTargetNotFound { target: target_id.clone() })?;
        let (runner, args) = run::argv_for(target);
        let (settings, _) = state.settings();
        let program = which::resolve_program(&runner, &settings.path_additions)
            .ok_or_else(|| AppError::ProgramNotFound { program: runner.clone() })?;
        let path_env = which::augmented_path(&settings.path_additions);
        state.agents.start(
            app,
            StartSpec {
                project_id: &project_id,
                project_label: &project_label,
                kind: SessionKind::Run,
                agent_kind: &runner,
                agent_label: &target.label,
                program: &program,
                args: &args,
                cwd: &dir,
                path_env: &path_env,
                rows,
                cols,
                undo_hash: None,
                target_id: Some(target.target_id.clone()),
            },
        )
    })
    .await
}

/// Open the URL the run session itself printed (stored backend-side -
/// no URL ever crosses IPC).
#[tauri::command]
pub async fn run_session_open_url(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), AppError> {
    let url = state.agents.detected_url(&session_id)?.ok_or_else(|| AppError::InvalidInput {
        detail: "no URL detected for this session yet".into(),
    })?;
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| AppError::LaunchFailed {
        program: "browser".into(),
        detail: e.to_string(),
    })
}

// ---------------------------------------------------------------------------
// GitHub CLI layer + project creation / cloning

use crate::github::{self, GhStatus, PrStatus};

/// Display name for a project id, falling back to the id itself.
fn project_label(state: &Arc<AppState>, project_id: &str) -> String {
    let (projects, _) = state.projects();
    projects
        .iter()
        .find(|p| p.id == project_id)
        .map(|p| p.name.clone())
        .unwrap_or_else(|| project_id.to_string())
}

/// "YYYY-MM-DD" (UTC) without a date-crate dependency; civil-from-days per
/// Howard Hinnant's algorithm.
fn today_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    civil_date(secs)
}

fn civil_date(secs: u64) -> String {
    let z = (secs / 86400) as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe as i64 + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Append a captured idea to IDEAS.md, creating the file on first use.
/// With a project id the file lives in that project (an existing IDEAS.md
/// must resolve inside the project - symlink escapes rejected, same rule as
/// document reads); with `id: None` the idea is general and goes to the
/// fixed-name IDEAS.md in the app's own config directory.
#[tauri::command]
pub async fn idea_capture(
    state: State<'_, Arc<AppState>>,
    id: Option<String>,
    text: String,
) -> Result<String, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        if text.len() > 4096 {
            return Err(AppError::InvalidInput { detail: "idea text too long".into() });
        }
        let cleaned: String = text
            .replace("\r\n", "\n")
            .chars()
            .map(|c| if c == '\n' || !c.is_control() { c } else { ' ' })
            .collect();
        let cleaned = cleaned.trim();
        if cleaned.is_empty() {
            return Err(AppError::InvalidInput { detail: "idea text is empty".into() });
        }
        let path = match &id {
            Some(id) => {
                let dir = std::fs::canonicalize(state.resolve_dir(id)?)
                    .map_err(|e| AppError::Io { detail: e.to_string() })?;
                let path = dir.join("IDEAS.md");
                if path.exists() {
                    let real = std::fs::canonicalize(&path)
                        .map_err(|e| AppError::Io { detail: e.to_string() })?;
                    if !real.starts_with(&dir) || !real.is_file() {
                        return Err(AppError::InvalidInput {
                            detail: "IDEAS.md is not a regular file inside the project".into(),
                        });
                    }
                }
                path
            }
            None => {
                std::fs::create_dir_all(&state.config_dir)?;
                state.config_dir.join("IDEAS.md")
            }
        };
        let mut content = match std::fs::read_to_string(&path) {
            Ok(existing) => existing,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => "# Ideas\n".to_string(),
            Err(e) => return Err(AppError::Io { detail: e.to_string() }),
        };
        if !content.ends_with('\n') {
            content.push('\n');
        }
        // One list item; continuation lines stay inside it via indentation.
        let body = cleaned.replace('\n', "\n  ");
        content.push_str(&format!("\n- [ ] {} *({})*\n", body, today_utc()));
        std::fs::write(&path, content).map_err(|e| AppError::Io { detail: e.to_string() })?;
        Ok("IDEAS.md".to_string())
    })
    .await
}

/// Mirror the in-app attention count on the dock/taskbar badge. Count only,
/// no content; ignored on platforms without badge support.
#[tauri::command]
pub async fn app_set_badge(app: AppHandle, count: u32) -> Result<(), AppError> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count(if count == 0 { None } else { Some(i64::from(count)) });
    }
    Ok(())
}

#[tauri::command]
pub async fn github_status(state: State<'_, Arc<AppState>>) -> Result<GhStatus, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (settings, _) = state.settings();
        Ok(github::status(&settings.path_additions))
    })
    .await
}

/// Explicit-click network operation, like Fetch.
#[tauri::command]
pub async fn github_pr_status(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Option<PrStatus>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        let (settings, _) = state.settings();
        let status = github::pr_status(&dir, &settings.path_additions)?;
        let mut cache = state.pr_cache.lock().unwrap();
        match &status {
            Some(pr) => {
                cache.insert(id.clone(), pr.clone());
            }
            None => {
                cache.remove(&id);
            }
        }
        Ok(status)
    })
    .await
}

/// Opens the PR URL stored by the last github_pr_status call - no URL
/// crosses IPC.
#[tauri::command]
pub async fn github_open_pr(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    let url = state
        .pr_cache
        .lock()
        .unwrap()
        .get(&id)
        .map(|pr| pr.url.clone())
        .ok_or_else(|| AppError::InvalidInput { detail: "no PR loaded for this project".into() })?;
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| AppError::LaunchFailed {
        program: "browser".into(),
        detail: e.to_string(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectResult {
    pub project: ProjectView,
    /// Set when the local project was created but `gh repo create` failed -
    /// the caller shows this as a warning, not a failure.
    pub remote_error: Option<String>,
}

/// Create a new project: folder + git init + README + first commit, and
/// optionally the GitHub repository. Audited exception: `name` (strict
/// charset, also the directory name) and `description` (file content only).
#[tauri::command]
pub async fn project_create(
    state: State<'_, Arc<AppState>>,
    name: String,
    description: Option<String>,
    root_index: usize,
    create_remote: bool,
    private: bool,
) -> Result<CreateProjectResult, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        github::validate_name(&name)?;
        let (settings, _) = state.settings();
        let root = settings
            .project_roots
            .get(root_index)
            .ok_or_else(|| AppError::InvalidInput { detail: "unknown project folder".into() })?
            .clone();
        let dir = root.join(&name);
        if dir.exists() {
            return Err(AppError::AlreadyExists { path: dir.display().to_string() });
        }
        std::fs::create_dir_all(&dir)?;

        let description = description
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty());
        let mut readme = format!("# {name}\n");
        if let Some(d) = &description {
            readme.push_str(&format!("\n{d}\n"));
        }
        std::fs::write(dir.join("README.md"), readme)?;

        let git_ready = state.git_version().is_some()
            && crate::git::run_in(&dir, &["init"]).is_ok()
            && crate::git::run_in(&dir, &["add", "-A"]).is_ok()
            && crate::git::run_in(&dir, &["commit", "-m", "Initial commit"]).is_ok();

        let mut remote_error: Option<String> = None;
        if create_remote && git_ready {
            if let Err(e) = github::repo_create(&dir, &name, private, &settings.path_additions) {
                // The project is still created locally; surface as a warning.
                remote_error = Some(e.to_string());
            }
        }

        let project = add_project_at(&state, dir)?;
        let view = if let Some(d) = description {
            let updated = state.update_projects(|projects| {
                let p = projects
                    .iter_mut()
                    .find(|p| p.id == project.id)
                    .ok_or_else(|| AppError::ProjectNotFound { id: project.id.clone() })?;
                p.description = Some(d);
                p.description_source = crate::project::DescriptionSource::Custom;
                Ok(p.clone())
            })?;
            project::view(&updated)
        } else {
            project::view(&project)
        };
        Ok(CreateProjectResult { project: view, remote_error })
    })
    .await
}

/// Clone a repository into a configured project root and import it.
/// Audited exception: `url` - shape-validated (scheme prefix, no
/// whitespace/control, length cap; prefixes exclude a leading '-') and
/// passed to git as a single argv element after `--`.
#[tauri::command]
pub async fn project_clone(
    state: State<'_, Arc<AppState>>,
    url: String,
    root_index: usize,
) -> Result<ProjectView, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let url = url.trim().to_string();
        let shape_ok = url.len() <= 300
            && !url.chars().any(|c| c.is_control() || c.is_whitespace())
            && (url.starts_with("https://")
                || url.starts_with("http://")
                || url.starts_with("ssh://")
                || url.starts_with("git@"));
        if !shape_ok {
            return Err(AppError::InvalidInput {
                detail: "enter an https://, ssh:// or git@ repository URL".into(),
            });
        }
        if state.git_version().is_none() {
            return Err(AppError::GitUnavailable);
        }
        let (settings, _) = state.settings();
        let root = settings
            .project_roots
            .get(root_index)
            .ok_or_else(|| AppError::InvalidInput { detail: "unknown project folder".into() })?
            .clone();
        let dir_name = url
            .trim_end_matches('/')
            .rsplit(['/', ':'])
            .next()
            .unwrap_or("")
            .trim_end_matches(".git")
            .to_string();
        github::validate_name(&dir_name)?;
        let dir = root.join(&dir_name);
        if dir.exists() {
            return Err(AppError::AlreadyExists { path: dir.display().to_string() });
        }
        crate::git::clone_into(&root, &url, &dir_name)?;
        let project = add_project_at(&state, dir)?;
        Ok(project::view(&project))
    })
    .await
}

// ---------------------------------------------------------------------------
// Publish to GitHub Pages

use crate::github::{PublishOutcome, PublishPreflight};

/// Local-only dialog data: gh status, secrets scan, static-site detection.
#[tauri::command]
pub async fn publish_preflight(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PublishPreflight, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let (settings, _) = state.settings();
        github::publish_preflight(&dir, &settings.path_additions)
    })
    .await
}

/// Explicit-consent network operation: push (creating the public repository
/// if needed) and enable GitHub Pages. Free tier only; re-runs the secrets
/// scan as defense in depth.
#[tauri::command]
pub async fn publish_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PublishOutcome, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let (settings, _) = state.settings();
        let outcome = github::publish(&dir, &settings.path_additions)?;
        // A live Pages URL is this project's production link - record it
        // (first publish only; a hand-set URL is never overwritten).
        if let Some(url) = &outcome.pages_url {
            let _ = state.update_projects(|projects| {
                if let Some(p) = projects.iter_mut().find(|p| p.id == id) {
                    if p.production_url.is_none() {
                        p.production_url = Some(url.clone());
                    }
                }
                Ok(())
            });
        }
        Ok(outcome)
    })
    .await
}

/// Explicit-consent network operation: create a private GitHub repository
/// for a project that has none and push to it. Secrets-gated like publish.
#[tauri::command]
pub async fn github_backup(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(String, GitInfo), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let (settings, _) = state.settings();
        let url = github::backup(&dir, &settings.path_additions)?;
        Ok((url, git_info_one(&state, &id, true)))
    })
    .await
}

/// One-line commit message for the uncommitted changes via the user's own
/// Claude Code CLI. Explicit-click only.
#[tauri::command]
pub async fn git_commit_message(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<String, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let (settings, _) = state.settings();
        crate::assist::commit_message(&dir, &settings.path_additions)
    })
    .await
}

// ---------------------------------------------------------------------------
// Try an idea safely (experiments)

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Audited free-form IPC exception: `label` names the experiment. It is
/// slugged (ASCII letters/digits) for the branch name and otherwise only
/// ever used as a single `-m` argv element, like a commit message.
#[tauri::command]
pub async fn experiment_start(
    state: State<'_, Arc<AppState>>,
    id: String,
    label: String,
) -> Result<(ProjectView, GitInfo), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let label: String = label.trim().chars().filter(|c| !c.is_control()).take(200).collect();
        if label.is_empty() {
            return Err(AppError::InvalidInput { detail: "describe the idea first".into() });
        }
        let (base, branch) = crate::git::experiment::start(&dir, &label)?;
        let updated = state.update_projects(|projects| {
            let project = projects
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or_else(|| AppError::ProjectNotFound { id: id.clone() })?;
            project.experiment = Some(crate::project::Experiment {
                label: label.clone(),
                base,
                branch,
                started_at: now_secs(),
            });
            Ok(project.clone())
        })?;
        Ok((project::view(&updated), state.refresh_git_info(&id, &dir)))
    })
    .await
}

fn take_experiment(state: &AppState, id: &str) -> Result<crate::project::Experiment, AppError> {
    let (projects, _) = state.projects();
    projects
        .iter()
        .find(|p| p.id == id)
        .and_then(|p| p.experiment.clone())
        .ok_or_else(|| AppError::InvalidInput { detail: "no experiment in progress".into() })
}

fn clear_experiment(state: &AppState, id: &str) -> Result<ProjectView, AppError> {
    let updated = state.update_projects(|projects| {
        let project = projects
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| AppError::ProjectNotFound { id: id.to_string() })?;
        project.experiment = None;
        Ok(project.clone())
    })?;
    Ok(project::view(&updated))
}

/// Commit the experiment's work and merge it into the base branch. On
/// conflicts the ordinary merge-in-progress state remains (MergeBanner);
/// the record is cleared either way - the try branch is deleted after a
/// clean merge and otherwise left for Git tools.
#[tauri::command]
pub async fn experiment_keep(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(crate::git::ops::MergeOutcome, ProjectView, GitInfo), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let exp = take_experiment(&state, &id)?;
        let message = format!("Try: {}", exp.label);
        let outcome = crate::git::experiment::keep(&dir, &exp.base, &exp.branch, &message)?;
        let view = clear_experiment(&state, &id)?;
        Ok((outcome, view, state.refresh_git_info(&id, &dir)))
    })
    .await
}

/// Abandon the experiment: work is pinned under a snapshot (History can
/// restore it), the project returns to the base branch.
#[tauri::command]
pub async fn experiment_discard(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(ProjectView, GitInfo), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        require_git(&state)?;
        let exp = take_experiment(&state, &id)?;
        crate::git::experiment::discard(&dir, &exp.base, &exp.branch, &exp.label)?;
        let view = clear_experiment(&state, &id)?;
        Ok((view, state.refresh_git_info(&id, &dir)))
    })
    .await
}

// ---------------------------------------------------------------------------
// Reclaimable disk space

#[tauri::command]
pub async fn project_disk_usage(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<crate::project::disk::DiskUsage, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        Ok(crate::project::disk::scan(&dir))
    })
    .await
}

/// Delete regenerable folders. `rels` are display keys from a scan; the
/// backend re-scans and refuses anything not on the allowlist or not a
/// plain directory inside the project.
#[tauri::command]
pub async fn project_disk_clean(
    state: State<'_, Arc<AppState>>,
    id: String,
    rels: Vec<String>,
) -> Result<u64, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        crate::project::disk::clean(&dir, &rels)
    })
    .await
}

// ---------------------------------------------------------------------------
// Local settings (.env)

#[tauri::command]
pub async fn project_env_status(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<crate::project::env::EnvStatus, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        crate::project::env::status(&dir)
    })
    .await
}

/// Audited free-form IPC exception: `value` is written verbatim (control
/// characters stripped, length-capped) as one `KEY=value` line into the
/// fixed-name `.env` file directly inside the project; `key` must match
/// `[A-Za-z_][A-Za-z0-9_]*`. Values are never returned unmasked.
#[tauri::command]
pub async fn project_env_set(
    state: State<'_, Arc<AppState>>,
    id: String,
    key: String,
    value: String,
) -> Result<crate::project::env::EnvStatus, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        crate::project::env::set(&dir, &key, &value)?;
        crate::project::env::status(&dir)
    })
    .await
}

// ---------------------------------------------------------------------------
// Session transcripts

#[tauri::command]
pub async fn transcripts_list(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<crate::transcript::TranscriptMeta>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        state.resolve_dir(&id)?;
        Ok(crate::transcript::list(&state.config_dir, &id))
    })
    .await
}

/// Plain-language summary of a saved transcript via the user's own Claude
/// CLI. Explicit click only. `file` is a name from transcripts_list.
#[tauri::command]
pub async fn transcript_summarize(
    state: State<'_, Arc<AppState>>,
    id: String,
    file: String,
) -> Result<String, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        let (settings, _) = state.settings();
        crate::transcript::summarize(&state.config_dir, &dir, &id, &file, &settings.path_additions)
    })
    .await
}

#[tauri::command]
pub async fn transcript_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
    file: String,
) -> Result<(), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        state.resolve_dir(&id)?;
        crate::transcript::delete(&state.config_dir, &id, &file)
    })
    .await
}

#[tauri::command]
pub async fn transcripts_open_folder(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        state.resolve_dir(&id)?;
        let dir = crate::transcript::folder(&state.config_dir, &id);
        std::fs::create_dir_all(&dir)?;
        tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| {
            AppError::LaunchFailed { program: "file manager".into(), detail: e.to_string() }
        })
    })
    .await
}

/// Explicit-click network operation: `npm outdated` / `pnpm outdated`
/// against the registry. Read-only for the project.
#[tauri::command]
pub async fn project_outdated(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<crate::audit::OutdatedReport, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&id)?;
        let (settings, _) = state.settings();
        crate::audit::outdated(&dir, &settings.path_additions)
    })
    .await
}

// ---------------------------------------------------------------------------
// Setup doctor

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorItem {
    pub id: String,
    pub label: String,
    pub ok: bool,
    pub detail: Option<String>,
    /// True when doctor_fix knows how to help with this item.
    pub fixable: bool,
}

fn home_dir() -> std::path::PathBuf {
    // HOME on unix, USERPROFILE on Windows.
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(std::env::temp_dir)
}

#[tauri::command]
pub async fn doctor_status(state: State<'_, Arc<AppState>>) -> Result<Vec<DoctorItem>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (settings, _) = state.settings();
        let mut items = Vec::new();

        let git_version = state.git_version();
        items.push(DoctorItem {
            id: "git".into(),
            label: "Git installed".into(),
            ok: git_version.is_some(),
            detail: git_version.clone().or_else(|| Some("Install from git-scm.com or via Xcode command line tools".into())),
            fixable: false,
        });

        if git_version.is_some() {
            let home = home_dir();
            let get = |key: &str| {
                crate::git::runner::git(&home, &["config", "--get", key])
                    .ok()
                    .filter(|o| o.success)
                    .map(|o| o.stdout.trim().to_string())
                    .filter(|v| !v.is_empty())
            };
            let name = get("user.name");
            let email = get("user.email");
            let ok = name.is_some() && email.is_some();
            items.push(DoctorItem {
                id: "gitIdentity".into(),
                label: "Git knows who you are".into(),
                ok,
                detail: if ok {
                    Some(format!("{} <{}>", name.unwrap_or_default(), email.unwrap_or_default()))
                } else {
                    Some("Needed to save commits. Run: git config --global user.name \"Your Name\" and git config --global user.email you@example.com".into())
                },
                fixable: false,
            });
        }

        let claude = which::resolve_program("claude", &settings.path_additions);
        items.push(DoctorItem {
            id: "claude".into(),
            label: "Claude Code installed".into(),
            ok: claude.is_some(),
            detail: claude
                .map(|p| p.display().to_string())
                .or_else(|| Some("Install with: npm install -g @anthropic-ai/claude-code - then run claude once to log in".into())),
            fixable: false,
        });

        if settings.agent.kind != "claude" {
            let agent = launcher::resolve_agent(&settings, None);
            items.push(DoctorItem {
                id: "agent".into(),
                label: format!(
                    "Agent configured ({})",
                    agent.as_ref().map(|a| a.label.clone()).unwrap_or_else(|_| settings.agent.kind.clone())
                ),
                ok: agent.is_ok(),
                detail: agent.err().map(|e| e.to_string()),
                fixable: false,
            });
        }

        let gh = github::status(&settings.path_additions);
        items.push(DoctorItem {
            id: "gh".into(),
            label: "GitHub CLI installed".into(),
            ok: gh.installed,
            detail: (!gh.installed).then(|| "Needed for creating repositories and publishing. Install from cli.github.com".into()),
            fixable: false,
        });
        if gh.installed {
            items.push(DoctorItem {
                id: "ghAuth".into(),
                label: "GitHub account connected".into(),
                ok: gh.authenticated,
                detail: (!gh.authenticated).then(|| "Fix opens your terminal with the GitHub login".into()),
                fixable: !gh.authenticated,
            });
        }

        let node = which::resolve_program("node", &settings.path_additions);
        items.push(DoctorItem {
            id: "node".into(),
            label: "Node.js installed".into(),
            ok: node.is_some(),
            detail: node
                .map(|p| p.display().to_string())
                .or_else(|| Some("Optional - needed to run most web projects. Install from nodejs.org".into())),
            fixable: false,
        });

        Ok(items)
    })
    .await
}

/// Run the guided fix for a doctor item. Closed set of kinds; each fix is a
/// fixed argv opened in the user's own terminal, exactly like Open Agent.
#[tauri::command]
pub async fn doctor_fix(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    kind: String,
) -> Result<(), AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (settings, _) = state.settings();
        match kind.as_str() {
            "ghAuth" => {
                let gh = which::resolve_program("gh", &settings.path_additions)
                    .ok_or(AppError::GhUnavailable)?;
                let cache_dir = app
                    .path()
                    .app_cache_dir()
                    .map_err(|e| AppError::Io { detail: e.to_string() })?;
                launcher::open_terminal_running(
                    &settings,
                    &home_dir(),
                    gh,
                    vec!["auth".into(), "login".into()],
                    &cache_dir,
                )
            }
            _ => Err(AppError::InvalidInput { detail: format!("no fix available for '{kind}'") }),
        }
    })
    .await
}

// ---------------------------------------------------------------------------
// Ideas checklist

use crate::project::ideas::{self, IdeaItem};

/// Resolve the IDEAS.md for a project, or the general one (config dir) for
/// `id: None`. Returns None when the file does not exist yet.
fn ideas_path(state: &Arc<AppState>, id: Option<&str>) -> Result<Option<std::path::PathBuf>, AppError> {
    match id {
        Some(id) => {
            let dir = state.resolve_dir(id)?;
            Ok(crate::project::docs::find_doc(&dir, crate::project::docs::DocKind::Ideas, None))
        }
        None => {
            let path = state.config_dir.join("IDEAS.md");
            Ok(path.is_file().then_some(path))
        }
    }
}

#[tauri::command]
pub async fn ideas_list(
    state: State<'_, Arc<AppState>>,
    id: Option<String>,
) -> Result<Vec<IdeaItem>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let Some(path) = ideas_path(&state, id.as_deref())? else {
            return Ok(Vec::new());
        };
        let content = std::fs::read_to_string(&path)?;
        Ok(ideas::parse(&content))
    })
    .await
}

/// Toggle one checklist item in IDEAS.md. The line handle is re-validated
/// against the current file content; a mismatch (file edited meanwhile)
/// fails with a friendly conflict instead of corrupting the file.
#[tauri::command]
pub async fn idea_set_done(
    state: State<'_, Arc<AppState>>,
    id: Option<String>,
    line: u32,
    done: bool,
) -> Result<Vec<IdeaItem>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let Some(path) = ideas_path(&state, id.as_deref())? else {
            return Err(AppError::InvalidInput { detail: "IDEAS.md not found".into() });
        };
        let content = std::fs::read_to_string(&path)?;
        let updated = ideas::set_done(&content, line, done).ok_or_else(|| AppError::InvalidInput {
            detail: "IDEAS.md changed since it was loaded - reload and try again".into(),
        })?;
        std::fs::write(&path, &updated)?;
        Ok(ideas::parse(&updated))
    })
    .await
}

/// The roadmap's checklist items (`- [ ]`), parsed with the same rules as
/// IDEAS.md so roadmap entries get "Build this" too. Empty for a prose-only
/// roadmap (the frontend then renders the markdown as before).
fn roadmap_path(state: &Arc<AppState>, id: &str) -> Result<Option<std::path::PathBuf>, AppError> {
    let dir = state.resolve_dir(id)?;
    let (projects, _) = state.projects();
    let configured = projects.iter().find(|p| p.id == id).and_then(|p| p.roadmap_file.clone());
    Ok(crate::project::docs::find_doc(&dir, crate::project::docs::DocKind::Roadmap, configured.as_deref()))
}

#[tauri::command]
pub async fn roadmap_items(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<IdeaItem>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let Some(path) = roadmap_path(&state, &id)? else {
            return Ok(Vec::new());
        };
        let content = std::fs::read_to_string(&path)?;
        Ok(ideas::parse(&content))
    })
    .await
}

/// Toggle one roadmap checklist item - same positional re-validation as
/// idea_set_done, same single-file write inside the project.
#[tauri::command]
pub async fn roadmap_set_done(
    state: State<'_, Arc<AppState>>,
    id: String,
    line: u32,
    done: bool,
) -> Result<Vec<IdeaItem>, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let Some(path) = roadmap_path(&state, &id)? else {
            return Err(AppError::InvalidInput { detail: "roadmap file not found".into() });
        };
        let content = std::fs::read_to_string(&path)?;
        let updated = ideas::set_done(&content, line, done).ok_or_else(|| AppError::InvalidInput {
            detail: "the roadmap changed since it was loaded - reload and try again".into(),
        })?;
        std::fs::write(&path, &updated)?;
        Ok(ideas::parse(&updated))
    })
    .await
}

// ---------------------------------------------------------------------------
// Activity / progress (gamification)

/// Raw material for the Progress page, computed entirely from local data:
/// commit timestamps come from each repository's own log (branches only -
/// snapshot refs excluded), idea counts from IDEAS.md files. Timestamps are
/// bucketed into days on the frontend, where the user's timezone lives.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActivity {
    pub project_id: String,
    /// Commit times (unix seconds) in the last ~53 weeks, newest first.
    pub commit_timestamps: Vec<i64>,
    /// All-time commit count across branches.
    pub total_commits: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySummary {
    pub projects: Vec<ProjectActivity>,
    pub ideas_open: u32,
    pub ideas_done: u32,
}

#[tauri::command]
pub async fn activity_summary(
    state: State<'_, Arc<AppState>>,
) -> Result<ActivitySummary, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (projects, _) = state.projects();
        let git_ready = state.git_version().is_some();
        let mut out = Vec::new();
        let mut ideas_open = 0u32;
        let mut ideas_done = 0u32;

        let count_ideas = |path: &std::path::Path, open: &mut u32, done: &mut u32| {
            if let Ok(content) = std::fs::read_to_string(path) {
                for item in ideas::parse(&content) {
                    if item.done {
                        *done += 1;
                    } else {
                        *open += 1;
                    }
                }
            }
        };

        for project in &projects {
            let Ok(dir) = state.resolve_dir(&project.id) else { continue };
            if let Some(path) =
                crate::project::docs::find_doc(&dir, crate::project::docs::DocKind::Ideas, None)
            {
                count_ideas(&path, &mut ideas_open, &mut ideas_done);
            }
            if !git_ready || !dir.join(".git").exists() {
                continue;
            }
            let log = crate::git::runner::git(
                &dir,
                &["log", "--branches", "--since=371 days ago", "--pretty=format:%ct"],
            );
            let commit_timestamps: Vec<i64> = log
                .ok()
                .filter(|o| o.success)
                .map(|o| o.stdout.lines().filter_map(|l| l.parse().ok()).collect())
                .unwrap_or_default();
            let total_commits = crate::git::runner::git(&dir, &["rev-list", "--count", "--branches"])
                .ok()
                .filter(|o| o.success)
                .and_then(|o| o.stdout.trim().parse().ok())
                .unwrap_or(0);
            out.push(ProjectActivity {
                project_id: project.id.clone(),
                commit_timestamps,
                total_commits,
            });
        }
        // General ideas (config-dir IDEAS.md) count too - finishing anything
        // should feel like progress.
        let general = state.config_dir.join("IDEAS.md");
        if general.is_file() {
            count_ideas(&general, &mut ideas_open, &mut ideas_done);
        }
        Ok(ActivitySummary { projects: out, ideas_open, ideas_done })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::civil_date;

    #[test]
    fn civil_date_from_unix_seconds() {
        assert_eq!(civil_date(0), "1970-01-01");
        assert_eq!(civil_date(86_399), "1970-01-01");
        assert_eq!(civil_date(86_400), "1970-01-02");
        assert_eq!(civil_date(1_709_164_800), "2024-02-29"); // leap day
        assert_eq!(civil_date(1_788_048_000), "2026-08-30");
        assert_eq!(civil_date(4_102_444_799), "2099-12-31");
    }
}
