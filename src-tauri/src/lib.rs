mod commands;
mod config;
mod discovery;
mod error;
mod git;
mod launcher;
mod project;
mod settings;
mod state;

use std::sync::Arc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            app.manage(Arc::new(state::AppState::new(config_dir)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_config_status,
            commands::app_open_config_dir,
            commands::settings_get,
            commands::settings_set_display,
            commands::projects_list,
            commands::project_add_manual,
            commands::project_update,
            commands::project_remove,
            commands::project_relocate,
            commands::settings_add_project_root,
            commands::settings_remove_project_root,
            commands::settings_set_scan_depth,
            commands::discovery_scan,
            commands::discovery_import,
            commands::launcher_catalog,
            commands::settings_set_editor,
            commands::settings_set_terminal,
            commands::settings_set_agent,
            commands::project_launch,
            commands::git_availability,
            commands::git_info_many,
            commands::project_document,
            commands::open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
