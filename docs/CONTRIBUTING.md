# Contributing

## Dev loop

```bash
npm install
npm run tauri dev      # app with hot reload
npm run build          # tsc + vite (type-checks the frontend)
cargo fmt --check      # in src-tauri/
cargo clippy -- -D warnings
cargo test
```

Please run all of the above before pushing.

## Invariants a PR must not break

These are the properties the product is selling; CI will eventually enforce them mechanically:

1. **No new plugin permissions.** `src-tauri/capabilities/default.json` grants the webview core window basics only. Plugins are used from Rust, not exposed over IPC.
2. **No command parameters that carry filesystem paths or shell strings.** Commands take opaque IDs and closed enums. Pickers run in Rust.
3. **No `rehype-raw`, no `dangerouslySetInnerHTML`.** All markdown goes through `MarkdownView`.
4. **No network clients** (rust or npm) and no telemetry.
5. **No `tauri-plugin-shell`.** Processes are spawned as argv arrays via `std::process::Command`.

## Easy first contributions

- Add an editor/terminal/agent: one const line in `src-tauri/src/launcher/catalog.rs` (see ARCHITECTURE.md).
- Repository URL normalization for GitLab/Bitbucket/Azure: match arms in `src-tauri/src/git/remote.rs` (+ tests).

## Type mirroring

Rust models (serde camelCase) are mirrored by hand in `src/models/` and `src/api/errors.ts`. If you change one side, change the other - the exhaustive switch in `errors.ts` will fail to compile if an error variant is missing.
