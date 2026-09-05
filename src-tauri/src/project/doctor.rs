//! Per-project setup check: which tools THIS project needs, derived from its
//! own manifest files, and whether each is installed. Read-only - the only
//! spawn is `<tool> --version` for an installed tool, argv-fixed, with a
//! short timeout. Nothing is installed by ProjQue; a missing tool gets a
//! plain-language pointer and an "ask the agent" hand-off in the UI.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::launcher::which;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolCheck {
    /// Program name as resolved on PATH ("node", "pnpm", "cargo").
    pub tool: String,
    pub label: String,
    /// What in the project asks for it ("package.json").
    pub reason: String,
    pub found: bool,
    pub version: Option<String>,
    /// Version the project asks for, when it says (engines.node, .nvmrc).
    pub wanted: Option<String>,
    /// Plain-language install pointer when missing.
    pub hint: String,
}

const VERSION_TIMEOUT: Duration = Duration::from_secs(3);

pub fn check(dir: &Path, path_additions: &[String]) -> Vec<ToolCheck> {
    let mut wants: Vec<(&str, &str, &str, Option<String>, &str)> = Vec::new(); // tool, label, reason, wanted, hint

    if let Ok(raw) = std::fs::read_to_string(dir.join("package.json")) {
        let json: Option<serde_json::Value> = serde_json::from_str(&raw).ok();
        let engine = json
            .as_ref()
            .and_then(|j| j.get("engines"))
            .and_then(|e| e.get("node"))
            .and_then(|n| n.as_str())
            .map(str::to_string);
        let wanted = engine.or_else(|| {
            [".nvmrc", ".node-version"]
                .iter()
                .find_map(|f| std::fs::read_to_string(dir.join(f)).ok())
                .map(|v| v.trim().trim_start_matches('v').to_string())
                .filter(|v| !v.is_empty())
        });
        wants.push(("node", "Node.js", "package.json", wanted, "Install from nodejs.org (the LTS version)"));
        let pm = if dir.join("bun.lockb").is_file() || dir.join("bun.lock").is_file() {
            ("bun", "Bun", "bun.lock", "Install from bun.sh")
        } else if dir.join("pnpm-lock.yaml").is_file() {
            ("pnpm", "pnpm", "pnpm-lock.yaml", "Install with: npm install -g pnpm")
        } else if dir.join("yarn.lock").is_file() {
            ("yarn", "Yarn", "yarn.lock", "Install with: npm install -g yarn")
        } else {
            ("npm", "npm", "package.json", "Comes with Node.js")
        };
        wants.push((pm.0, pm.1, pm.2, None, pm.3));
    }
    if dir.join("Cargo.toml").is_file() {
        wants.push(("cargo", "Rust (cargo)", "Cargo.toml", None, "Install from rustup.rs"));
    }
    if dir.join("go.mod").is_file() {
        wants.push(("go", "Go", "go.mod", None, "Install from go.dev"));
    }
    let python = dir.join("pyproject.toml").is_file()
        || dir.join("requirements.txt").is_file()
        || dir.join("Pipfile").is_file();
    if python {
        wants.push(("python3", "Python 3", "pyproject.toml / requirements.txt", None, "Install from python.org"));
        if dir.join("uv.lock").is_file() {
            wants.push(("uv", "uv", "uv.lock", None, "Install from docs.astral.sh/uv"));
        } else if dir.join("poetry.lock").is_file() {
            wants.push(("poetry", "Poetry", "poetry.lock", None, "Install from python-poetry.org"));
        } else if dir.join("Pipfile").is_file() {
            wants.push(("pipenv", "Pipenv", "Pipfile", None, "Install with: pip install pipenv"));
        }
    }
    if dir.join("Gemfile").is_file() {
        wants.push(("ruby", "Ruby", "Gemfile", None, "Install from ruby-lang.org"));
        wants.push(("bundle", "Bundler", "Gemfile", None, "Install with: gem install bundler"));
    }
    if dir.join("composer.json").is_file() {
        wants.push(("php", "PHP", "composer.json", None, "Install from php.net"));
        wants.push(("composer", "Composer", "composer.json", None, "Install from getcomposer.org"));
    }
    if has_ext(dir, "csproj") || has_ext(dir, "sln") {
        wants.push(("dotnet", ".NET SDK", "*.csproj", None, "Install from dotnet.microsoft.com"));
    }
    if dir.join("Dockerfile").is_file() || dir.join("docker-compose.yml").is_file() || dir.join("compose.yaml").is_file() {
        wants.push(("docker", "Docker", "Dockerfile", None, "Install Docker Desktop from docker.com"));
    }
    if dir.join("src-tauri").is_dir() {
        wants.push(("cargo", "Rust (cargo)", "src-tauri", None, "Install from rustup.rs"));
    }

    // De-duplicate by tool, keeping the first reason.
    let mut seen = std::collections::HashSet::new();
    wants.retain(|w| seen.insert(w.0));

    wants
        .into_iter()
        .map(|(tool, label, reason, wanted, hint)| {
            let program = which::resolve_program(tool, path_additions);
            let version = program.as_ref().and_then(|p| version_of(p, path_additions));
            ToolCheck {
                tool: tool.to_string(),
                label: label.to_string(),
                reason: reason.to_string(),
                found: program.is_some(),
                version,
                wanted,
                hint: hint.to_string(),
            }
        })
        .collect()
}

fn has_ext(dir: &Path, ext: &str) -> bool {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .any(|e| e.path().extension().is_some_and(|x| x == ext))
        })
        .unwrap_or(false)
}

/// First line of `<tool> --version`, bounded. Best-effort: None on any
/// failure or timeout (the tool still counts as found).
fn version_of(program: &Path, path_additions: &[String]) -> Option<String> {
    let mut child = Command::new(program)
        .arg("--version")
        .env("PATH", which::augmented_path(path_additions))
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > VERSION_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }
    let out = String::from_utf8_lossy(&reader.join().ok()?).into_owned();
    let line = out.lines().find(|l| !l.trim().is_empty())?.trim();
    // "node v20.1.0" / "cargo 1.80.0 (...)" / "Python 3.12.1" -> the number.
    let token = line
        .split_whitespace()
        .find(|t| t.trim_start_matches('v').chars().next().is_some_and(|c| c.is_ascii_digit()))
        .unwrap_or(line);
    Some(token.trim_start_matches('v').chars().take(24).collect())
}
