# Projque

> **Your local project shelf.** Keep track of what you're building, see where you left off, and jump back into any project instantly.

Projque is a local-first, fully offline desktop app that gives you an overview of all your local development projects: status, description, Git state, and roadmap — with quick actions to open the folder, editor, terminal, repository, or an LLM coding agent in any project.

## What this app does not do

- No network requests, ever
- No telemetry
- No accounts or cloud sync
- No arbitrary shell execution

## Development

Prerequisites: Node.js >= 20, Rust >= 1.77 (`rustup`), plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev    # run in development
npm run tauri build  # build the app bundle
```

Docs: see `docs/requirements.md` (product spec). ARCHITECTURE.md and SECURITY.md coming with v1.
