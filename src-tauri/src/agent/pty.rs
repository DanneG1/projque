//! portable-pty wrapper. The agent binary runs DIRECTLY on the PTY - never a
//! shell - with cwd pinned to the resolved project directory and a PATH
//! augmented the same way as external launches (GUI apps inherit a minimal
//! environment).

use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::Path;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

use crate::error::AppError;

pub struct PtyHandles {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub killer: Box<dyn ChildKiller + Send + Sync>,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub fn spawn(
    program: &Path,
    args: &[String],
    cwd: &Path,
    path_env: &OsStr,
    rows: u16,
    cols: u16,
) -> Result<PtyHandles, AppError> {
    let launch_err = |detail: String| AppError::LaunchFailed {
        program: program.display().to_string(),
        detail,
    };

    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| launch_err(e.to_string()))?;

    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("PATH", path_env);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| launch_err(e.to_string()))?;
    // CRITICAL on macOS: the pair holds an open slave fd; without dropping it
    // the reader never receives EOF when the child exits.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| launch_err(e.to_string()))?;
    // take_writer succeeds exactly once - stored in the session.
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| launch_err(e.to_string()))?;
    let killer = child.clone_killer();

    Ok(PtyHandles { master: pair.master, writer, killer, reader, child })
}
