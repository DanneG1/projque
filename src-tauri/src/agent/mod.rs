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
use std::time::{Duration, Instant};
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
/// An agent that produced output and then stayed quiet this long is
/// probably waiting for the user.
const ATTENTION_QUIET: Duration = Duration::from_secs(6);
const TICKER_INTERVAL: Duration = Duration::from_secs(2);
/// Output seen within this window counts as "working" for the live pulse.
const WORKING_WINDOW: Duration = Duration::from_secs(4);

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Agent,
    Run,
}

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
    /// Display name of the project, for notifications and pane headers.
    pub project_label: String,
    pub kind: SessionKind,
    pub agent_kind: String,
    pub agent_label: String,
    pub started_at: i64,
    pub status: SessionStatus,
    pub detected_url: Option<String>,
    pub needs_attention: bool,
    /// Agent sessions: the commit to restore to undo everything this session
    /// did (the pre-session snapshot, or HEAD when the tree was clean).
    pub undo_hash: Option<String>,
    /// Run sessions: the enumerated run target that was started.
    pub target_id: Option<String>,
    /// Run sessions: error-shaped output was seen (an "Explain" offer).
    pub error_detected: bool,
}

/// Liveness of one running session, emitted every ticker interval so the
/// project cards can show a real "working / quiet / waiting" indicator
/// without attaching to the terminal stream.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionPulse {
    pub session_id: String,
    /// Seconds since the last output byte; None = nothing yet.
    pub idle_secs: Option<f32>,
    /// Output is flowing right now.
    pub working: bool,
}

struct OutputState {
    scrollback: VecDeque<u8>,
    channel: Option<Channel<InvokeResponseBody>>,
    /// First localhost URL seen in the output (run sessions only).
    detected_url: Option<String>,
    /// Error-shaped output seen (run sessions only).
    error_detected: bool,
    // Attention tracking (agent sessions only): a bell, or going quiet
    // after producing output since the user's last keystroke, means the
    // agent is probably waiting for the user.
    last_output: Option<Instant>,
    pending_since_input: bool,
    attention: bool,
    announced: bool,
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
    /// (currently visible sessions, app focused) - reported by the frontend
    /// so attention is never raised for what the user is looking at. More
    /// than one session is visible when the split/grid view is active.
    active: Arc<Mutex<(Vec<String>, bool)>>,
    ticker_started: AtomicBool,
}

pub struct StartSpec<'a> {
    pub project_id: &'a str,
    pub project_label: &'a str,
    pub kind: SessionKind,
    pub agent_kind: &'a str,
    pub agent_label: &'a str,
    pub program: &'a Path,
    pub args: &'a [String],
    pub cwd: &'a Path,
    pub path_env: &'a std::ffi::OsStr,
    pub rows: u16,
    pub cols: u16,
    pub undo_hash: Option<String>,
    pub target_id: Option<String>,
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
            project_label: spec.project_label.to_string(),
            kind: spec.kind,
            agent_kind: spec.agent_kind.to_string(),
            agent_label: spec.agent_label.to_string(),
            started_at,
            status: SessionStatus::Running,
            detected_url: None,
            needs_attention: false,
            undo_hash: spec.undo_hash.clone(),
            target_id: spec.target_id.clone(),
            error_detected: false,
        };
        let output = Arc::new(Mutex::new(OutputState {
            scrollback: VecDeque::with_capacity(READ_BUF),
            channel: None,
            detected_url: None,
            error_detected: false,
            last_output: None,
            pending_since_input: false,
            attention: false,
            announced: false,
        }));
        self.ensure_ticker(app.clone());

        // Reader thread: PTY -> scrollback + live channel. Never locks the
        // registry; keeps draining even when the webview is detached so the
        // child can never block on a full pipe. On macOS, child exit
        // surfaces as Ok(0) or Err(EIO) - both are EOF, not failures.
        {
            let output = output.clone();
            let mut reader = handles.reader;
            let detect_urls = spec.kind == SessionKind::Run;
            let track_attention = spec.kind == SessionKind::Agent;
            let url_app = app.clone();
            let url_session_id = session_id.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; READ_BUF];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let mut announce: Option<String> = None;
                            let mut announce_error = false;
                            {
                                let mut out = output.lock().unwrap();
                                out.scrollback.extend(&buf[..n]);
                                while out.scrollback.len() > SCROLLBACK_CAP {
                                    out.scrollback.pop_front();
                                }
                                out.last_output = Some(Instant::now());
                                if track_attention {
                                    out.pending_since_input = true;
                                    // BEL = the agent explicitly asked for attention.
                                    if buf[..n].contains(&0x07) {
                                        out.attention = true;
                                    }
                                }
                                if detect_urls && out.detected_url.is_none() {
                                    if let Some(url) = find_local_url(&buf[..n]) {
                                        out.detected_url = Some(url.clone());
                                        announce = Some(url);
                                    }
                                }
                                // Run sessions only: agent TUIs print "Error"
                                // in their own prose far too often to trust.
                                if detect_urls && !out.error_detected && looks_like_error(&buf[..n]) {
                                    out.error_detected = true;
                                    announce_error = true;
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
                            if let Some(url) = announce {
                                let _ = url_app.emit(
                                    "agent:session-url",
                                    serde_json::json!({ "sessionId": url_session_id, "url": url }),
                                );
                            }
                            if announce_error {
                                let _ = url_app.emit(
                                    "agent:session-error",
                                    serde_json::json!({ "sessionId": url_session_id }),
                                );
                            }
                        }
                    }
                }
            });
        }

        // Wait thread: reaps the child (no zombies), flips status, notifies.
        {
            let sessions = self.sessions.clone();
            let active = self.active.clone();
            let id = session_id.clone();
            let mut child = handles.child;
            std::thread::spawn(move || {
                let code = child.wait().ok().map(|status| status.exit_code() as i32);
                let exited_view = {
                    let mut map = sessions.lock().unwrap();
                    map.get_mut(&id).map(|session| {
                        session.view.status = SessionStatus::Exited { code };
                        // Same merge as list(): the frontend replaces its
                        // record with this view, so it must carry the
                        // output-derived fields (a crash is exactly when
                        // "explain this error" matters).
                        let mut view = session.view.clone();
                        let out = session.output.lock().unwrap();
                        view.detected_url = out.detected_url.clone();
                        view.error_detected = out.error_detected;
                        view
                    })
                };
                if let Some(view) = exited_view {
                    let _ = app.emit("agent:session-exited", &view);
                    // The in-app toast covers a focused window; when the user
                    // is elsewhere, tell them the way the attention path does.
                    let focused = active.lock().unwrap().1;
                    if !focused {
                        if let Some((title, body)) = exit_notification(&view, code) {
                            notify(&app, &title, &body);
                        }
                    }
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
            .map(|s| {
                let mut view = s.view.clone();
                let out = s.output.lock().unwrap();
                view.detected_url = out.detected_url.clone();
                view.needs_attention = out.attention;
                view.error_detected = out.error_detected;
                view
            })
            .collect();
        views.sort_by_key(|v| v.started_at);
        views
    }

    /// The stored detected URL for a session (never supplied by the frontend).
    pub fn detected_url(&self, session_id: &str) -> Result<Option<String>, AppError> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::SessionNotFound { id: session_id.to_string() })?;
        let url = session.output.lock().unwrap().detected_url.clone();
        Ok(url)
    }

    /// Project id and the tail of the scrollback as plain text (ANSI escapes
    /// stripped), for "explain this error". Read backend-side so no terminal
    /// text needs to cross IPC inbound.
    pub fn output_tail(&self, session_id: &str, max_bytes: usize) -> Result<(String, String), AppError> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::SessionNotFound { id: session_id.to_string() })?;
        let out = session.output.lock().unwrap();
        let skip = out.scrollback.len().saturating_sub(max_bytes);
        let bytes: Vec<u8> = out.scrollback.iter().skip(skip).copied().collect();
        Ok((session.view.project_id.clone(), strip_ansi(&String::from_utf8_lossy(&bytes))))
    }

    /// Replay the scrollback, then install the live channel - both under the
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
        {
            // The user is interacting - nothing is waiting on them anymore.
            let mut out = session.output.lock().unwrap();
            out.pending_since_input = false;
            out.attention = false;
            out.announced = false;
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

    /// Frontend reports what the user is looking at (one session, or every
    /// pane of the split view); viewing a session clears its attention state.
    pub fn set_active(&self, session_ids: Vec<String>, app_focused: bool) {
        {
            let sessions = self.sessions.lock().unwrap();
            for id in &session_ids {
                if let Some(session) = sessions.get(id) {
                    let mut out = session.output.lock().unwrap();
                    out.pending_since_input = false;
                    out.attention = false;
                    out.announced = false;
                }
            }
        }
        *self.active.lock().unwrap() = (session_ids, app_focused);
    }

    /// Background ticker (spawned once, on the first session): raises
    /// attention for running agent sessions that rang the bell or went
    /// quiet after output, unless the user is already looking at them.
    fn ensure_ticker(&self, app: AppHandle) {
        if self.ticker_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let sessions = self.sessions.clone();
        let active = self.active.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(TICKER_INTERVAL);
            let (active_ids, focused) = active.lock().unwrap().clone();
            let mut to_announce: Vec<AgentSessionView> = Vec::new();
            let mut pulses: Vec<SessionPulse> = Vec::new();
            {
                let map = sessions.lock().unwrap();
                for session in map.values() {
                    if !matches!(session.view.status, SessionStatus::Running) {
                        continue;
                    }
                    {
                        let out = session.output.lock().unwrap();
                        let idle = out.last_output.map(|t| t.elapsed());
                        pulses.push(SessionPulse {
                            session_id: session.view.session_id.clone(),
                            idle_secs: idle.map(|d| d.as_secs_f32()),
                            working: idle.map(|d| d < WORKING_WINDOW).unwrap_or(false),
                        });
                    }
                    if session.view.kind != SessionKind::Agent {
                        continue;
                    }
                    let viewed = focused
                        && active_ids.iter().any(|a| a == &session.view.session_id);
                    if viewed {
                        continue;
                    }
                    let mut out = session.output.lock().unwrap();
                    let quiet = out.pending_since_input
                        && out
                            .last_output
                            .map(|t| t.elapsed() >= ATTENTION_QUIET)
                            .unwrap_or(false);
                    if (out.attention || quiet) && !out.announced {
                        out.attention = true;
                        out.announced = true;
                        let mut view = session.view.clone();
                        view.needs_attention = true;
                        view.detected_url = out.detected_url.clone();
                        to_announce.push(view);
                    }
                }
            }
            // Only while something runs - an idle app stays silent.
            if !pulses.is_empty() {
                let _ = app.emit("agent:sessions-pulse", &pulses);
            }
            for view in to_announce {
                let _ = app.emit("agent:session-attention", &view);
                notify(
                    &app,
                    &format!("{} - {}", view.agent_label, view.project_label),
                    "Waiting for you",
                );
            }
        });
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

/// System notification, honoring the user's notification settings
/// (off switch and quiet hours).
fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri::Manager;
    use tauri_plugin_notification::NotificationExt;
    let allowed = app
        .try_state::<Arc<crate::state::AppState>>()
        .map(|s| s.settings().0.notifications.allows_at(local_hour()))
        .unwrap_or(true);
    if !allowed {
        return;
    }
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Local hour of day (0-23) without pulling in a date crate: UTC seconds
/// plus the offset `date +%z` would give, read once per call from libc.
fn local_hour() -> u8 {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let offset = local_utc_offset_secs();
    (((secs + offset).rem_euclid(86_400)) / 3600) as u8
}

#[cfg(unix)]
fn local_utc_offset_secs() -> i64 {
    // localtime_r fills tm_gmtoff on macOS/Linux/BSD.
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&now, &mut tm) };
    tm.tm_gmtoff as i64
}

#[cfg(not(unix))]
fn local_utc_offset_secs() -> i64 {
    0
}

/// What to say when a session ends and the window is not focused. Plain
/// dev-server stops are not news; agents finishing and test verdicts are.
fn exit_notification(view: &AgentSessionView, code: Option<i32>) -> Option<(String, String)> {
    let is_test = view.target_id.as_deref().map(|t| t.starts_with("test:")).unwrap_or(false);
    match view.kind {
        SessionKind::Agent => Some((
            format!("{} finished - {}", view.agent_label, view.project_label),
            if code == Some(0) {
                "Done. Review the changes in ProjQue.".to_string()
            } else {
                format!("Stopped{}.", code.map(|c| format!(" with code {c}")).unwrap_or_default())
            },
        )),
        SessionKind::Run if is_test => Some((
            format!(
                "{} - {}",
                if code == Some(0) { "All checks passed" } else { "Some checks failed" },
                view.project_label
            ),
            if code == Some(0) {
                "The project is verified.".to_string()
            } else {
                "Look at the output, or ask the agent to fix it.".to_string()
            },
        )),
        SessionKind::Run => None,
    }
}

/// Scan a raw output chunk for the first local dev-server URL. ASCII scan -
/// ANSI escapes (0x1b) and whitespace terminate the token naturally.
/// High-signal error shapes from dev servers, compilers, and test runners.
/// Precise over exhaustive: a false positive offers an unneeded button, a
/// miss just means the user asks by hand.
const ERROR_MARKERS: &[&str] = &[
    "Traceback (most recent call last)",
    "panicked at",
    "error[E",
    "npm ERR!",
    "npm error",
    "ERR_MODULE_NOT_FOUND",
    "Cannot find module",
    "SyntaxError:",
    "TypeError:",
    "ReferenceError:",
    "Unhandled exception",
    "UnhandledPromiseRejection",
    "EADDRINUSE",
    "ENOENT",
    "Failed to compile",
    "error TS",
    "Build failed",
    "FAILED",
    "Exception in thread",
    "fatal error:",
];

fn looks_like_error(chunk: &[u8]) -> bool {
    let text = String::from_utf8_lossy(chunk);
    ERROR_MARKERS.iter().any(|m| text.contains(m))
}

/// Remove ANSI CSI/OSC escape sequences and carriage returns so a terminal
/// tail reads as plain text.
fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    // CSI: parameters/intermediates then a final byte 0x40-0x7e.
                    for n in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&n) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    // OSC: until BEL or ST (ESC \).
                    let mut prev_esc = false;
                    for n in chars.by_ref() {
                        if n == '\u{07}' || (prev_esc && n == '\\') {
                            break;
                        }
                        prev_esc = n == '\u{1b}';
                    }
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            }
            continue;
        }
        if c == '\r' {
            continue;
        }
        out.push(c);
    }
    out
}

fn find_local_url(chunk: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(chunk);

    // Pass 1: full http(s):// URLs.
    for (idx, _) in text.match_indices("http") {
        let rest = &text[idx..];
        let token: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || ":/.-_?#=&%~+[]".contains(*c))
            .collect();
        let token = token.trim_end_matches(['.', ',', ';', ':']);
        let after_scheme = token
            .strip_prefix("https://")
            .or_else(|| token.strip_prefix("http://"));
        let Some(after_scheme) = after_scheme else { continue };
        let scheme = if token.starts_with("https://") { "https" } else { "http" };
        let host_port = after_scheme.split('/').next().unwrap_or("");
        let (host, port) = match host_port.rsplit_once(':') {
            Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) && !p.is_empty() => (h, Some(p)),
            _ => (host_port, None),
        };
        if !is_local_host(host) {
            continue;
        }
        let path = after_scheme
            .split_once('/')
            .map(|(_, rest)| format!("/{rest}"))
            .unwrap_or_default();
        let port = port.map(|p| format!(":{p}")).unwrap_or_default();
        return Some(format!("{scheme}://localhost{port}{path}"));
    }

    // Pass 2: bare "localhost:PORT" / "127.0.0.1:PORT" / "0.0.0.0:PORT".
    for host in ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"] {
        if let Some(idx) = text.find(&format!("{host}:")) {
            let after = &text[idx + host.len() + 1..];
            let port: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !port.is_empty() {
                return Some(format!("http://localhost:{port}"));
            }
        }
    }

    // Pass 3: "port NNNN" / "on port NNNN" phrasing (dev ports >= 1024 only,
    // to avoid matching noise like SSH's port 22).
    if let Some(idx) = text.to_lowercase().find("port ") {
        let after = &text[idx + 5..];
        let port: String = after
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(n) = port.parse::<u32>() {
            if (1024..=65535).contains(&n) {
                return Some(format!("http://localhost:{n}"));
            }
        }
    }

    None
}

/// Hosts that are reachable via localhost (bind-all addresses included).
fn is_local_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0" | "[::]" | "[::1]")
}

#[cfg(test)]
mod tests {
    use super::find_local_url;

    #[test]
    fn finds_and_normalizes_local_urls() {
        assert_eq!(
            find_local_url(b"  Local:   http://localhost:5173/
"),
            Some("http://localhost:5173/".to_string())
        );
        assert_eq!(
            find_local_url(b"listening on http://127.0.0.1:8080"),
            Some("http://localhost:8080".to_string())
        );
        assert_eq!(
            find_local_url(b"serving at http://0.0.0.0:3000, press ctrl-c"),
            Some("http://localhost:3000".to_string())
        );
        // ANSI-wrapped (vite-style)
        assert_eq!(
            find_local_url(b"[32mhttp://localhost:1420/[0m"),
            Some("http://localhost:1420/".to_string())
        );
    }

    #[test]
    fn detects_bare_and_port_phrasing() {
        // bare localhost:port
        assert_eq!(find_local_url(b"  Local:   localhost:5173\n"), Some("http://localhost:5173".to_string()));
        assert_eq!(find_local_url(b"listening on 0.0.0.0:8080"), Some("http://localhost:8080".to_string()));
        // "port NNNN" phrasing
        assert_eq!(find_local_url(b"Server running on port 3000"), Some("http://localhost:3000".to_string()));
        // low ports (e.g. ssh 22) are not matched as dev servers
        assert_eq!(find_local_url(b"connected to port 22"), None);
    }

    #[test]
    fn ignores_remote_urls() {
        assert_eq!(find_local_url(b"see https://vitejs.dev/config/"), None);
        assert_eq!(find_local_url(b"no urls here"), None);
        assert_eq!(find_local_url(b"http://example.com:8080"), None);
    }
}
