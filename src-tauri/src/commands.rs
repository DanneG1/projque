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

/// The single command that accepts a free-form string — documented as the
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

// ---------------------------------------------------------------------------
// Embedded agent sessions

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::agent::{AgentSessionView, StartSpec};
use crate::launcher::which;

#[tauri::command]
pub async fn agent_session_start(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    agent_kind: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<AgentSessionView, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let dir = state.resolve_dir(&project_id)?;
        let (settings, _) = state.settings();
        let agent = launcher::resolve_agent(&settings, agent_kind.as_deref())?;
        let path_env = which::augmented_path(&settings.path_additions);
        state.agents.start(
            app,
            StartSpec {
                project_id: &project_id,
                agent_kind: &agent.kind,
                agent_label: &agent.label,
                program: &agent.program,
                args: &agent.args,
                cwd: &dir,
                path_env: &path_env,
                rows,
                cols,
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
/// their own project directory — the trust level of typing in Terminal.app.
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
