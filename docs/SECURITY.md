# Security

Projque interacts with local files and launches external applications, so its security model is deliberately small enough to explain on one page.

## Threat model

Untrusted inputs:

1. **README/ROADMAP content** — markdown from cloned repositories may be hostile.
2. **File and directory names on disk** — may contain shell metacharacters, quotes, unicode tricks.
3. **A compromised webview/renderer** — if the UI process is somehow subverted, it must not be able to read arbitrary files or run arbitrary programs through the backend.

Out of scope: a malicious local user (they already have your shell), and a maliciously edited `settings.json` — editing it is the same trust level as editing your own `~/.zshrc`. The point of the design is that the *renderer* can never reach what settings.json can.

## Invariants

### 1. No paths or shell strings cross the IPC boundary

Every command takes opaque IDs (`project_launch(id, action)`) or closed enums. Folder pickers run in Rust; scan results are returned with opaque candidate IDs and imported by ID. `AppState::resolve_dir` is the single ID→path resolver (canonicalize + directory check).

### 2. No shell, no arbitrary command execution

- `tauri-plugin-shell` and `tauri-plugin-fs` are not present.
- All processes are spawned with `std::process::Command` and argv arrays — no shell interpretation anywhere, so file names with `;`, `$()`, quotes etc. are inert.
- Launchable programs come from the static allowlist in `launcher/catalog.rs`. The frontend can only select a `kind` from it.
- Embedded agent sessions run the allowlisted agent binary **directly on a PTY — never through a shell**; cwd is the resolved project directory, and the environment is the app's own plus an augmented PATH. Session IDs are opaque backend-generated tokens. Run sessions (dev servers etc.) use the same PTY-not-shell spawn.
- The one place a shell script is *generated* (not fed user input from the frontend): the macOS `.command` file used to run an agent in Terminal.app/iTerm2, because those apps have no "run command" flag. It is written with mode 0700 into the app's own cache directory, contains only Rust-canonicalized, single-quote-escaped values from the catalog, and is pruned after an hour. The alternative (AppleScript) needs the Automation permission and double escaping — strictly worse.

### 3. No automatic network

- No HTTP client exists in `Cargo.toml` or `package.json`; no `fetch` in the frontend.
- CSP (`src-tauri/tauri.conf.json`): `connect-src 'self' ipc: http://ipc.localhost`, `frame-src 'none'`, `object-src 'none'`; the asset protocol is disabled.
- The **only** ways bytes leave your machine, all on explicit clicks, never automatically: `git fetch --prune` / `git pull --ff-only` / `git clone` against remotes you chose, and the GitHub CLI (`gh repo create` when you create a project with a repository, `gh pr view` when you click "Check PR & CI"). `gh` is your own installed, authenticated binary, invoked with fixed argv exactly like git. These run with `GIT_TERMINAL_PROMPT=0` and SSH `BatchMode`, so they require non-interactive credentials (ssh-agent or a credential helper) and can never prompt.
- All other git usage is read-only local subcommands (`status`, `log`, `config --get`, `for-each-ref`) plus `switch`; none touch the network.
- Verify yourself: run Projque with Little Snitch/`nettop` open, or offline — everything except the Fetch/Pull buttons works, and those fail cleanly.

### 4. Filesystem scope

- Scanning touches only user-configured roots, depth-capped, and **never follows symlinks** (`walkdir` with `follow_links(false)`).
- Document reads are confined to imported project directories; a configured roadmap path is canonicalized and must still resolve inside the (canonical) project dir, which also defeats symlink escapes. Reads are capped at 512 KB.
- Config writes are atomic (tmp + rename); an unparseable config is renamed to a `.bak`, never deleted or overwritten.

### 5. Markdown is rendered inert

`src/components/MarkdownView.tsx` is the only renderer:

- react-markdown builds a React element tree; raw HTML is dropped (no `rehype-raw`, no `dangerouslySetInnerHTML` anywhere in the codebase).
- `rehype-sanitize` runs as defence in depth.
- `urlTransform` allowlists `http/https/mailto`, killing `javascript:`, `data:`, `file:`.
- Images are never loaded (asset protocol disabled) — alt text renders instead.
- Links open only via the audited `open_external_url` command.

### 6. The audited exceptions

A small number of commands accept more than IDs/enums, on purpose, and are the places to review hardest:

- **`open_external_url(url)`** — free-form string, validated in Rust: ≤ 2048 chars, scheme must be `http`/`https` (allowlist, not denylist), no whitespace/control chars, then handed to the OS browser. It can only ever cause a browser navigation.
- **`git_switch(id, branch)`** — the branch name is a frontend-supplied string, validated by exact byte match against a fresh enumeration of the repository's own `refs/heads`, re-run backend-side at call time — the value provably names an existing local ref, so option/command injection is impossible (leading `-` and control characters are rejected as defence in depth). `git switch` itself refuses to clobber uncommitted changes; the app never passes `-f`, `--discard-changes`, or `-m`. The mutating git verbs are limited to `fetch`, `pull --ff-only`, and `switch` — push, merge, rebase, reset, clean, stash, and forced anything are excluded by design.
- **`run_session_start(projectId, targetId)`** — the target is validated by exact match against a fresh enumeration of the project's **own manifest files** (package.json scripts, Cargo.toml, go.mod, csproj), re-derived backend-side at launch time; the runner comes from a static table and the argv is built in Rust. Be clear about what this means: running a target executes that project's own code — a user-initiated decision with exactly the trust of running `npm run dev` in your own terminal (and the same trust as launching a coding agent there). The "Open in browser" button opens only a URL the run itself printed, stored backend-side, restricted to localhost hosts — no URL crosses IPC.
- **`agent_session_write(sessionId, data)`** — free-form bytes, but they can only reach the stdin of a PTY the user themselves started, running an allowlisted agent in their own project directory — exactly the trust level of typing into Terminal.app. Input is capped at 64 KB per call.
- **`project_create(name, description, …)`** — `name` is restricted to `[A-Za-z0-9._-]` starting alphanumeric (max 100; it is also the directory name); `description` becomes file content (README) only, never an argument. **`project_clone(url, …)`** — the URL is shape-validated (https/http/ssh/git@ prefix — which also excludes a leading dash — no whitespace or control characters, ≤300 chars) and passed to `git clone` as a single argv element after `--`, so it can never be parsed as an option. **`agent_session_start`'s `initial_prompt`** — content handed to the user's own agent as one positional argv element (≤4 KB), the same trust level as typing into the session.
- **Hand-edited `command`/`args`/`pathAdditions` in `settings.json`** — honored, exec'd as argv without any shell. Reachable only by editing a local file, never from the UI or webview.

### 7. Child processes

Embedded agent sessions are child processes of Projque: closing the app closes the PTY, which delivers SIGHUP and ends them (the app warns before quitting while sessions run). Residual risk: a child that ignores SIGHUP could outlive an app *crash*; there is no daemon or pidfile reaper in this version.

### 8. No telemetry

There is no analytics or telemetry code of any kind.

## Reporting

Open a GitHub issue for non-sensitive reports. For anything sensitive, contact the maintainer privately (see the repository profile). No bounty program; best-effort response.
