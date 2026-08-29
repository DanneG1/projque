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
- The one place a shell script is *generated* (not fed user input from the frontend): the macOS `.command` file used to run an agent in Terminal.app/iTerm2, because those apps have no "run command" flag. It is written with mode 0700 into the app's own cache directory, contains only Rust-canonicalized, single-quote-escaped values from the catalog, and is pruned after an hour. The alternative (AppleScript) needs the Automation permission and double escaping — strictly worse.

### 3. No network

- No HTTP client exists in `Cargo.toml` or `package.json`; no `fetch` in the frontend.
- CSP (`src-tauri/tauri.conf.json`): `connect-src 'self' ipc: http://ipc.localhost`, `frame-src 'none'`, `object-src 'none'`; the asset protocol is disabled.
- Git runs with `GIT_TERMINAL_PROMPT=0` and only local subcommands (`status`, `log`, `config --get`); it never fetches.
- Verify yourself: run Projque with Little Snitch/`nettop` open, or offline — everything works.

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

Two commands accept more than IDs/enums, on purpose, and are the places to review hardest:

- **`open_external_url(url)`** — free-form string, validated in Rust: ≤ 2048 chars, scheme must be `http`/`https` (allowlist, not denylist), no whitespace/control chars, then handed to the OS browser. It can only ever cause a browser navigation.
- **Hand-edited `command`/`args`/`pathAdditions` in `settings.json`** — honored, exec'd as argv without any shell. Reachable only by editing a local file, never from the UI or webview.

### 7. No telemetry

There is no analytics or telemetry code of any kind.

## Reporting

Open a GitHub issue for non-sensitive reports. For anything sensitive, contact the maintainer privately (see the repository profile). No bounty program; best-effort response.
