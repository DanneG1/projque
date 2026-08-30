//! Opening terminals, with or without a command to run.
//!
//! Two strategies (see catalog.rs):
//! - Argv terminals take cwd and command as plain arguments - no shell.
//! - macOS GUI terminals (Terminal.app, iTerm2) have no such flags. Opening
//!   a directory uses `open -a <App> <dir>`. Running the agent generates a
//!   one-shot `.command` script (mode 0700, in our own cache dir, pruned
//!   after an hour) and hands it to the app. This avoids the osascript
//!   route, which needs the Automation TCC permission and double escaping.

use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::launcher::catalog::{self, TerminalStrategy};
use crate::launcher::{spawn_detached, which};
use crate::settings::Settings;

pub struct AgentCommand<'a> {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cache_dir: &'a Path,
}

pub fn open(settings: &Settings, dir: &Path, agent: Option<AgentCommand>) -> Result<(), AppError> {
    let config = &settings.terminal;
    let spec = catalog::find_terminal(&config.kind);

    // Hand-edited `command` override: treated as an Argv-style terminal that
    // takes the directory as its last argument. Documented in SECURITY.md.
    if let Some(command) = &config.command {
        let resolved = which::resolve_program(command, &settings.path_additions)
            .ok_or_else(|| AppError::ProgramNotFound { program: command.clone() })?;
        let mut args = config.args.clone();
        args.push(dir.display().to_string());
        return spawn_detached(&resolved, &args, None);
    }

    let Some(spec) = spec else {
        return Err(AppError::InvalidInput {
            detail: format!("unrecognized terminal '{}' - pick one in Settings", config.kind),
        });
    };

    match spec.strategy {
        TerminalStrategy::Argv => {
            let resolved = which::resolve_program(spec.program, &settings.path_additions)
                .ok_or_else(|| AppError::ProgramNotFound { program: spec.program.to_string() })?;
            let args = argv_invocation(spec.kind, dir, agent.as_ref());
            spawn_detached(&resolved, &args, None)
        }
        TerminalStrategy::MacApp => mac_app_open(spec.program, dir, agent.as_ref()),
    }
}

/// Per-terminal argument shapes. Everything is argv - the directory and the
/// agent command are separate arguments, never a concatenated string.
fn argv_invocation(kind: &str, dir: &Path, agent: Option<&AgentCommand>) -> Vec<String> {
    let dir_s = dir.display().to_string();
    let mut args: Vec<String> = match kind {
        "kitty" => vec!["--directory".into(), dir_s],
        "alacritty" => vec!["--working-directory".into(), dir_s],
        "wezterm" => vec!["start".into(), "--cwd".into(), dir_s],
        "ghostty" => vec![format!("--working-directory={dir_s}")],
        "windows-terminal" => vec!["-d".into(), dir_s],
        "gnome-terminal" => vec![format!("--working-directory={dir_s}")],
        "konsole" => vec!["--workdir".into(), dir_s],
        _ => vec![],
    };
    if let Some(agent) = agent {
        let separator: Option<&str> = match kind {
            "kitty" | "wezterm" | "gnome-terminal" | "windows-terminal" => Some("--"),
            "alacritty" | "ghostty" | "konsole" => Some("-e"),
            _ => None,
        };
        if let Some(sep) = separator {
            args.push(sep.into());
        }
        args.push(agent.program.display().to_string());
        args.extend(agent.args.iter().cloned());
    }
    args
}

#[cfg(target_os = "macos")]
fn mac_app_open(app_name: &str, dir: &Path, agent: Option<&AgentCommand>) -> Result<(), AppError> {
    let open = Path::new("/usr/bin/open");
    match agent {
        None => {
            // Exactly the spec's example: open -a Terminal <dir>
            let args = vec!["-a".to_string(), app_name.to_string(), dir.display().to_string()];
            spawn_detached(open, &args, None)
        }
        Some(agent) => {
            let script_path = write_command_file(agent, dir)?;
            let args = vec![
                "-a".to_string(),
                app_name.to_string(),
                script_path.display().to_string(),
            ];
            spawn_detached(open, &args, None)
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn mac_app_open(_app: &str, _dir: &Path, _agent: Option<&AgentCommand>) -> Result<(), AppError> {
    Err(AppError::UnsupportedPlatform {
        detail: "macOS terminal applications are only available on macOS".into(),
    })
}

/// Generate the one-shot launcher script for Terminal.app/iTerm2. Values are
/// single-quote escaped as defence in depth - they already come from
/// Rust-side canonicalization and the static catalog, not from the frontend.
#[cfg(target_os = "macos")]
fn write_command_file(agent: &AgentCommand, dir: &Path) -> Result<PathBuf, AppError> {
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    let launch_dir = agent.cache_dir.join("agent-launch");
    std::fs::create_dir_all(&launch_dir)?;
    prune_old_scripts(&launch_dir);

    let mut script = String::from("#!/bin/sh\n");
    script.push_str(&format!("cd {} || exit 1\n", sh_quote(&dir.display().to_string())));
    script.push_str(&format!(
        "exec {}{}\n",
        sh_quote(&agent.program.display().to_string()),
        agent
            .args
            .iter()
            .map(|a| format!(" {}", sh_quote(a)))
            .collect::<String>(),
    ));

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = launch_dir.join(format!("agent-{ts}.command"));
    std::fs::write(&path, script)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))?;
    Ok(path)
}

#[cfg(target_os = "macos")]
fn prune_old_scripts(launch_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(launch_dir) else { return };
    for entry in entries.flatten() {
        let too_old = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| t.elapsed().map(|e| e.as_secs() > 3600).unwrap_or(false))
            .unwrap_or(false);
        if too_old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// POSIX single-quote escaping: wrap in single quotes, embedded quotes
/// become '\''.
#[cfg(target_os = "macos")]
fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}
