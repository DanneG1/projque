//! Filesystem watcher that keeps git information live: when a project's
//! files or its `.git` change (an agent commits, the user saves in an
//! editor, a branch is switched), the frontend is told to re-read that
//! project's git status instead of waiting for the window to regain focus.
//!
//! Read-only and local: nothing is executed on an event; the frontend
//! responds with the same `git_info_many` call it already makes. Paths
//! never cross IPC - events carry the opaque project id only.
//!
//! macOS: FSEvents makes a recursive watch of a whole project tree cheap,
//! so working-tree edits are seen too. Elsewhere only `.git` is watched
//! (inotify handles per directory would not survive a node_modules).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use tauri::{AppHandle, Emitter};

/// Quiet time after the last event before a project is announced - a git
/// operation or an agent edit touches many files in a burst.
const DEBOUNCE: Duration = Duration::from_millis(900);
/// Directories whose churn is never interesting (build output, deps).
const IGNORED_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", ".next", ".nuxt", ".svelte-kit", ".turbo",
    ".cache", "__pycache__", ".venv", "venv", ".pytest_cache", ".mypy_cache", "coverage",
    ".parcel-cache", ".angular", "out", "bin", "obj", ".gradle", ".idea", ".vscode", ".DS_Store",
];
/// Inside `.git`, only these matter (the index is rewritten by `git
/// status` itself, so it is deliberately not on the list).
const GIT_FILES: &[&str] = &["HEAD", "ORIG_HEAD", "MERGE_HEAD", "FETCH_HEAD", "refs", "packed-refs", "logs"];

pub struct ProjectWatcher {
    inner: Mutex<Option<Inner>>,
}

struct Inner {
    watcher: RecommendedWatcher,
    /// project id -> root path currently watched
    watched: HashMap<String, PathBuf>,
    /// Shared with the event thread so it can map a path to a project id.
    roots: Arc<Mutex<Vec<(String, PathBuf)>>>,
}

impl Default for ProjectWatcher {
    fn default() -> Self {
        Self { inner: Mutex::new(None) }
    }
}

impl ProjectWatcher {
    /// Make the watched set equal to `projects` (id, root dir). Missing
    /// directories are skipped; removed projects are unwatched. Safe to
    /// call often - unchanged entries are left alone.
    pub fn sync(&self, app: AppHandle, projects: Vec<(String, PathBuf)>) {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_none() {
            match start(app) {
                Some(inner) => *guard = Some(inner),
                None => return,
            }
        }
        let inner = guard.as_mut().unwrap();
        let wanted: HashMap<String, PathBuf> =
            projects.into_iter().filter(|(_, p)| p.is_dir()).collect();

        let stale: Vec<String> = inner
            .watched
            .iter()
            .filter(|(id, path)| wanted.get(*id) != Some(path))
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            if let Some(path) = inner.watched.remove(&id) {
                let _ = inner.watcher.unwatch(&watch_target(&path));
            }
        }
        for (id, path) in wanted {
            if inner.watched.contains_key(&id) {
                continue;
            }
            if inner.watcher.watch(&watch_target(&path), mode()).is_ok() {
                inner.watched.insert(id, path);
            }
        }
        *inner.roots.lock().unwrap() =
            inner.watched.iter().map(|(id, p)| (id.clone(), p.clone())).collect();
    }
}

#[cfg(target_os = "macos")]
fn watch_target(root: &Path) -> PathBuf {
    root.to_path_buf()
}
#[cfg(not(target_os = "macos"))]
fn watch_target(root: &Path) -> PathBuf {
    root.join(".git")
}
#[cfg(target_os = "macos")]
fn mode() -> RecursiveMode {
    RecursiveMode::Recursive
}
#[cfg(not(target_os = "macos"))]
fn mode() -> RecursiveMode {
    RecursiveMode::NonRecursive
}

fn start(app: AppHandle) -> Option<Inner> {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            for path in event.paths {
                let _ = tx.send(path);
            }
        }
    })
    .ok()?;
    let roots: Arc<Mutex<Vec<(String, PathBuf)>>> = Arc::new(Mutex::new(Vec::new()));
    let thread_roots = roots.clone();
    std::thread::spawn(move || debounce_loop(app, rx, thread_roots));
    Some(Inner { watcher, watched: HashMap::new(), roots })
}

/// Collect paths, map them to projects, and announce each project once
/// its burst has been quiet for DEBOUNCE.
fn debounce_loop(app: AppHandle, rx: mpsc::Receiver<PathBuf>, roots: Arc<Mutex<Vec<(String, PathBuf)>>>) {
    let mut pending: HashMap<String, Instant> = HashMap::new();
    loop {
        let wait = if pending.is_empty() { Duration::from_secs(3600) } else { Duration::from_millis(200) };
        match rx.recv_timeout(wait) {
            Ok(path) => {
                if let Some(id) = project_for(&path, &roots.lock().unwrap()) {
                    pending.insert(id, Instant::now());
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        let now = Instant::now();
        let due: Vec<String> = pending
            .iter()
            .filter(|(_, t)| now.duration_since(**t) >= DEBOUNCE)
            .map(|(id, _)| id.clone())
            .collect();
        let due: HashSet<String> = due.into_iter().collect();
        for id in &due {
            pending.remove(id);
            let _ = app.emit("git:changed", serde_json::json!({ "projectId": id }));
        }
    }
}

/// Which project a changed path belongs to, or None when the change is
/// noise (build output, dependency folders, git's own bookkeeping).
fn project_for(path: &Path, roots: &[(String, PathBuf)]) -> Option<String> {
    let (id, root) = roots.iter().find(|(_, root)| path.starts_with(root))?;
    let rel = path.strip_prefix(root).ok()?;
    let mut parts = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
    let first = parts.next()?;
    if first == ".git" {
        // Only ref/HEAD movement counts; the index and object writes are
        // either noise or covered by a ref change that follows.
        let second = parts.next()?;
        return GIT_FILES.contains(&second.as_str()).then(|| id.clone());
    }
    if IGNORED_DIRS.contains(&first.as_str()) {
        return None;
    }
    for part in parts {
        if IGNORED_DIRS.contains(&part.as_str()) {
            return None;
        }
    }
    Some(id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots() -> Vec<(String, PathBuf)> {
        vec![("a".into(), PathBuf::from("/p/a")), ("b".into(), PathBuf::from("/p/b"))]
    }

    #[test]
    fn maps_paths_to_projects_and_filters_noise() {
        let r = roots();
        assert_eq!(project_for(Path::new("/p/a/src/main.ts"), &r).as_deref(), Some("a"));
        assert_eq!(project_for(Path::new("/p/b/README.md"), &r).as_deref(), Some("b"));
        assert_eq!(project_for(Path::new("/p/a/node_modules/x/index.js"), &r), None);
        assert_eq!(project_for(Path::new("/p/a/src/target/x"), &r), None);
        assert_eq!(project_for(Path::new("/p/a/.git/HEAD"), &r).as_deref(), Some("a"));
        assert_eq!(project_for(Path::new("/p/a/.git/refs/heads/main"), &r).as_deref(), Some("a"));
        assert_eq!(project_for(Path::new("/p/a/.git/index"), &r), None);
        assert_eq!(project_for(Path::new("/p/a/.git/objects/ab/cd"), &r), None);
        assert_eq!(project_for(Path::new("/elsewhere/file"), &r), None);
    }
}
