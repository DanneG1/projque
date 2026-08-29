//! The static allowlist of launchable programs. This table is the entire
//! extensibility story: adding support for a new editor, terminal, or agent
//! is one reviewable const line. Nothing is registered dynamically and the
//! frontend can only refer to entries by their `kind`.

pub const MACOS: &str = "macos";
pub const WINDOWS: &str = "windows";
pub const LINUX: &str = "linux";
const ALL: &[&str] = &[MACOS, WINDOWS, LINUX];

#[derive(Clone, Copy, Debug)]
pub struct ProgramSpec {
    pub kind: &'static str,
    pub label: &'static str,
    /// Executable name resolved against PATH (never a shell string).
    pub program: &'static str,
    pub args: &'static [&'static str],
    pub platforms: &'static [&'static str],
    /// Agents only: accepts an initial prompt as a positional argument.
    pub prompt_arg: bool,
}

pub const EDITORS: &[ProgramSpec] = &[
    ProgramSpec { kind: "vscode", label: "Visual Studio Code", program: "code", args: &[], platforms: ALL, prompt_arg: false },
    ProgramSpec { kind: "cursor", label: "Cursor", program: "cursor", args: &[], platforms: ALL, prompt_arg: false },
    ProgramSpec { kind: "zed", label: "Zed", program: "zed", args: &[], platforms: &[MACOS, LINUX], prompt_arg: false },
    ProgramSpec { kind: "sublime", label: "Sublime Text", program: "subl", args: &[], platforms: ALL, prompt_arg: false },
    ProgramSpec { kind: "intellij", label: "IntelliJ IDEA", program: "idea", args: &[], platforms: ALL, prompt_arg: false },
    ProgramSpec { kind: "rider", label: "JetBrains Rider", program: "rider", args: &[], platforms: ALL, prompt_arg: false },
    ProgramSpec { kind: "webstorm", label: "WebStorm", program: "webstorm", args: &[], platforms: ALL, prompt_arg: false },
];

pub const AGENTS: &[ProgramSpec] = &[
    ProgramSpec { kind: "claude", label: "Claude Code", program: "claude", args: &[], platforms: ALL, prompt_arg: true },
    ProgramSpec { kind: "codex", label: "Codex CLI", program: "codex", args: &[], platforms: ALL, prompt_arg: true },
    ProgramSpec { kind: "aider", label: "Aider", program: "aider", args: &[], platforms: ALL, prompt_arg: false },
    ProgramSpec { kind: "gemini", label: "Gemini CLI", program: "gemini", args: &[], platforms: ALL, prompt_arg: true },
    ProgramSpec { kind: "opencode", label: "opencode", program: "opencode", args: &[], platforms: ALL, prompt_arg: true },
    ProgramSpec { kind: "cursor-agent", label: "Cursor Agent", program: "cursor-agent", args: &[], platforms: ALL, prompt_arg: false },
];

/// How a terminal is asked to open at a directory (and optionally run a
/// command there).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalStrategy {
    /// The terminal accepts cwd and command as plain argv. No shell involved.
    Argv,
    /// A macOS GUI app with no "run this command" flag. Opening a directory
    /// works directly; running a command uses a generated one-shot
    /// `.command` file (see terminal.rs).
    MacApp,
}

#[derive(Clone, Copy, Debug)]
pub struct TerminalSpec {
    pub kind: &'static str,
    pub label: &'static str,
    /// Executable name (Argv) or application name for `open -a` (MacApp).
    pub program: &'static str,
    pub platforms: &'static [&'static str],
    pub strategy: TerminalStrategy,
}

pub const TERMINALS: &[TerminalSpec] = &[
    TerminalSpec { kind: "macos-terminal", label: "Terminal", program: "Terminal", platforms: &[MACOS], strategy: TerminalStrategy::MacApp },
    TerminalSpec { kind: "iterm2", label: "iTerm2", program: "iTerm", platforms: &[MACOS], strategy: TerminalStrategy::MacApp },
    TerminalSpec { kind: "windows-terminal", label: "Windows Terminal", program: "wt", platforms: &[WINDOWS], strategy: TerminalStrategy::Argv },
    TerminalSpec { kind: "kitty", label: "kitty", program: "kitty", platforms: &[MACOS, LINUX], strategy: TerminalStrategy::Argv },
    TerminalSpec { kind: "alacritty", label: "Alacritty", program: "alacritty", platforms: ALL, strategy: TerminalStrategy::Argv },
    TerminalSpec { kind: "wezterm", label: "WezTerm", program: "wezterm", platforms: ALL, strategy: TerminalStrategy::Argv },
    TerminalSpec { kind: "ghostty", label: "Ghostty", program: "ghostty", platforms: &[MACOS, LINUX], strategy: TerminalStrategy::Argv },
    TerminalSpec { kind: "gnome-terminal", label: "GNOME Terminal", program: "gnome-terminal", platforms: &[LINUX], strategy: TerminalStrategy::Argv },
    TerminalSpec { kind: "konsole", label: "Konsole", program: "konsole", platforms: &[LINUX], strategy: TerminalStrategy::Argv },
];

pub fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        MACOS
    } else if cfg!(target_os = "windows") {
        WINDOWS
    } else {
        LINUX
    }
}

pub fn find_editor(kind: &str) -> Option<&'static ProgramSpec> {
    EDITORS.iter().find(|s| s.kind == kind && s.platforms.contains(&current_platform()))
}

pub fn find_agent(kind: &str) -> Option<&'static ProgramSpec> {
    AGENTS.iter().find(|s| s.kind == kind && s.platforms.contains(&current_platform()))
}

pub fn find_terminal(kind: &str) -> Option<&'static TerminalSpec> {
    TERMINALS.iter().find(|s| s.kind == kind && s.platforms.contains(&current_platform()))
}
