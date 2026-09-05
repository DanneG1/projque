//! Dependency vulnerability check for package-manager projects, on an
//! explicit click. Runs the project's own package manager (`npm audit
//! --json` / `pnpm audit --json`) headless with fixed argv, no shell, and a
//! timeout - exactly like a run session, minus the terminal. This is a
//! network call (the dependency tree goes to the registry's advisory
//! endpoint) and is documented as such in SECURITY.md. The "Update safely"
//! fix (`npm audit fix`, never `--force`) runs as a visible run session.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::AppError;
use crate::launcher::which;

const AUDIT_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_ITEMS: usize = 60;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuditItem {
    pub name: String,
    /// critical | high | moderate | low | info
    pub severity: String,
    pub title: String,
    pub range: String,
    /// "yes" (non-breaking fix), "major" (needs a major upgrade), "no".
    pub fix: String,
    pub direct: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuditReport {
    pub manager: String,
    pub total: u32,
    pub critical: u32,
    pub high: u32,
    pub moderate: u32,
    pub low: u32,
    pub info: u32,
    /// Vulnerable packages `audit fix` can update without a breaking change.
    pub fixable: u32,
    /// Vulnerable packages whose fix is a major (breaking) upgrade.
    pub needs_major: u32,
    pub dependencies: u32,
    pub items: Vec<AuditItem>,
    /// The manager supports an automatic non-breaking fix here.
    pub can_auto_fix: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuditSupport {
    /// npm | pnpm | yarn | bun | cargo | none
    pub manager: String,
    pub supported: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OutdatedItem {
    pub name: String,
    pub current: String,
    pub wanted: String,
    pub latest: String,
    /// "major" (latest crosses a major version) | "minor" | "patch"
    pub kind: String,
    pub direct: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutdatedReport {
    pub manager: String,
    pub total: u32,
    pub major: u32,
    /// Updatable within the declared ranges (`npm update` handles these).
    pub within_range: u32,
    pub items: Vec<OutdatedItem>,
}

fn major_of(v: &str) -> Option<u64> {
    v.trim_start_matches(|c: char| !c.is_ascii_digit()).split('.').next()?.parse().ok()
}

fn bump_kind(current: &str, latest: &str) -> &'static str {
    let c: Vec<u64> = current.split('.').filter_map(|p| p.parse().ok()).collect();
    let l: Vec<u64> = latest.split('.').filter_map(|p| p.parse().ok()).collect();
    match (major_of(current), major_of(latest)) {
        (Some(a), Some(b)) if b > a => "major",
        _ if c.get(1) != l.get(1) => "minor",
        _ => "patch",
    }
}

/// `npm outdated --json` / `pnpm outdated --format json`. Both exit 1 when
/// anything is outdated, so only the JSON matters. Read-only for the
/// project; contacts the registry like audit.
pub fn outdated(dir: &Path, path_additions: &[String]) -> Result<OutdatedReport, AppError> {
    let support = support(dir);
    if support.manager != "npm" && support.manager != "pnpm" {
        return Err(AppError::InvalidInput {
            detail: support.reason.unwrap_or_else(|| "not a package-manager project".into()),
        });
    }
    let manager = support.manager;
    let program = which::resolve_program(&manager, path_additions)
        .ok_or_else(|| AppError::ProgramNotFound { program: manager.clone() })?;
    let args: &[&str] = if manager == "pnpm" {
        &["outdated", "--format", "json"]
    } else {
        &["outdated", "--json"]
    };
    let stdout = run_capture(&program, args, dir, path_additions).or_else(|e| {
        // npm prints nothing at all when nothing is outdated.
        if matches!(&e, AppError::LaunchFailed { detail, .. } if detail == "audit produced no output") {
            Ok("{}".to_string())
        } else {
            Err(e)
        }
    })?;
    let json: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or(serde_json::json!({}));
    let mut items: Vec<OutdatedItem> = Vec::new();
    if let Some(map) = json.as_object() {
        for (name, v) in map {
            let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let current = s("current");
            let latest = s("latest");
            let wanted = {
                let w = s("wanted");
                if w.is_empty() { latest.clone() } else { w }
            };
            if current.is_empty() || latest.is_empty() || current == latest {
                continue;
            }
            let direct = if manager == "pnpm" {
                true // pnpm lists direct dependencies only by default
            } else {
                v.get("dependent").and_then(|d| d.as_str()).map(|d| !d.contains('/')).unwrap_or(true)
            };
            items.push(OutdatedItem {
                name: name.clone(),
                kind: bump_kind(&current, &latest).into(),
                current,
                wanted,
                latest,
                direct,
            });
        }
    }
    items.sort_by(|a, b| {
        let rank = |k: &str| match k { "major" => 0, "minor" => 1, _ => 2 };
        rank(&a.kind).cmp(&rank(&b.kind)).then(a.name.cmp(&b.name))
    });
    items.truncate(MAX_ITEMS);
    let major = items.iter().filter(|i| i.kind == "major").count() as u32;
    let within_range = items.iter().filter(|i| i.wanted != i.current).count() as u32;
    Ok(OutdatedReport { manager, total: items.len() as u32, major, within_range, items })
}

pub fn support(dir: &Path) -> AuditSupport {
    if !dir.join("package.json").is_file() {
        return AuditSupport { manager: "none".into(), supported: false, reason: None };
    }
    let manager = crate::run::package_manager(dir);
    match manager {
        "npm" => {
            let lock = dir.join("package-lock.json").is_file() || dir.join("npm-shrinkwrap.json").is_file();
            AuditSupport {
                manager: manager.into(),
                supported: lock,
                reason: (!lock).then(|| "no package-lock.json yet - run Set up this project first".into()),
            }
        }
        "pnpm" => AuditSupport { manager: manager.into(), supported: true, reason: None },
        other => AuditSupport {
            manager: other.into(),
            supported: false,
            reason: Some(format!("{other} projects aren't checked automatically yet - ask the agent to audit dependencies")),
        },
    }
}

pub fn run(dir: &Path, path_additions: &[String]) -> Result<AuditReport, AppError> {
    let support = support(dir);
    if !support.supported {
        return Err(AppError::InvalidInput {
            detail: support.reason.unwrap_or_else(|| "not a package-manager project".into()),
        });
    }
    let manager = support.manager;
    let program = which::resolve_program(&manager, path_additions)
        .ok_or_else(|| AppError::ProgramNotFound { program: manager.clone() })?;
    let args: &[&str] = match manager.as_str() {
        "pnpm" => &["audit", "--json"],
        _ => &["audit", "--json"],
    };
    let stdout = run_capture(&program, args, dir, path_additions)?;
    let json: serde_json::Value = serde_json::from_str(stdout.trim()).map_err(|_| AppError::LaunchFailed {
        program: manager.clone(),
        detail: first_line(&stdout).unwrap_or_else(|| "audit produced no readable output".into()),
    })?;
    if let Some(err) = json.get("error") {
        let detail = err
            .get("summary")
            .and_then(|s| s.as_str())
            .or_else(|| err.get("code").and_then(|c| c.as_str()))
            .unwrap_or("audit failed")
            .to_string();
        return Err(AppError::LaunchFailed { program: manager, detail });
    }
    let mut report = parse_report(&json);
    report.manager = manager.clone();
    report.can_auto_fix = manager == "npm" && report.fixable > 0;
    Ok(report)
}

/// Both report shapes: npm 7+ (`vulnerabilities` map keyed by package) and
/// the v6 shape pnpm still emits (`advisories` map keyed by id).
pub fn parse_report(json: &serde_json::Value) -> AuditReport {
    let mut report = AuditReport::default();
    let meta = json.get("metadata").and_then(|m| m.get("vulnerabilities"));
    let count = |k: &str| meta.and_then(|m| m.get(k)).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    report.critical = count("critical");
    report.high = count("high");
    report.moderate = count("moderate");
    report.low = count("low");
    report.info = count("info");
    report.total = meta
        .and_then(|m| m.get("total"))
        .and_then(|v| v.as_u64())
        .map(|t| t as u32)
        .unwrap_or(report.critical + report.high + report.moderate + report.low + report.info);
    report.dependencies = json
        .get("metadata")
        .and_then(|m| m.get("dependencies"))
        .and_then(|d| d.get("total").and_then(|t| t.as_u64()).or_else(|| d.as_u64()))
        .or_else(|| json.get("metadata").and_then(|m| m.get("totalDependencies")).and_then(|t| t.as_u64()))
        .unwrap_or(0) as u32;

    if let Some(vulns) = json.get("vulnerabilities").and_then(|v| v.as_object()) {
        for (name, v) in vulns.iter().take(MAX_ITEMS) {
            let severity = v.get("severity").and_then(|s| s.as_str()).unwrap_or("unknown").to_string();
            let title = v
                .get("via")
                .and_then(|via| via.as_array())
                .and_then(|arr| {
                    arr.iter().find_map(|e| e.get("title").and_then(|t| t.as_str()).map(str::to_string))
                        .or_else(|| {
                            // Only transitive names: "affected through <dep>".
                            let deps: Vec<&str> = arr.iter().filter_map(|e| e.as_str()).collect();
                            (!deps.is_empty()).then(|| format!("affected through {}", deps.join(", ")))
                        })
                })
                .unwrap_or_default();
            let fix = match v.get("fixAvailable") {
                Some(serde_json::Value::Bool(true)) => "yes",
                Some(serde_json::Value::Object(o)) => {
                    if o.get("isSemVerMajor").and_then(|b| b.as_bool()).unwrap_or(false) { "major" } else { "yes" }
                }
                _ => "no",
            };
            match fix {
                "yes" => report.fixable += 1,
                "major" => report.needs_major += 1,
                _ => {}
            }
            report.items.push(AuditItem {
                name: name.clone(),
                severity,
                title,
                range: v.get("range").and_then(|r| r.as_str()).unwrap_or("").to_string(),
                fix: fix.to_string(),
                direct: v.get("isDirect").and_then(|b| b.as_bool()).unwrap_or(false),
            });
        }
    } else if let Some(advisories) = json.get("advisories").and_then(|a| a.as_object()) {
        for (_, a) in advisories.iter().take(MAX_ITEMS) {
            let patched = a.get("patched_versions").and_then(|p| p.as_str()).unwrap_or("<0.0.0");
            let fix = if patched == "<0.0.0" || patched.is_empty() { "no" } else { "major" };
            if fix == "major" {
                report.needs_major += 1;
            }
            report.items.push(AuditItem {
                name: a.get("module_name").and_then(|n| n.as_str()).unwrap_or("?").to_string(),
                severity: a.get("severity").and_then(|s| s.as_str()).unwrap_or("unknown").to_string(),
                title: a.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string(),
                range: a.get("vulnerable_versions").and_then(|r| r.as_str()).unwrap_or("").to_string(),
                fix: fix.to_string(),
                direct: a
                    .get("findings")
                    .and_then(|f| f.as_array())
                    .map(|f| {
                        f.iter().any(|x| {
                            x.get("paths")
                                .and_then(|p| p.as_array())
                                .is_some_and(|p| p.iter().any(|s| s.as_str().is_some_and(|s| !s.contains('>'))))
                        })
                    })
                    .unwrap_or(false),
            });
        }
        if report.total == 0 {
            report.total = report.items.len() as u32;
        }
    }
    let rank = |s: &str| match s {
        "critical" => 0,
        "high" => 1,
        "moderate" => 2,
        "low" => 3,
        _ => 4,
    };
    report.items.sort_by(|a, b| rank(&a.severity).cmp(&rank(&b.severity)).then(a.name.cmp(&b.name)));
    report
}

fn first_line(text: &str) -> Option<String> {
    text.lines().map(str::trim).find(|l| !l.is_empty()).map(|l| l.chars().take(200).collect())
}

/// Run `<program> args` in `dir`, capture stdout, bounded. Audit exits
/// non-zero when it finds anything, so the exit code is not an error here -
/// the JSON is parsed regardless.
fn run_capture(program: &Path, args: &[&str], dir: &Path, path_additions: &[String]) -> Result<String, AppError> {
    let name = program.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut child = Command::new(program)
        .args(args)
        .current_dir(dir)
        .env("PATH", which::augmented_path(path_additions))
        .env("NO_COLOR", "1")
        .env("CI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::LaunchFailed { program: name.clone(), detail: e.to_string() })?;
    let mut out_pipe = child.stdout.take().expect("piped");
    let out_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out_pipe.read_to_end(&mut buf);
        buf
    });
    let mut err_pipe = child.stderr.take().expect("piped");
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = err_pipe.read_to_end(&mut buf);
        buf
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > AUDIT_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::LaunchFailed { program: name, detail: "audit timed out".into() });
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(AppError::LaunchFailed { program: name, detail: e.to_string() }),
        }
    }
    let stdout = String::from_utf8_lossy(&out_reader.join().unwrap_or_default()).into_owned();
    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&err_reader.join().unwrap_or_default()).into_owned();
        return Err(AppError::LaunchFailed {
            program: name,
            detail: first_line(&stderr).unwrap_or_else(|| "audit produced no output".into()),
        });
    }
    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_npm7_report() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{"auditReportVersion":2,"vulnerabilities":{
                "minimatch":{"name":"minimatch","severity":"high","isDirect":false,
                  "via":[{"title":"ReDoS","severity":"high","range":"<3.0.5"}],"range":"<3.0.5","fixAvailable":true},
                "old-lib":{"name":"old-lib","severity":"critical","isDirect":true,
                  "via":["minimatch"],"range":"*","fixAvailable":{"name":"old-lib","version":"9.0.0","isSemVerMajor":true}},
                "stuck":{"name":"stuck","severity":"low","isDirect":false,"via":[{"title":"x"}],"range":"*","fixAvailable":false}},
              "metadata":{"vulnerabilities":{"info":0,"low":1,"moderate":0,"high":1,"critical":1,"total":3},
                "dependencies":{"prod":10,"dev":20,"total":30}}}"#,
        )
        .unwrap();
        let r = parse_report(&json);
        assert_eq!((r.total, r.critical, r.high, r.low), (3, 1, 1, 1));
        assert_eq!((r.fixable, r.needs_major), (1, 1));
        assert_eq!(r.dependencies, 30);
        assert_eq!(r.items[0].name, "old-lib"); // critical first
        assert_eq!(r.items[0].fix, "major");
        assert_eq!(r.items[0].title, "affected through minimatch");
        assert_eq!(r.items[1].title, "ReDoS");
        assert_eq!(r.items[2].fix, "no");
    }

    #[test]
    fn parses_v6_report() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{"advisories":{"1":{"module_name":"lodash","severity":"moderate","title":"Prototype Pollution",
                "vulnerable_versions":"<4.17.21","patched_versions":">=4.17.21","findings":[{"paths":["lodash"]}]}},
              "metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":1,"high":0,"critical":0},"totalDependencies":120}}"#,
        )
        .unwrap();
        let r = parse_report(&json);
        assert_eq!(r.total, 1);
        assert_eq!(r.dependencies, 120);
        assert_eq!(r.items[0].name, "lodash");
        assert!(r.items[0].direct);
    }

    #[test]
    fn clean_report() {
        let json: serde_json::Value =
            serde_json::from_str(r#"{"vulnerabilities":{},"metadata":{"vulnerabilities":{"total":0},"dependencies":{"total":5}}}"#)
                .unwrap();
        let r = parse_report(&json);
        assert_eq!(r.total, 0);
        assert!(r.items.is_empty());
    }
}

#[cfg(test)]
mod outdated_tests {
    use super::bump_kind;

    #[test]
    fn classifies_bumps() {
        assert_eq!(bump_kind("1.2.3", "2.0.0"), "major");
        assert_eq!(bump_kind("1.2.3", "1.3.0"), "minor");
        assert_eq!(bump_kind("1.2.3", "1.2.9"), "patch");
        assert_eq!(bump_kind("0.9.0", "0.10.0"), "minor");
    }
}
