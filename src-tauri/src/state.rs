use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::agent::Registry;
use crate::git::GitInfo;
use crate::github::PrStatus;

use crate::config::{self, FileState};
use crate::error::AppError;
use crate::project::Project;
use crate::settings::Settings;

/// All mutable application state. Config is loaded lazily on first access
/// so startup does no eager filesystem work.
pub struct AppState {
    pub config_dir: PathBuf,
    settings: Mutex<Option<(Settings, FileState)>>,
    projects: Mutex<Option<(Vec<Project>, FileState)>>,
    /// Candidate-id -> path table from the most recent scan. Import commands
    /// resolve against this so paths never cross the IPC boundary.
    pub last_scan: Mutex<HashMap<String, PathBuf>>,
    git_cache: Mutex<HashMap<String, (GitInfo, Instant)>>,
    git_version: Mutex<Option<Option<String>>>,
    pub agents: Registry,
    /// Last fetched PR status per project - github_open_pr opens the stored
    /// URL so nothing crosses IPC.
    pub pr_cache: Mutex<HashMap<String, PrStatus>>,
    /// Live git refresh (see watch.rs).
    pub watcher: crate::watch::ProjectWatcher,
}

const GIT_CACHE_TTL: Duration = Duration::from_secs(30);

impl AppState {
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            config_dir,
            settings: Mutex::new(None),
            projects: Mutex::new(None),
            last_scan: Mutex::new(HashMap::new()),
            git_cache: Mutex::new(HashMap::new()),
            git_version: Mutex::new(None),
            agents: Registry::default(),
            pr_cache: Mutex::new(HashMap::new()),
            watcher: crate::watch::ProjectWatcher::default(),
        }
    }

    fn settings_path(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    fn projects_path(&self) -> PathBuf {
        self.config_dir.join("projects.json")
    }

    /// Load (or lazily initialize) settings. Never fails hard on a bad file:
    /// the invalid file is backed up and defaults are returned.
    pub fn settings(&self) -> (Settings, FileState) {
        let mut guard = self.settings.lock().unwrap();
        guard
            .get_or_insert_with(|| config::load_or_recover::<Settings>(&self.settings_path()))
            .clone()
    }

    /// Apply a mutation and persist atomically. Refuses to write when the file
    /// on disk declares a newer configVersion than this build supports.
    pub fn update_settings(
        &self,
        f: impl FnOnce(&mut Settings),
    ) -> Result<Settings, AppError> {
        let mut guard = self.settings.lock().unwrap();
        let (settings, file_state) = guard
            .get_or_insert_with(|| config::load_or_recover::<Settings>(&self.settings_path()));
        if let FileState::LockedNewerVersion { found } = file_state {
            return Err(AppError::ConfigVersionUnsupported {
                file: "settings.json".into(),
                found: *found,
                supported: config::SUPPORTED_CONFIG_VERSION,
            });
        }
        f(settings);
        config::save_json(&self.settings_path(), settings)?;
        *file_state = FileState::Ok;
        Ok(settings.clone())
    }

    pub fn projects(&self) -> (Vec<Project>, FileState) {
        let mut guard = self.projects.lock().unwrap();
        guard
            .get_or_insert_with(|| config::load_or_recover::<Vec<Project>>(&self.projects_path()))
            .clone()
    }

    /// Apply a mutation to the project list and persist atomically. The
    /// closure may fail (e.g. duplicate detection); nothing is written then.
    pub fn update_projects<R>(
        &self,
        f: impl FnOnce(&mut Vec<Project>) -> Result<R, AppError>,
    ) -> Result<R, AppError> {
        let mut guard = self.projects.lock().unwrap();
        let (projects, file_state) = guard
            .get_or_insert_with(|| config::load_or_recover::<Vec<Project>>(&self.projects_path()));
        let result = f(projects)?;
        config::save_json(&self.projects_path(), projects)?;
        *file_state = FileState::Ok;
        Ok(result)
    }

    /// The single ID -> path resolution point. Every command that touches a
    /// project directory goes through here: unknown IDs and dangling paths
    /// are rejected, and the returned path is canonicalized.
    pub fn resolve_dir(&self, id: &str) -> Result<PathBuf, AppError> {
        let (projects, _) = self.projects();
        let project = projects
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| AppError::ProjectNotFound { id: id.to_string() })?;
        let canon = std::fs::canonicalize(&project.path)
            .map_err(|_| AppError::PathMissing { path: project.path.display().to_string() })?;
        if !canon.is_dir() {
            return Err(AppError::NotADirectory { path: canon.display().to_string() });
        }
        Ok(canon)
    }
}

impl AppState {
    /// Memoized `git --version` probe.
    pub fn git_version(&self) -> Option<String> {
        self.git_version
            .lock()
            .unwrap()
            .get_or_insert_with(crate::git::version)
            .clone()
    }

    pub fn cached_git_info(&self, id: &str) -> Option<GitInfo> {
        let cache = self.git_cache.lock().unwrap();
        cache
            .get(id)
            .filter(|(_, at)| at.elapsed() < GIT_CACHE_TTL)
            .map(|(info, _)| info.clone())
    }

    pub fn store_git_info(&self, info: &GitInfo) {
        self.git_cache
            .lock()
            .unwrap()
            .insert(info.project_id.clone(), (info.clone(), Instant::now()));
    }

    /// Force-refresh git info after a mutating operation, bypassing the TTL
    /// cache, and return the fresh state for the UI.
    pub fn refresh_git_info(&self, id: &str, dir: &std::path::Path) -> GitInfo {
        let info = crate::git::fetch_info(id, dir);
        self.store_git_info(&info);
        info
    }
}
