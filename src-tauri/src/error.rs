use serde::Serialize;

/// Every command returns `Result<T, AppError>`. The enum serializes as a
/// discriminated union (`{ "kind": "...", ... }`) that the frontend mirrors
/// in `src/api/errors.ts` — adding a variant here requires a matching edit there.
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AppError {
    #[error("project not found: {id}")]
    ProjectNotFound { id: String },
    #[error("path missing: {path}")]
    PathMissing { path: String },
    #[error("not a directory: {path}")]
    NotADirectory { path: String },
    #[error("project already imported: {name}")]
    DuplicateProject { id: String, name: String },
    // Part of the frontend error contract even while unconstructed in Rust.
    #[allow(dead_code)]
    #[error("invalid config file: {file}")]
    ConfigInvalid {
        file: String,
        backup_path: Option<String>,
        detail: String,
    },
    #[error("cannot write config: {file}")]
    ConfigWrite { file: String, detail: String },
    #[error("config version {found} unsupported (this build supports {supported})")]
    ConfigVersionUnsupported { file: String, found: u32, supported: u32 },
    #[error("git is not available")]
    GitUnavailable,
    #[error("git failed: {detail}")]
    GitFailed { detail: String },
    #[error("branch not found: {branch}")]
    BranchNotFound { branch: String },
    #[error("program not found: {program}")]
    ProgramNotFound { program: String },
    #[error("failed to launch {program}: {detail}")]
    LaunchFailed { program: String, detail: String },
    // Constructed only in non-macOS builds (launcher/terminal.rs).
    #[allow(dead_code)]
    #[error("unsupported on this platform: {detail}")]
    UnsupportedPlatform { detail: String },
    #[error("invalid input: {detail}")]
    InvalidInput { detail: String },
    #[error("io error: {detail}")]
    Io { detail: String },
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io { detail: e.to_string() }
    }
}
