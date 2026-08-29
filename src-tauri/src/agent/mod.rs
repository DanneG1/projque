//! Embedded agent terminal sessions: registry, streaming, lifecycle.
//!
//! Sessions are child processes of the app and die with it (closing the PTY
//! master delivers SIGHUP). The reader thread owns the per-session
//! `OutputState` and never touches the registry lock; attach replays the
//! scrollback and installs the live channel under that same lock, making
//! replay-then-live gap-free and duplicate-free by construction.

mod pty;

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::PtySize;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

use crate::error::AppError;

const SCROLLBACK_CAP: usize = 256 * 1024;
const MAX_SESSIONS: usize = 16;
const READ_BUF: usize = 8192;

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SessionStatus {
    Running,
    Exited { code: Option<i32> },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionView {
    pub session_id: String,
    pub project_id: String,
    pub agent_kind: String,
    pub agent_label: String,
    pub started_at: i64,
    pub status: SessionStatus,
}

struct OutputState {
    scrollback: VecDeque<u8>,
    channel: Option<Channel<InvokeResponseBody>>,
}

struct Session {
    view: AgentSessionView,
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    output: Arc<Mutex<OutputState>>,
}

#[derive(Default)]
pub struct Registry {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    counter: AtomicU64,
    pub quit_confirmed: AtomicBool,
}

pub struct StartSpec<'a> {
    pub project_id: &'a str,
    pub agent_kind: &'a str,
    pub agent_label: &'a str,
    pub program: &'a Path,
    pub args: &'a [String],
    pub cwd: &'a Path,
    pub path_env: &'a std::ffi::OsStr,
    pub rows: u16,
    pub cols: u16,
}

impl Registry {
    pub fn start(&self, app: AppHandle, spec: StartSpec) -> Result<AgentSessionView, AppError> {
        {
            let sessions = self.sessions.lock().unwrap();
            let running = sessions
                .values()
                .filter(|s| matches!(s.view.status, SessionStatus::Running))
                .count();
            if running >= MAX_SESSIONS {
                return Err(AppError::InvalidInput {
                    detail: format!("session limit reached ({MAX_SESSIONS} running agents)"),
                });
            }
        }
        let handles = pty::spawn(
            spec.program,
            spec.args,
            spec.cwd,
            spec.path_env,
            spec.rows.clamp(1, 500),
            spec.cols.clamp(1, 500),
        )?;

        let session_id = format!("s{}", self.counter.fetch_add(1, Ordering::SeqCst) + 1);
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let view = AgentSessionView {
            session_id: session_id.clone(),
            project_id: spec.project_id.to_string(),
            agent_kind: spec.agent_kind.to_string(),
            agent_label: spec.agent_label.to_string(),
            started_at,
            status: SessionStatus::Running,
        };
        let output = Arc::new(Mutex::new(OutputState {
            scrollback: VecDeque::with_capacity(READ_BUF),
            channel: None,
        }));

        // Reader thread: PTY -> scrollback + live channel. Never locks the
        // registry; keeps draining even when the webview is detached so the
        // child can never block on a full pipe. On macOS, child exit
        // surfaces as Ok(0) or Err(EIO) — both are EOF, not failures.
        {
            let output = output.clone();
            let mut reader = handles.reader;
            std::thread::spawn(move || {
                let mut buf = [0u8; READ_BUF];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let mut out = output.lock().unwrap();
                            out.scrollback.extend(&buf[..n]);
                            while out.scrollback.len() > SCROLLBACK_CAP {
                                out.scrollback.pop_front();
                            }
                            if let Some(channel) = &out.channel {
                                if channel
                                    .send(InvokeResponseBody::Raw(buf[..n].to_vec()))
                                    .is_err()
                                {
                                    // Webview reloaded/navigated: detach and
                                    // keep buffering for the next attach.
                                    out.channel = None;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Wait thread: reaps the child (no zombies), flips status, notifies.
        {
            let sessions = self.sessions.clone();
            let id = session_id.clone();
            let mut child = handles.child;
            std::thread::spawn(move || {
                let code = child.wait().ok().map(|status| status.exit_code() as i32);
                let exited_view = {
                    let mut map = sessions.lock().unwrap();
                    map.get_mut(&id).map(|session| {
                        session.view.status = SessionStatus::Exited { code };
                        session.view.clone()
                    })
                };
                if let Some(view) = exited_view {
                    let _ = app.emit("agent:session-exited", &view);
                }
            });
        }

        self.sessions.lock().unwrap().insert(
            session_id,
            Session {
                view: view.clone(),
                master: handles.master,
                writer: handles.writer,
                killer: handles.killer,
                output,
            },
        );
        Ok(view)
    }

    pub fn list(&self) -> Vec<AgentSessionView> {
        let mut views: Vec<AgentSessionView> = self
            .sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| s.view.clone())
            .collect();
        views.sort_by_key(|v| v.started_at);
        views
    }

    /// Replay the scrollback, then install the live channel — both under the
    /// OutputState lock, so no bytes are lost or duplicated in between.
    pub fn attach(
        &self,
        session_id: &str,
        channel: Channel<InvokeResponseBody>,
    ) -> Result<(), AppError> {
        let output = {
            let sessions = self.sessions.lock().unwrap();
            let session = sessions
                .get(session_id)
                .ok_or_else(|| AppError::SessionNotFound { id: session_id.to_string() })?;
            session.output.clone()
        };
        let mut out = output.lock().unwrap();
        if !out.scrollback.is_empty() {
            let replay: Vec<u8> = out.scrollback.iter().copied().collect();
            let _ = channel.send(InvokeResponseBody::Raw(replay));
        }
        out.channel = Some(channel);
        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::SessionNotFound { id: session_id.to_string() })?;
        if !matches!(session.view.status, SessionStatus::Running) {
            return Err(AppError::SessionExited { id: session_id.to_string() });
        }
        session
            .writer
            .write_all(data.as_bytes())
            .and_then(|_| session.writer.flush())
            .map_err(|e| AppError::Io { detail: e.to_string() })
    }

    pub fn resize(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), AppError> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::SessionNotFound { id: session_id.to_string() })?;
        session
            .master
            .resize(PtySize {
                rows: rows.clamp(1, 500),
                cols: cols.clamp(1, 500),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Io { detail: e.to_string() })
    }

    /// Idempotent: killing an already-exited session is a no-op.
    pub fn kill(&self, session_id: &str) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::SessionNotFound { id: session_id.to_string() })?;
        if matches!(session.view.status, SessionStatus::Running) {
            let _ = session.killer.kill();
        }
        Ok(())
    }

    pub fn remove(&self, session_id: &str) -> Result<(), AppError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::SessionNotFound { id: session_id.to_string() })?;
        if matches!(session.view.status, SessionStatus::Running) {
            return Err(AppError::InvalidInput {
                detail: "stop the agent before removing its session".into(),
            });
        }
        sessions.remove(session_id);
        Ok(())
    }

    pub fn running_count(&self) -> usize {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .filter(|s| matches!(s.view.status, SessionStatus::Running))
            .count()
    }

    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for session in sessions.values_mut() {
            if matches!(session.view.status, SessionStatus::Running) {
                let _ = session.killer.kill();
            }
        }
    }
}
