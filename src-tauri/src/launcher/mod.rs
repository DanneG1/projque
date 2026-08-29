pub mod catalog;
mod terminal;
pub(crate) mod which;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::error::AppError;
use crate::settings::{Settings, ToolConfig};

use catalog::{ProgramSpec, TerminalSpec, TerminalStrategy};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub kind: String,
    pub label: String,
    pub program: String,
    pub installed: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LauncherCatalog {
    pub platform: String,
    pub editors: Vec<CatalogEntry>,
    pub terminals: Vec<CatalogEntry>,
    pub agents: Vec<CatalogEntry>,
}

/// The catalog filtered to the current OS, with an `installed` probe so the
/// settings UI can grey out missing tools.
pub fn build_catalog(settings: &Settings) -> LauncherCatalog {
    let platform = catalog::current_platform();
    let additions = &settings.path_additions;
    let program_entry = |s: &ProgramSpec| CatalogEntry {
        kind: s.kind.into(),
        label: s.label.into(),
        program: s.program.into(),
        installed: which::resolve_program(s.program, additions).is_some(),
    };
    let terminal_entry = |s: &TerminalSpec| CatalogEntry {
        kind: s.kind.into(),
        label: s.label.into(),
        program: s.program.into(),
        installed: match s.strategy {
            TerminalStrategy::Argv => which::resolve_program(s.program, additions).is_some(),
            #[cfg(target_os = "macos")]
            TerminalStrategy::MacApp => which::mac_app_installed(s.program),
            #[cfg(not(target_os = "macos"))]
            TerminalStrategy::MacApp => false,
        },
    };
    LauncherCatalog {
        platform: platform.into(),
        editors: catalog::EDITORS
            .iter()
            .filter(|s| s.platforms.contains(&platform))
            .map(program_entry)
            .collect(),
        terminals: catalog::TERMINALS
            .iter()
            .filter(|s| s.platforms.contains(&platform))
            .map(terminal_entry)
            .collect(),
        agents: catalog::AGENTS
            .iter()
            .filter(|s| s.platforms.contains(&platform))
            .map(program_entry)
            .collect(),
    }
}

/// Open the project directory in the OS file manager.
pub fn open_folder(dir: &Path) -> Result<(), AppError> {
    tauri_plugin_opener::open_path(dir, None::<&str>).map_err(|e| AppError::LaunchFailed {
        program: "file manager".into(),
        detail: e.to_string(),
    })
}

/// Resolve a configured tool (editor or agent) to `(program_path, args)`.
/// The kind must exist in the static catalog unless a hand-edited `command`
/// override is present in settings.json.
fn resolve_tool(
    config: &ToolConfig,
    spec: Option<&'static ProgramSpec>,
    settings: &Settings,
) -> Result<(PathBuf, Vec<String>), AppError> {
    let (program, base_args): (&str, Vec<String>) = match (&config.command, spec) {
        // Hand-edited override wins; exec'd as argv, never through a shell.
        (Some(command), _) => (command.as_str(), config.args.clone()),
        (None, Some(spec)) => (spec.program, spec.args.iter().map(|s| s.to_string()).collect()),
        (None, None) => {
            return Err(AppError::InvalidInput {
                detail: format!("unrecognized tool '{}' — pick one in Settings", config.kind),
            })
        }
    };
    let resolved = which::resolve_program(program, &settings.path_additions)
        .ok_or_else(|| AppError::ProgramNotFound { program: program.to_string() })?;
    Ok((resolved, base_args))
}

/// Open the configured editor with the project directory as its argument.
pub fn open_editor(settings: &Settings, dir: &Path) -> Result<(), AppError> {
    let spec = catalog::find_editor(&settings.editor.kind);
    let (program, mut args) = resolve_tool(&settings.editor, spec, settings)?;
    args.push(dir.display().to_string());
    spawn_detached(&program, &args, None)
}

/// Open the configured terminal with cwd = project directory.
pub fn open_terminal(settings: &Settings, dir: &Path) -> Result<(), AppError> {
    terminal::open(settings, dir, None)
}

/// Open the configured terminal at the project directory, running the
/// configured agent. The agent command comes from the static catalog (or the
/// hand-edited settings override) — never from the frontend.
pub fn open_agent(settings: &Settings, dir: &Path, cache_dir: &Path) -> Result<(), AppError> {
    let spec = catalog::find_agent(&settings.agent.kind);
    let (program, args) = resolve_tool(&settings.agent, spec, settings)?;
    terminal::open(settings, dir, Some(terminal::AgentCommand { program, args, cache_dir }))
}

pub struct ResolvedAgent {
    pub kind: String,
    pub label: String,
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// Resolve an agent for an embedded session. `kind: None` means the
/// configured default (including any hand-edited settings override);
/// an explicit kind must exist in the static catalog for this platform.
pub fn resolve_agent(settings: &Settings, kind: Option<&str>) -> Result<ResolvedAgent, AppError> {
    let effective_kind = kind.unwrap_or(&settings.agent.kind);
    let spec = catalog::find_agent(effective_kind);
    if kind.is_some() && spec.is_none() {
        return Err(AppError::InvalidInput {
            detail: format!("unknown agent kind '{effective_kind}'"),
        });
    }
    // The settings override applies only when launching the configured kind.
    let config = if effective_kind == settings.agent.kind {
        settings.agent.clone()
    } else {
        crate::settings::ToolConfig {
            kind: effective_kind.to_string(),
            command: None,
            args: Vec::new(),
        }
    };
    let (program, args) = resolve_tool(&config, spec, settings)?;
    Ok(ResolvedAgent {
        kind: effective_kind.to_string(),
        label: spec.map(|s| s.label.to_string()).unwrap_or_else(|| effective_kind.to_string()),
        program,
        args,
    })
}

/// Spawn a process detached from the app, with no shell involvement.
pub(super) fn spawn_detached(
    program: &Path,
    args: &[String],
    cwd: Option<&Path>,
) -> Result<(), AppError> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| AppError::LaunchFailed {
            program: program.display().to_string(),
            detail: e.to_string(),
        })
}
