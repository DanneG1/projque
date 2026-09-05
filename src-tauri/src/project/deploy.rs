//! Deployment awareness - read-only detection of how a project ALREADY gets
//! to production, so the push flow can say "pushing to main deploys this"
//! before it happens. Derived purely from files in the project (GitHub
//! Actions workflows, hosting-provider config files, the README) plus the
//! repository's default branch. ProjQue never sets up hosting or runs a
//! deploy itself; that stays with the pipeline the project owner built.

use std::path::Path;

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeployInfo {
    /// Something deployment-shaped exists in this project.
    pub detected: bool,
    /// Provider id: githubActions | githubPages | vercel | netlify | render |
    /// cloudflare | amplify | fly | heroku | firebase | docker.
    pub provider: Option<String>,
    /// Plain-language one-liner ("GitHub Actions workflow deploy.yml runs on push to main").
    pub summary: String,
    /// Branches whose push triggers a deployment (empty when unknown/manual).
    pub branches: Vec<String>,
    /// A push (to one of `branches`) starts a deployment.
    pub on_push: bool,
    /// Files the conclusion rests on - display only.
    pub evidence: Vec<String>,
    /// The README has a section about deployment worth reading.
    pub readme_mentions_deploy: bool,
}

/// Actions/tools whose presence in a workflow means "this deploys".
const DEPLOY_MARKERS: &[&str] = &[
    "actions/deploy-pages",
    "peaceiris/actions-gh-pages",
    "JamesIves/github-pages-deploy-action",
    "amondnet/vercel-action",
    "vercel deploy",
    "vercel --prod",
    "netlify deploy",
    "nwtgck/actions-netlify",
    "superfly/flyctl-actions",
    "flyctl deploy",
    "fly deploy",
    "aws-actions/",
    "aws s3 sync",
    "aws ecs",
    "azure/webapps-deploy",
    "azure/functions-action",
    "google-github-actions/deploy",
    "gcloud run deploy",
    "gcloud app deploy",
    "docker/build-push-action",
    "akhileshns/heroku-deploy",
    "FirebaseExtended/action-hosting-deploy",
    "firebase deploy",
    "cloudflare/wrangler-action",
    "wrangler deploy",
    "wrangler pages",
    "npm publish",
    "cargo publish",
    "kubectl apply",
    "helm upgrade",
    "ssh-deploy",
    "rsync",
    "appleboy/ssh-action",
];

const NAME_HINTS: &[&str] = &["deploy", "release", "publish", "pages", "production", "prod", "cd."];

struct Workflow {
    file: String,
    push_branches: Option<Vec<String>>, // None = not triggered by push
    deploys: bool,
}

pub fn detect(dir: &Path) -> DeployInfo {
    let mut info = DeployInfo::default();
    info.readme_mentions_deploy = readme_mentions_deploy(dir);
    let default_branch = default_branch(dir);

    // 1. GitHub Actions - the most explicit signal: the workflow says which
    //    branch triggers it and what it does.
    let workflows = read_workflows(dir);
    if let Some(wf) = workflows.iter().find(|w| w.deploys && w.push_branches.is_some()) {
        let mut branches = wf.push_branches.clone().unwrap_or_default();
        if branches.is_empty() {
            // `on: push` with no branch filter = every branch.
            branches = default_branch.iter().cloned().collect();
            info.summary = format!(
                "GitHub Actions workflow {} deploys on every push",
                wf.file
            );
        } else {
            info.summary = format!(
                "GitHub Actions workflow {} deploys on push to {}",
                wf.file,
                branches.join(", ")
            );
        }
        info.detected = true;
        info.provider = Some("githubActions".into());
        info.on_push = true;
        info.branches = branches;
        info.evidence.push(format!(".github/workflows/{}", wf.file));
        return info;
    }
    if let Some(wf) = workflows.iter().find(|w| w.deploys) {
        info.detected = true;
        info.provider = Some("githubActions".into());
        info.on_push = false;
        info.summary = format!(
            "GitHub Actions workflow {} deploys, but it is started by hand or on a schedule - not by a push",
            wf.file
        );
        info.evidence.push(format!(".github/workflows/{}", wf.file));
        return info;
    }

    // 2. Hosting providers with git integration: pushing the production
    //    branch (the default branch unless configured otherwise) deploys.
    let git_integrated: &[(&str, &str, &[&str])] = &[
        ("vercel", "Vercel", &["vercel.json", ".vercel/project.json"]),
        ("netlify", "Netlify", &["netlify.toml"]),
        ("render", "Render", &["render.yaml"]),
        ("amplify", "AWS Amplify", &["amplify.yml"]),
        ("cloudflare", "Cloudflare", &["wrangler.toml", "wrangler.json", "wrangler.jsonc"]),
    ];
    for (id, label, files) in git_integrated {
        if let Some(found) = files.iter().find(|f| dir.join(f).is_file()) {
            info.detected = true;
            info.provider = Some((*id).to_string());
            info.on_push = true;
            info.branches = default_branch.iter().cloned().collect();
            info.evidence.push((*found).to_string());
            info.summary = match &default_branch {
                Some(b) => format!(
                    "{label} is connected to this repository - pushing {b} usually deploys to production"
                ),
                None => format!("{label} is connected to this repository - pushing the production branch deploys"),
            };
            return info;
        }
    }

    // 3. Tools that deploy from a command, not from a push.
    let manual: &[(&str, &str, &[&str])] = &[
        ("fly", "Fly.io (deployed with `fly deploy`)", &["fly.toml"]),
        ("heroku", "Heroku (deployed by pushing to the heroku remote or from its dashboard)", &["Procfile", "app.json"]),
        ("firebase", "Firebase Hosting (deployed with `firebase deploy`)", &["firebase.json"]),
        ("docker", "A container image (Dockerfile) - where it runs is not described here", &["Dockerfile", "docker-compose.yml", "compose.yaml"]),
    ];
    for (id, label, files) in manual {
        if let Some(found) = files.iter().find(|f| dir.join(f).is_file()) {
            info.detected = true;
            info.provider = Some((*id).to_string());
            info.on_push = false;
            info.evidence.push((*found).to_string());
            info.summary = (*label).to_string();
            return info;
        }
    }

    if info.readme_mentions_deploy {
        info.detected = true;
        info.summary = "The README describes how this project is deployed".into();
    } else {
        info.summary = "No deployment setup found in this project".into();
    }
    info
}

fn default_branch(dir: &Path) -> Option<String> {
    if let Ok(out) = crate::git::runner::git(dir, &["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]) {
        if out.success {
            let name = out.stdout.trim();
            if let Some(b) = name.strip_prefix("origin/") {
                return Some(b.to_string());
            }
        }
    }
    for candidate in ["main", "master"] {
        if let Ok(out) = crate::git::runner::git(dir, &["rev-parse", "--verify", "-q", &format!("refs/heads/{candidate}")]) {
            if out.success {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

fn readme_mentions_deploy(dir: &Path) -> bool {
    let Some(path) = super::docs::find_doc(dir, super::docs::DocKind::Readme, None) else {
        return false;
    };
    let Ok((markdown, _)) = super::docs::read_doc(&path) else { return false };
    markdown.lines().any(|l| {
        let t = l.trim_start();
        t.starts_with('#') && {
            let lower = t.to_lowercase();
            lower.contains("deploy") || lower.contains("production") || lower.contains("release")
        }
    })
}

fn read_workflows(dir: &Path) -> Vec<Workflow> {
    let wf_dir = dir.join(".github").join("workflows");
    let Ok(entries) = std::fs::read_dir(&wf_dir) else { return Vec::new() };
    let mut out = Vec::new();
    let mut files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            (name.ends_with(".yml") || name.ends_with(".yaml")) && e.path().is_file()
        })
        .collect();
    files.sort_by_key(|e| e.file_name());
    for entry in files.into_iter().take(50) {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() > 256 * 1024 {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
        let file = entry.file_name().to_string_lossy().into_owned();
        out.push(parse_workflow(&file, &text));
    }
    // Prefer the workflow whose name says what it is.
    out.sort_by_key(|w| {
        let lower = w.file.to_lowercase();
        !NAME_HINTS.iter().any(|h| lower.contains(h))
    });
    out
}

fn parse_workflow(file: &str, text: &str) -> Workflow {
    let lower_file = file.to_lowercase();
    let name_line = text
        .lines()
        .find(|l| l.trim_start().starts_with("name:"))
        .map(|l| l.to_lowercase())
        .unwrap_or_default();
    let deploys = DEPLOY_MARKERS.iter().any(|m| text.contains(m))
        || NAME_HINTS.iter().any(|h| lower_file.contains(h) || name_line.contains(h));
    Workflow { file: file.to_string(), push_branches: push_branches(text), deploys }
}

fn indent_of(line: &str) -> usize {
    line.chars().take_while(|c| *c == ' ').count()
}

/// Extract the branches under `on: push: branches:`. Deliberately small
/// YAML heuristics (the shape GitHub documents), not a YAML parser:
/// `on: push`, `on: [push, ...]`, and the block form with `branches:` as an
/// inline list or `- item` lines. Returns None when push is not a trigger.
fn push_branches(text: &str) -> Option<Vec<String>> {
    let lines: Vec<&str> = text.lines().collect();
    let on_idx = lines.iter().position(|l| {
        let t = l.trim_end();
        t == "on:" || t.starts_with("on: ") || t.starts_with("\"on\":") || t.starts_with("'on':")
    })?;
    let on_line = lines[on_idx];
    let after = on_line.split_once(':').map(|(_, r)| r.trim()).unwrap_or("");
    if !after.is_empty() {
        // Inline: `on: push` or `on: [push, pull_request]`
        let items = after.trim_matches(|c| c == '[' || c == ']');
        return items
            .split(',')
            .map(|s| s.trim().trim_matches('"').trim_matches('\''))
            .any(|s| s == "push")
            .then(Vec::new);
    }
    // Block form: children of `on:` are indented deeper than it.
    let on_indent = indent_of(on_line);
    let mut i = on_idx + 1;
    let mut push_idx = None;
    while i < lines.len() {
        let l = lines[i];
        if l.trim().is_empty() || l.trim_start().starts_with('#') {
            i += 1;
            continue;
        }
        if indent_of(l) <= on_indent {
            break;
        }
        let t = l.trim();
        if t == "push:" || t == "push" || t == "- push" {
            push_idx = Some(i);
            break;
        }
        i += 1;
    }
    let push_idx = push_idx?;
    let push_line = lines[push_idx];
    if push_line.trim().starts_with('-') || push_line.trim() == "push" {
        return Some(Vec::new()); // list form / bare key: all branches
    }
    let push_indent = indent_of(push_line);
    let mut branches = Vec::new();
    let mut i = push_idx + 1;
    while i < lines.len() {
        let l = lines[i];
        if l.trim().is_empty() || l.trim_start().starts_with('#') {
            i += 1;
            continue;
        }
        if indent_of(l) <= push_indent {
            break;
        }
        let t = l.trim();
        if let Some(rest) = t.strip_prefix("branches:") {
            let rest = rest.trim();
            if !rest.is_empty() {
                for b in rest.trim_matches(|c| c == '[' || c == ']').split(',') {
                    let b = b.trim().trim_matches('"').trim_matches('\'');
                    if !b.is_empty() {
                        branches.push(b.to_string());
                    }
                }
            } else {
                let b_indent = indent_of(l);
                let mut j = i + 1;
                while j < lines.len() {
                    let bl = lines[j];
                    if bl.trim().is_empty() {
                        j += 1;
                        continue;
                    }
                    if indent_of(bl) <= b_indent {
                        break;
                    }
                    if let Some(item) = bl.trim().strip_prefix('-') {
                        let item = item.trim().trim_matches('"').trim_matches('\'');
                        if !item.is_empty() {
                            branches.push(item.to_string());
                        }
                    }
                    j += 1;
                }
            }
            break;
        }
        i += 1;
    }
    Some(branches)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_block_push_branches() {
        let wf = "name: Deploy\non:\n  push:\n    branches:\n      - main\n      - 'release/*'\n  workflow_dispatch:\njobs:\n  deploy:\n    steps:\n      - uses: actions/deploy-pages@v4\n";
        let parsed = parse_workflow("deploy.yml", wf);
        assert!(parsed.deploys);
        assert_eq!(parsed.push_branches, Some(vec!["main".to_string(), "release/*".to_string()]));
    }

    #[test]
    fn parses_inline_forms() {
        assert_eq!(push_branches("on: [push, pull_request]\n"), Some(vec![]));
        assert_eq!(push_branches("on: push\n"), Some(vec![]));
        assert_eq!(push_branches("on:\n  push:\n    branches: [main, master]\n"), Some(vec!["main".into(), "master".into()]));
        assert_eq!(push_branches("on:\n  pull_request:\n    branches: [main]\n"), None);
        assert_eq!(push_branches("on:\n  workflow_dispatch:\n"), None);
    }

    #[test]
    fn ci_only_workflow_is_not_a_deploy() {
        let wf = "name: CI\non:\n  push:\n    branches: [main]\njobs:\n  test:\n    steps:\n      - run: npm test\n";
        assert!(!parse_workflow("ci.yml", wf).deploys);
    }
}
