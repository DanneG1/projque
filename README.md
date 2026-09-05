# ProjQue

> **Your local project shelf.** Keep track of what you're building, see where you left off, and jump back into any project instantly.

ProjQue is a local-first, fully offline desktop app for developers juggling many local projects. It shows every project in one place - status, description, current branch, working-tree state, last commit, roadmap - with quick actions to jump back in, plus safe git controls (fetch, fast-forward pull, branch switching - never anything destructive):

- **Folder** - open the project in your file manager
- **Editor** - open it in your configured editor
- **Terminal** - open a terminal at the project directory
- **Run** - start the application itself (`npm run dev`, `cargo run`, …) in an embedded terminal; targets are auto-detected from the project's own files (package.json scripts with npm/yarn/pnpm/bun picked from the lockfile, Cargo.toml, go.mod, .NET projects), and when the dev server prints its localhost URL an **Open in browser** button appears
- **Preview** - when a run session prints a `localhost` address, one click shows the running app in a pane right next to its terminal, so you can watch it change while the agent works.
- **Agent** - run your configured LLM coding agent (Claude Code, Codex, Aider, …) in an embedded terminal inside Projque - manage several agents across different projects at once from the Agents view (external-terminal launch is still available from the project detail page)
- **Repository** - open the GitHub remote in your browser

Beyond the shelf itself: **create a new project** from inside Projque (folder + git init + README + first commit, optionally a GitHub repository via `gh`, optionally launching your agent with a kickoff prompt so it scaffolds the project for you), **clone a repository** straight into a project root, get **notified when a background agent needs you** (bell or gone-quiet detection), and **check PR & CI status** for the current branch via the GitHub CLI. `gh` is optional - every GitHub feature hides gracefully without it.

### Prompt and verify

ProjQue is built for working *with* an agent rather than reading code: you describe what you want, the agent does it, and ProjQue makes checking and keeping (or undoing) the result a one-click affair.

- **Try an idea safely** - describe an idea; ProjQue puts the agent on a separate `try/…` branch (your current version needs to be committed first, so nothing existing is ever at risk). Afterwards: **Keep it** commits and merges into your branch, **Throw it away** returns you to where you were - the attempt is pinned under History in case you change your mind.
- **Guided actions** - Fix a problem, Add a feature, Improve the look, Explain this project, Set up this project (follows the README to get it running) - each composes a well-formed prompt from your plain-language description.
- **Ask many** - one prompt, several projects: pick up to eight, and each gets its own agent session (with the usual backup first); four show side by side.
- **Your prompts** - save the prompts you keep typing ("make it mobile friendly", "add Swedish translation") as one-click buttons next to the guided actions; write `{input}` where you want to be asked for details each time.
- **Roleplay testers** - send in up to four pretend users at once (first-time visitor, non-technical user, power user, impatient user, edge-case hunter, returning casual user). Each runs in its own pane, stays in character, and writes what it hit - bugs, missing features, confusions - to its own `roleplay-*.md` in the project without touching your code.
- **Post-session review** - when an agent session ends, a card explains what changed in plain language and offers **Try it** (run the project), **Keep** (commit, with a suggested message), **Undo session** (back to exactly how things were before the agent started, new files included), or **Something's off** (send the agent back in with your correction). Nothing is final until you commit.
- **Safe commits** - a commit is blocked while anything that looks like a password or API key is in the files it would add; things that don't belong in git (`node_modules`, build output, OS junk, `.env`) are pointed out with a one-click **Leave them out** that fixes `.gitignore`.
- **Commit & push, deploy-aware** - one button commits, pulls newer commits fast-forward-only, and pushes. When the project's own pipeline says a push to this branch deploys (a GitHub Actions workflow on `push` to `main`, a Vercel/Netlify/Render config), the button asks first: *this goes live*. ProjQue never sets up hosting or runs a deploy itself.
- **Back up to GitHub** - a project with commits but no remote only exists on one disk; one button creates a *private* repository under your account and pushes (blocked while the secrets scan finds anything, exactly like publishing). Also offered as a suggestion.
- **History as a timeline** - your commits and the automatic backups (taken before every agent session and restore) in one list with **Go back to this**; going back is additive, so every state stays reachable.
- **Setup & checks** - which tools this project needs (Node, pnpm, cargo, Python, …) and whether they're installed, with a hand-off to the agent for anything missing; **Run tests** with a plain verdict and a *verified* chip on the project card; how the project gets to production, with **Explain** for a read-only walkthrough.
- **Health check** - one button on the projects page runs, for every project and one at a time: fetch from the remote, the package vulnerability check, and the tests (each step optional). A progress bar while it runs, then one summary grouped into Git (**Pull** / **Push** / Commit), Packages (**Update safely** / **Commit** / Ask the agent) and Tests (**Open output** / **Ask the agent to fix**). Commit after a package update is only offered where the project was clean before, so it never bundles other work.
- **Settings (.env)** - compares `.env.example` with `.env` and says which settings the project still needs before it runs, with a masked editor that writes into `.env` only (and an "ignore it" fix if `.env` could end up in a commit).
- **Check packages** - runs `npm audit` (or `pnpm audit`) and explains the result in plain words: how many known vulnerabilities, how severe, how many can be updated safely. **Update safely** runs `npm audit fix` (non-breaking updates only, never `--force`) where you can watch it; packages that need a bigger upgrade or have no fix yet go to the agent with the list and instructions to upgrade one at a time and run the tests after each.
- **Reclaim disk space** - installed packages, build output and caches (`node_modules`, `target`, `.next`, `__pycache__`, …) add up to gigabytes across many projects. Each project page shows how much is reinstallable with a **Clean up** button; Settings scans all projects and can clean them at once. Only a fixed list of regenerable folder names is ever deleted, never following symlinks, never your code.
- **Tidy up the code** - an agent brief for paying down vibe-coding debt: remove dead code and duplication, simplify, change nothing the project does; it must prove something is unused before removing it, run the project's own checks before and after, and never commit (you keep or undo in the review card). A **Code health** row counts commits and changed lines since the last tidy-up and suggests one when it adds up (15 commits or ~2,000 lines).
- **Explain this error** - when a run session prints something error-shaped, one click gets a plain-language explanation and an **Ask the agent to fix it** hand-off.
- **Roadmap & ideas as to-do lists** - checklist items in `ROADMAP.md` and `IDEAS.md` get a checkbox and **Build this**.
- **Live git status** - ProjQue watches your project folders (read-only) and refreshes a project's branch, changes and sync state the moment an agent commits or you save in your editor - no clicking refresh, no waiting for the window to regain focus.
- **Live activity** - a project that is doing something shows it: an animated bar per running thing (*Claude is working · 4m*, *waiting for you*, *Running tests*, *Checking packages…*) on the project card and page, fed by a two-second liveness pulse from the session itself.
- **Notifications** - when an agent finishes, a package check or test run completes, or an agent stops to ask you something, you get a clickable toast that jumps to it - and a system notification when the ProjQue window isn't focused (switchable, with quiet hours, in Settings). The bell in the header keeps everything that happened until you clear it; the dock badge counts what is waiting for you.
- **Tags & sorting** - label projects (`client`, `hobby`, `tool`…), filter by a tag from the chip row or with `#tag` in search, and sort by favorites & status, recently worked on, or name.
- **Suggestions** - each project gets a short "what to do next" list from the data ProjQue already has: long time since (or never) a package check, vulnerabilities found, changes not committed, commits not pushed, newer commits online, changed since the tests last passed, no version history, no README, no description. The most useful one sits on the card with a one-click action; the full list is on the project page. Anything can be hidden for a week.

## What this app does not do

These are guarantees, not just missing features:

- **No automatic network.** Git info comes from local git; the strict CSP and the absence of any HTTP client enforce it. The only network traffic is git against your own remotes (`fetch`, `pull --ff-only`, `push` - Fetch, Pull, Push, Commit & push, all explicit clicks), `gh` for the GitHub features, and your own `claude` CLI for plain-language summaries. Opening a repository hands the URL to your browser.
- **No telemetry.** There is no analytics code at all.
- **No accounts, no cloud sync.** Configuration is two human-readable JSON files you can back up with `cp`.
- **No arbitrary shell execution.** Only fixed, audited launcher actions exist; tools come from a static allowlist. See [docs/SECURITY.md](docs/SECURITY.md).

## Install & build

Prerequisites:

- Node.js ≥ 20
- Rust ≥ 1.77 (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Platform extras per the [Tauri prerequisites](https://tauri.app/start/prerequisites/):
  - **macOS:** Xcode Command Line Tools
  - **Windows:** MSVC Build Tools + WebView2
  - **Linux:** `webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`

```bash
npm install
npm run tauri dev    # development
npm run tauri build  # release bundle
```

macOS note: unsigned local builds may be quarantined by Gatekeeper. Fix with
`xattr -dr com.apple.quarantine "/Applications/Projque.app"`.

## Configuration

Two pretty-printed JSON files, safe to hand-edit and non-critical if lost (rescan your folders to recover the list):

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/com.projque.app/` |
| Windows | `%APPDATA%\com.projque.app\` |
| Linux | `~/.config/com.projque.app/` |

`settings.json`:

```json
{
  "configVersion": 1,
  "projectRoots": ["/Users/you/git"],
  "scanDepth": 3,
  "editor":   { "type": "vscode" },
  "terminal": { "type": "macos-terminal" },
  "agent":    { "type": "claude" },
  "display":  { "showArchived": false, "theme": "system" }
}
```

Advanced, file-only options: `"command"`/`"args"` on any tool override the catalog entry (run as argv, never through a shell), and `"pathAdditions": ["/some/bin"]` extends the search path for launcher programs - useful because GUI-launched apps don't inherit your shell's PATH.

## Supported tools

| Editors | Terminals | Agents |
|---|---|---|
| VS Code, Cursor, Zed, Sublime Text, IntelliJ IDEA, Rider, WebStorm | Terminal.app, iTerm2, Windows Terminal, kitty, Alacritty, WezTerm, Ghostty, GNOME Terminal, Konsole | Claude Code, Codex CLI, Aider, Gemini CLI, opencode, Cursor Agent |

**Adding a tool is a one-line pull request** - a single const entry in
[`src-tauri/src/launcher/catalog.rs`](src-tauri/src/launcher/catalog.rs). A great first issue.

## Troubleshooting

- **"code not found" (or any tool):** the CLI isn't on the PATH Projque can see. Install the tool's shell command, or add its directory to `pathAdditions` in `settings.json`.
- **Git info missing:** git isn't installed or isn't on PATH. Everything else keeps working.
- **Settings were reset:** the previous file failed to parse and was backed up next to the original as `*.invalid-<timestamp>.bak` - nothing is deleted.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - how it's put together, the trust boundary, how to extend it
- [docs/SECURITY.md](docs/SECURITY.md) - threat model and the invariants that keep this app boring
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) - dev loop and PR rules
- [docs/requirements.md](docs/requirements.md) - the original product spec

## License

[MIT](LICENSE)
