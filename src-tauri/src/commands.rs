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
}

#[tauri::command]
pub async fn app_config_status(state: State<'_, Arc<AppState>>) -> Result<ConfigStatus, AppError> {
    let state = state.inner().clone();
    run_blocking(move || {
        let (_, file_state) = state.settings();
        Ok(ConfigStatus {
            config_dir: state.config_dir.display().to_string(),
            settings: file_state,
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
