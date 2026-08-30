# Architecture

Projque is a Tauri 2 app: a React/TypeScript webview talking over IPC to a Rust backend that owns all filesystem, git, and process work.

```
┌─────────────────────────────────────┐
│              React UI               │   src/
│  list · detail · import · settings  │   zustand store, api/ipc.ts
└──────────────────┬──────────────────┘
                   │  Tauri IPC - typed commands only
┌──────────────────▼──────────────────┐
│            Rust backend             │   src-tauri/src/
│  commands.rs (the whole surface)    │
│  config/ settings/ project/         │
│  discovery/ git/ launcher/          │
└────────┬───────────┬───────────┬────┘
         ▼           ▼           ▼
    filesystem     git CLI    OS launchers · PTY sessions
```

## The trust boundary

The webview is treated as untrusted; the Rust process is trusted. The IPC surface - every `#[tauri::command]` in `src-tauri/src/commands.rs` - is the boundary and therefore the complete attack surface. Rules:

1. **The frontend never sends a filesystem path or a shell string.** Commands accept opaque project/candidate IDs and closed enum values.
2. **Every path originates in Rust.** Folder pickers run backend-side (`tauri-plugin-dialog`, Rust API only); the chosen path never round-trips through JS.
3. **One resolution point.** `AppState::resolve_dir(id)` (src-tauri/src/state.rs) maps ID → canonicalized, existing directory, and every path-touching command goes through it.

Tauri capabilities (`src-tauri/capabilities/default.json`) grant the webview no plugin IPC at all - only core window/event basics. The dialog and opener plugins are used from Rust and are not reachable from the webview.

## Modules

| Module | Responsibility |
|---|---|
| `commands.rs` | The entire IPC surface. Validation + delegation only; no business logic. |
| `config/` | Generic JSON store: load-or-recover with backup-on-invalid, version locking, atomic tmp+rename writes. |
| `settings/` | `settings.json` model. Serde defaults everywhere so hand-edited files load. |
| `project/` | `projects.json` model (kept spec-exact), runtime `ProjectView`, slug IDs, README/ROADMAP discovery (`docs.rs`). |
| `discovery/` | walkdir scanner: configured roots only, depth-capped, no symlink following, prunes hidden/dependency dirs, opaque candidate IDs. |
| `git/` | `runner.rs` - the single git spawn point (argv-only, hardened env; 5s watchdog for local ops, 120s + SSH BatchMode for the explicit network ops); `parse.rs` - porcelain/log parsing; `remote.rs` - GitHub URL normalization; `ops.rs` - the safe control verbs (fetch, ff-only pull, branch list, validated switch). |
| `launcher/` | `catalog.rs` - the static tool allowlist; `which.rs` - PATH resolution (augmented for GUI-launched apps); `terminal.rs` - terminal strategies; process spawning. |
| `run/` | Run-target detection from the project's own manifests (package.json scripts + lockfile-derived package manager, Cargo.toml, go.mod, csproj/sln) and argv construction; launch revalidates the target against a fresh enumeration. |
| `github/` | GitHub CLI layer: status probe, `repo create` for new projects, PR/CI check; fixed argv, network on explicit click only, degrades to hidden UI when gh is missing/unauthenticated. |
| `agent/` | Embedded agent AND run sessions: `pty.rs` (portable-pty spawn - the agent runs directly on the PTY, never a shell), registry with per-session reader/wait threads, 256 KB scrollback ring, streaming to the webview via `tauri::ipc::Channel` raw bytes (scrollback replayed on attach, so webview reloads lose nothing); attention tracking (bell or output-then-quiet while unwatched → badge + OS notification via tauri-plugin-notification, Rust-side). |

## Key decisions

- **Git via the `git` CLI, not libgit2/gix.** Zero build friction for contributors, output identical to what the user sees in their own terminal, and "git not installed" degrades trivially. The cost (a few 5–20 ms spawns per repo) is hidden by bounded parallel fetching and a 30 s cache. `git/mod.rs` exposes only `fetch_info(dir)`, so the backend is swappable.
- **Two JSON files, no database.** Human-readable, easy to back up, non-critical if lost (rescan recovers the list). Invalid files are renamed to `*.invalid-<ts>.bak` - never overwritten. A `configVersion` newer than the build supports puts writes into read-only mode instead of downgrading.
- **Terminal strategies.** Argv terminals (kitty, wt, Alacritty, …) take cwd and command as plain arguments. Terminal.app/iTerm2 have no such flags: plain "Open Terminal" is `open -a Terminal <dir>`; "Open Agent" writes a one-shot `.command` script (mode 0700, app cache dir, pruned after an hour) and opens it. This avoids AppleScript automation permissions and double escaping.
- **Types are mirrored by hand.** Rust models in `src-tauri/src/*/model.rs` ↔ TS in `src/models/`. Changing one requires the matching edit - the exhaustive `switch` in `src/api/errors.ts` turns a missed error variant into a compile error.
- **Async discipline.** Every command is `async`; all blocking work (fs, git, spawns) goes through `spawn_blocking`. Git info fetches fan out in chunks of 8.

## Adding a new quick action

1. Add a variant to `LaunchAction` in `commands.rs` and handle it in `project_launch` - resolve through `resolve_dir`, never accept extra strings from the frontend.
2. Implement the behavior in `launcher/`.
3. Add the variant to `LaunchAction` in `src/models/launcher.ts` and a button in `src/components/QuickActions.tsx`.
4. Update SECURITY.md if the action's inputs differ in kind from the existing ones.

## Adding a new editor/terminal/agent

One const line in `src-tauri/src/launcher/catalog.rs` (plus, for terminals with new argument shapes, a match arm in `launcher/terminal.rs`).
