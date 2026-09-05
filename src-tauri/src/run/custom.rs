//! Project-defined commands from `projque.json` in the repository root:
//!
//! ```json
//! { "commands": [ { "id": "lint", "label": "Lint", "program": "npm", "args": ["run", "lint"] } ] }
//! ```
//!
//! A cloned repository can carry this file, so it is treated as untrusted
//! input: the program must be one of a fixed set of well-known runners
//! (never a path), args are plain strings passed as argv (no shell), sizes
//! are capped, and nothing runs until the user has approved that exact
//! command (program + args) for that project - stored as a hash on the
//! project record, so a changed file asks again.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::RunTarget;

pub const FILE: &str = "projque.json";
pub const PREFIX: &str = "custom:";
const MAX_COMMANDS: usize = 12;
const MAX_ARGS: usize = 24;
const MAX_ARG_LEN: usize = 200;

/// Runners a project file may name. Everything else is refused at parse
/// time - a repo cannot make ProjQue run `bash`, `curl`, or a script path.
pub const ALLOWED_PROGRAMS: &[&str] = &[
    "npm", "pnpm", "yarn", "bun", "npx", "node", "deno", "cargo", "go", "dotnet", "python3", "python",
    "uv", "poetry", "pytest", "make", "gradle", "mvn", "swift", "flutter", "dart", "ruby", "bundle",
    "php", "composer", "mix", "elixir", "zig", "docker", "docker-compose", "kubectl", "terraform",
];

#[derive(Deserialize)]
struct FileShape {
    #[serde(default)]
    commands: Vec<RawCommand>,
}

#[derive(Deserialize)]
struct RawCommand {
    id: String,
    #[serde(default)]
    label: String,
    program: String,
    #[serde(default)]
    args: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomCommand {
    pub id: String,
    pub label: String,
    pub program: String,
    pub args: Vec<String>,
    /// Stable fingerprint of program + args; approval is per fingerprint.
    pub hash: String,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_arg(a: &str) -> bool {
    !a.is_empty() && a.len() <= MAX_ARG_LEN && !a.chars().any(|c| c.is_control())
}

/// FNV-1a over program and args - not security-critical (the approval is
/// about *this* content matching), just stable and dependency-free.
pub fn fingerprint(program: &str, args: &[String]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    let mut feed = |bytes: &[u8]| {
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        h ^= 0xff;
        h = h.wrapping_mul(0x100000001b3);
    };
    feed(program.as_bytes());
    for a in args {
        feed(a.as_bytes());
    }
    format!("{h:016x}")
}

/// Commands the project file defines, after validation. Invalid entries
/// are dropped silently (a malformed file is not an error the user can
/// fix from here); an unreadable file means no commands.
pub fn load(dir: &Path) -> Vec<CustomCommand> {
    let path = dir.join(FILE);
    let Ok(meta) = std::fs::symlink_metadata(&path) else { return Vec::new() };
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > 64 * 1024 {
        return Vec::new();
    }
    let Ok(text) = std::fs::read_to_string(&path) else { return Vec::new() };
    let Ok(file) = serde_json::from_str::<FileShape>(&text) else { return Vec::new() };
    let mut out: Vec<CustomCommand> = Vec::new();
    for raw in file.commands.into_iter().take(MAX_COMMANDS * 2) {
        if out.len() >= MAX_COMMANDS {
            break;
        }
        let program = raw.program.trim().to_string();
        if !valid_id(&raw.id)
            || !ALLOWED_PROGRAMS.contains(&program.as_str())
            || raw.args.len() > MAX_ARGS
            || !raw.args.iter().all(|a| valid_arg(a))
            || out.iter().any(|c| c.id == raw.id)
        {
            continue;
        }
        let label: String = raw.label.trim().chars().filter(|c| !c.is_control()).take(40).collect();
        let label = if label.is_empty() { raw.id.clone() } else { label };
        let hash = fingerprint(&program, &raw.args);
        out.push(CustomCommand { id: raw.id, label, program, args: raw.args, hash });
    }
    out
}

pub fn target_for(cmd: &CustomCommand) -> RunTarget {
    RunTarget {
        target_id: format!("{PREFIX}{}", cmd.id),
        label: cmd.label.clone(),
        runner: cmd.program.clone(),
        detail: Some(format!("{} {}", cmd.program, cmd.args.join(" ")).trim().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_hard() {
        let tmp = std::env::temp_dir().join(format!("projque-custom-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(
            tmp.join(FILE),
            r#"{ "commands": [
                { "id": "lint", "label": "Lint", "program": "npm", "args": ["run", "lint"] },
                { "id": "evil", "program": "bash", "args": ["-c", "rm -rf /"] },
                { "id": "path", "program": "/usr/bin/env", "args": ["x"] },
                { "id": "Bad Id", "program": "npm", "args": [] },
                { "id": "lint", "program": "npm", "args": ["dup"] },
                { "id": "ctl", "program": "npm", "args": ["a\nb"] }
            ] }"#,
        )
        .unwrap();
        let cmds = load(&tmp);
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].id, "lint");
        assert_eq!(cmds[0].hash, fingerprint("npm", &["run".into(), "lint".into()]));
        assert_ne!(cmds[0].hash, fingerprint("npm", &["run".into(), "lint2".into()]));
        assert_eq!(target_for(&cmds[0]).target_id, "custom:lint");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
