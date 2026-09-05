mod agent;
mod assist;
mod audit;
mod transcript;
mod watch;
mod commands;
mod config;
mod discovery;
mod error;
mod git;
mod github;
mod launcher;
mod project;
mod run;
mod settings;
mod state;

use std::sync::Arc;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            app.manage(Arc::new(state::AppState::new(config_dir)));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Warn before quitting while agent sessions are running; the
            // frontend shows a confirm dialog and calls app_confirm_quit.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Arc<state::AppState>>();
                let running = state.agents.running_count();
                let confirmed = state
                    .agents
                    .quit_confirmed
                    .load(std::sync::atomic::Ordering::SeqCst);
                if running > 0 && !confirmed {
                    api.prevent_close();
                    let _ = window.app_handle().emit("app:confirm-quit", running);
                }
            }
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
            commands::git_branches,
            commands::git_fetch,
            commands::git_pull_ff,
            commands::git_switch,
            commands::agent_session_start,
            commands::agent_sessions_list,
            commands::agent_session_attach,
            commands::agent_session_write,
            commands::agent_session_resize,
            commands::agent_session_kill,
            commands::agent_session_remove,
            commands::app_confirm_quit,
            commands::sessions_set_active,
            commands::github_status,
            commands::github_pr_status,
            commands::github_open_pr,
            commands::project_create,
            commands::project_clone,
            commands::project_run_targets,
            commands::run_session_start,
            commands::run_session_open_url,
            commands::idea_capture,
            commands::app_set_badge,
            commands::git_commit,
            commands::git_history,
            commands::git_snapshots,
            commands::git_restore,
            commands::git_change_summary,
            commands::publish_preflight,
            commands::publish_run,
            commands::github_backup,
            commands::git_commit_message,
            commands::settings_set_notifications,
            commands::watch_sync,
            commands::experiment_start,
            commands::experiment_keep,
            commands::experiment_discard,
            commands::project_disk_usage,
            commands::project_disk_clean,
            commands::settings_prompt_save,
            commands::settings_prompt_delete,
            commands::project_env_status,
            commands::project_env_set,
            commands::transcripts_list,
            commands::transcript_summarize,
            commands::transcript_delete,
            commands::transcripts_open_folder,
            commands::doctor_status,
            commands::doctor_fix,
            commands::ideas_list,
            commands::idea_set_done,
            commands::git_graph,
            commands::git_commit_diff,
            commands::git_workdir_diff,
            commands::git_branch_create,
            commands::git_branch_delete,
            commands::git_push,
            commands::git_merge_into,
            commands::git_merge_abort,
            commands::git_merge_complete,
            commands::git_conflicts,
            commands::activity_summary,
            commands::git_sync,
            commands::git_commit_preflight,
            commands::git_ignore_fix,
            commands::project_test_target,
            commands::project_mark_verified,
            commands::project_deploy_info,
            commands::project_doctor,
            commands::session_explain_error,
            commands::roadmap_items,
            commands::roadmap_set_done,
            commands::project_mark_cleanup,
            commands::project_debt,
            commands::project_audit_support,
            commands::project_audit_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
