use std::path::PathBuf;
use std::sync::Mutex;

use crate::config::{self, FileState};
use crate::error::AppError;
use crate::settings::Settings;

/// All mutable application state. Config is loaded lazily on first access
/// so startup does no eager filesystem work.
pub struct AppState {
    pub config_dir: PathBuf,
    settings: Mutex<Option<(Settings, FileState)>>,
}

impl AppState {
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            config_dir,
            settings: Mutex::new(None),
        }
    }

    fn settings_path(&self) -> PathBuf {
        self.config_dir.join("settings.json")
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
}
