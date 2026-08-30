# Local Project Hub - Requirements & Implementation Guide

## 1. Overview

Local Project Hub is a lightweight, fully offline desktop application for developers who work on many local projects and want a simple way to:

- See all projects in one place
- Understand the current status of each project
- Quickly reopen a project folder, editor, terminal, or repository
- Read a project description and roadmap
- Discover useful Git information without configuring external services

The application is intentionally local-first and simple.

It does **not** require:

- A user account
- A backend service
- A database server
- Cloud synchronization
- AI functionality
- GitHub API access
- Telemetry
- Internet connectivity

The primary goal is to make it effortless to answer two questions:

1. **What projects am I currently working on?**
2. **How do I get back into one of them immediately?**

---

# 2. Product Principles

The following principles should guide all product and implementation decisions.

## 2.1 Local First

All project configuration and metadata must be stored locally on the user's machine.

The application must remain fully usable without an internet connection.

## 2.2 File Based

The application should use simple local files instead of a database.

Configuration should be:

- Human readable
- Easy to back up
- Easy to inspect
- Easy to restore
- Non-critical if lost

If the configuration is deleted, the user should be able to recover most of the project list by scanning local project directories again.

## 2.3 Minimal Configuration

The application should infer as much information as possible from the local project.

Examples:

- Git repository presence
- Git remote URL
- Current branch
- Working tree state
- Latest commit
- README.md
- ROADMAP.md

The user should not need to modify an existing project for it to work with Local Project Hub.

## 2.4 Offline by Default

No network connection should be required for the core product.

Opening a repository URL in the user's browser is allowed, but no network requests should be performed automatically.

## 2.5 No Arbitrary Command Execution

Version 1 should not be a generic task runner.

The application should only expose a small set of known actions:

- Open project folder
- Open project in configured editor
- Open terminal in project folder
- Open repository URL

This keeps the application easy to understand and reduces security concerns.

## 2.6 Fast to Use

The project list is the main product.

Opening the application should immediately show the user's projects.

Avoid unnecessary:

- Dashboards
- Charts
- Wizards
- Project management features
- Authentication screens
- Cloud configuration

---

# 3. Scope

## 3.1 Version 1 Goals

Version 1 should support:

- Adding projects manually
- Scanning one or more root directories for Git repositories
- Importing discovered projects
- Showing all projects in a clear list
- Setting project status
- Setting a custom project description
- Marking projects as favorites
- Opening the local project folder
- Opening the project in the configured editor
- Opening a terminal in the project directory
- Opening the repository URL in the default browser
- Reading local Git metadata
- Rendering ROADMAP.md
- Optionally using README.md as the project description
- Filtering and sorting projects
- Persisting all application configuration in local files

## 3.2 Explicitly Out of Scope for Version 1

Do not implement the following in the first version:

- Accounts
- Authentication
- Cloud sync
- Remote backend
- AI generated summaries
- GitHub API integration
- Issue tracking
- Pull request tracking
- Generic shell commands
- User-defined scripts
- Build execution
- Task execution
- Deployment management
- Collaboration
- Team workspaces
- Project activity analytics
- SQLite or another database
- Automatic telemetry

These can be reconsidered later if real usage demonstrates a need.

---

# 4. Core User Experience

## 4.1 First Launch

On first launch, the user should be able to either:

1. Add a project manually
2. Select a directory containing projects

Example:

```text
Welcome

Where do you keep your projects?

[ Add project folder ]

Examples:
C:\git
D:\projects
~/source
```

After selecting a root folder, the application scans for repositories.

Example:

```text
Found 9 repositories

[x] Buildlas
[x] Gusta Core
[x] Gusta Draw
[x] Gusta Music
[x] Vigilo
[ ] test-project
[ ] old-poc

[ Import selected ]
```

The user should be able to start using the application immediately after import.

---

# 5. Main Project List

The project list should be the default screen.

Example:

```text
PROJECTS

★ Buildlas
  Active
  Compatibility platform
  feature/rules · 3 modified files
  Last commit: Today

  [Folder] [Editor] [Terminal] [Repository]


  Gusta Draw
  Paused
  Vector graphics editor
  main · clean
  Last commit: 18 days ago

  [Folder] [Editor] [Terminal] [Repository]
```

Each project card or row should show, when available:

- Project name
- Status
- Description
- Favorite indicator
- Current Git branch
- Working tree state
- Latest commit message
- Latest commit time
- Quick action buttons

The list should remain visually simple.

---

# 6. Project Details View

Selecting a project should open a detail view.

Example:

```text
Buildlas                             ACTIVE

Compatibility platform for discovering
compatible components.

Local path
C:\git\buildlas

Repository
https://github.com/example/buildlas

[ Open folder ]
[ Open editor ]
[ Open terminal ]
[ Open repository ]

----------------------------------------

Git

Branch        feature/rules
Working tree  3 modified files
Last commit   Add component rule engine
              Today

----------------------------------------

Roadmap

✓ Base product model
✓ Categories
□ Compatibility rules
□ Build generator
□ Affiliate integration
```

The detail view should prioritize useful information over configuration.

---

# 7. Project Status

Status should remain deliberately simple.

Supported values:

```text
Idea
Active
Paused
Maintenance
Done
Archived
```

Recommended behavior:

- `Active` projects appear near the top
- Favorites appear before non-favorites
- `Archived` projects may be hidden by default
- Status can be changed directly from the project view

Avoid:

- Completion percentages
- Kanban boards
- Sprint concepts
- Complex milestone systems

The product is a project overview tool, not a project management system.

---

# 8. Project Metadata

## 8.1 Locally Managed Metadata

Local Project Hub should maintain only metadata that cannot reliably be inferred from the project itself.

Recommended properties:

```json
{
  "id": "buildlas",
  "name": "Buildlas",
  "path": "C:\\git\\buildlas",
  "status": "active",
  "favorite": true,
  "description": "Compatibility platform",
  "descriptionSource": "custom",
  "roadmapFile": "ROADMAP.md"
}
```

Recommended fields:

| Field | Description |
|---|---|
| `id` | Stable internal identifier |
| `name` | Display name |
| `path` | Absolute local path |
| `status` | Current project status |
| `favorite` | Whether the project is pinned |
| `description` | Optional custom description |
| `descriptionSource` | `custom`, `readme`, or `none` |
| `roadmapFile` | Optional relative path to roadmap |

Repository URL should normally be discovered from Git rather than duplicated in configuration.

---

# 9. Application Configuration

Recommended configuration location:

## Windows

```text
%APPDATA%\LocalProjectHub\
```

## macOS

```text
~/Library/Application Support/LocalProjectHub/
```

## Linux

```text
~/.config/local-project-hub/
```

Suggested files:

```text
LocalProjectHub/
├── projects.json
└── settings.json
```

### Example `projects.json`

```json
[
  {
    "id": "buildlas",
    "name": "Buildlas",
    "path": "C:\\git\\buildlas",
    "status": "active",
    "favorite": true,
    "description": "Compatibility platform",
    "descriptionSource": "custom",
    "roadmapFile": "ROADMAP.md"
  }
]
```

### Example `settings.json`

```json
{
  "projectRoots": [
    "C:\\git"
  ],
  "editor": {
    "type": "vscode",
    "command": "code"
  },
  "terminal": {
    "type": "windows-terminal",
    "command": "wt"
  }
}
```

The format should be versionable later if necessary.

Example future field:

```json
{
  "configVersion": 1
}
```

---

# 10. Project Discovery

## 10.1 Root Folder Scanning

The user can configure one or more project roots.

Examples:

```text
C:\git
D:\projects
~/source
```

The application scans these folders for Git repositories.

A repository can initially be identified by the presence of:

```text
.git
```

The scanner should support a configurable or sensible maximum depth.

Recommended default:

```text
Maximum depth: 3
```

This prevents accidentally scanning large parts of the filesystem.

## 10.2 Discovery Rules

The scanner should:

- Only scan explicitly selected root directories
- Avoid scanning the entire filesystem
- Ignore hidden/system directories where appropriate
- Avoid following symbolic links by default
- Detect nested repositories
- Avoid importing duplicate paths
- Allow the user to select which discovered repositories to import

## 10.3 Optional Project Detection

Git should be the primary discovery mechanism.

Future versions may optionally recognize:

```text
*.sln
package.json
Cargo.toml
go.mod
pyproject.toml
```

However, these should not be required for Version 1.

---

# 11. Git Integration

Git information should come from the local repository only.

No GitHub API is required.

Useful Git commands include:

```bash
git branch --show-current
git status --porcelain
git log -1 --pretty=format:%H%n%s%n%ct
git remote get-url origin
```

The application should expose:

- Current branch
- Clean / modified state
- Number of changed files
- Latest commit hash
- Latest commit message
- Latest commit timestamp
- Repository remote URL

Git errors should never prevent the project from opening.

For example:

- Git is not installed
- Repository is corrupted
- Repository has no commits
- Repository has no remote

The UI should gracefully omit unavailable data.

---

# 12. Repository URL Handling

If a Git remote exists:

```bash
git remote get-url origin
```

the application should convert common SSH GitHub URLs into browser URLs.

Example:

```text
git@github.com:username/project.git
```

becomes:

```text
https://github.com/username/project
```

Likewise:

```text
https://github.com/username/project.git
```

becomes:

```text
https://github.com/username/project
```

Version 1 should support common GitHub URLs.

Support for GitLab, Bitbucket, Azure DevOps, and other providers can be implemented later using provider-specific URL normalization.

---

# 13. README Support

Projects may optionally use their README as their description source.

Supported file names should include:

```text
README.md
readme.md
Readme.md
```

Recommended behavior:

- Read only the local file
- Render Markdown safely
- Allow the user to choose `README.md` as the description source
- Do not automatically display the entire README in the project list

For the project list, use either:

- Custom description
- Extracted first meaningful paragraph
- No description

The full README does not need to be rendered in Version 1 unless useful.

---

# 14. ROADMAP.md Support

Roadmap support is an important feature.

The application should look for:

```text
ROADMAP.md
roadmap.md
Roadmap.md
```

The configured filename should override automatic detection.

The roadmap should be rendered as Markdown.

Example project file:

```markdown
# Roadmap

## Done

- [x] Basic product model
- [x] Categories

## In Progress

- [ ] Compatibility rules

## Planned

- [ ] Build generator
- [ ] Affiliate integration
```

The application should render the file directly instead of creating its own roadmap data model.

This ensures:

- The roadmap remains part of the repository
- It works on GitHub
- It works in VS Code
- It works without Local Project Hub
- There is no duplicate source of truth

Version 1 should treat ROADMAP.md as read-only.

Editing can be done in the user's normal editor.

---

# 15. Quick Actions

Version 1 should expose four primary actions.

## 15.1 Open Folder

Open the project directory in the operating system's file manager.

Examples:

Windows:

```text
explorer.exe <project-path>
```

macOS:

```text
open <project-path>
```

Linux:

```text
xdg-open <project-path>
```

## 15.2 Open Editor

Open the project in the configured editor.

Initial supported editor:

```text
Visual Studio Code
```

Example:

```bash
code <project-path>
```

Architecture should allow additional editors later:

- Visual Studio
- JetBrains Rider
- Cursor
- Zed
- Sublime Text

The UI should use the generic term:

```text
Open Editor
```

rather than hard-coding VS Code throughout the domain model.

## 15.3 Open Terminal

Open the configured terminal with the working directory set to the project path.

Examples:

Windows Terminal:

```bash
wt -d "<project-path>"
```

macOS Terminal:

```bash
open -a Terminal "<project-path>"
```

Linux terminal support depends on the configured terminal.

## 15.4 Open Repository

Open the normalized repository URL in the system default browser.

This action should only be shown when a usable remote URL is available.

---

# 16. Recommended Technology

## 16.1 Desktop Framework

Recommended:

```text
Tauri
```

Reasons:

- Small application footprint
- Native desktop capabilities
- Good support for filesystem and process integration
- Allows a modern web UI
- No localhost service required
- Lighter than Electron

## 16.2 Frontend

Recommended:

```text
React
TypeScript
```

Optionally:

```text
Vite
```

The UI should remain simple enough that a heavy component framework is unnecessary.

## 16.3 Native Layer

Tauri's Rust backend should handle:

- File access
- Directory scanning
- Git process execution
- Opening folders
- Opening editors
- Opening terminals
- Opening URLs
- Reading and writing configuration files

The React frontend should never directly access arbitrary filesystem paths.

---

# 17. Suggested Architecture

A simple architecture is sufficient.

```text
┌─────────────────────────────────────┐
│              React UI               │
│                                     │
│ Project List                        │
│ Project Details                     │
│ Settings                            │
└──────────────────┬──────────────────┘
                   │
             Tauri Commands
                   │
┌──────────────────▼──────────────────┐
│          Application Layer          │
│                                     │
│ ProjectService                      │
│ DiscoveryService                    │
│ GitService                          │
│ SettingsService                     │
│ LauncherService                     │
└──────────────┬──────────────────────┘
               │
      ┌────────┼───────────┐
      ▼        ▼           ▼
 Filesystem   Git       OS launcher
```

Recommended responsibilities:

## `ProjectService`

- Load project list
- Save project list
- Add project
- Remove project
- Update project metadata
- Resolve README
- Resolve ROADMAP

## `DiscoveryService`

- Scan configured roots
- Find Git repositories
- Deduplicate discovered repositories

## `GitService`

- Current branch
- Working tree status
- Latest commit
- Remote URL

## `LauncherService`

- Open folder
- Open editor
- Open terminal
- Open browser URL

## `SettingsService`

- Load settings
- Save settings
- Manage project roots
- Configure editor
- Configure terminal

---

# 18. Suggested Repository Structure

Example:

```text
local-project-hub/
├── src/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── models/
│   └── services/
│
├── src-tauri/
│   └── src/
│       ├── project/
│       ├── discovery/
│       ├── git/
│       ├── launcher/
│       └── settings/
│
├── docs/
│   ├── ARCHITECTURE.md
│   └── SECURITY.md
│
├── README.md
└── package.json
```

Avoid over-engineering the folder structure before the codebase requires it.

---

# 19. Security Requirements

Although Local Project Hub is a simple offline application, it interacts with local files and external applications.

The security model should remain easy to explain.

## 19.1 Filesystem Access

The application should:

- Scan only user-configured directories
- Read project files only inside imported project directories
- Avoid scanning arbitrary filesystem locations
- Avoid following symbolic links during recursive scanning unless explicitly supported
- Never access known secret locations automatically

## 19.2 Command Execution

Version 1 should not expose arbitrary shell execution.

Only known launcher operations should exist.

Examples:

```text
OpenFolder(project)
OpenEditor(project)
OpenTerminal(project)
OpenRepository(project)
```

The frontend should not send arbitrary shell command strings to the native layer.

## 19.3 Network Access

The core application should make no automatic network requests.

Opening a repository URL should hand the URL to the operating system's default browser.

## 19.4 Telemetry

Do not collect telemetry by default.

Ideally, Version 1 should contain no telemetry implementation at all.

## 19.5 Markdown Rendering

README.md and ROADMAP.md content must be treated as untrusted local content.

Markdown rendering should:

- Escape unsafe HTML
- Disable script execution
- Avoid arbitrary embedded web content where possible
- Sanitize links

---

# 20. Error Handling

The application should prefer graceful degradation.

Examples:

## Missing Project Directory

Display:

```text
Project folder could not be found.

C:\git\buildlas

[ Locate folder ]
[ Remove project ]
```

## Git Not Installed

The project remains usable.

Hide or disable Git information and display a small explanatory message.

## No Git Remote

Hide the repository button.

## ROADMAP.md Missing

Do not show an error.

Display either nothing or:

```text
No roadmap found.
```

## Invalid Configuration File

Do not silently overwrite user data.

Prefer:

1. Back up the invalid file
2. Show a clear error
3. Allow the user to recover or recreate configuration

---

# 21. Sorting and Filtering

Recommended default ordering:

1. Favorites
2. Active
3. Idea
4. Maintenance
5. Paused
6. Done
7. Archived

Within a status group:

```text
Latest Git activity first
```

Useful filters:

- All
- Active
- Paused
- Ideas
- Archived
- Favorites

A text search should match:

- Project name
- Description
- Local path

Avoid building a complex query system.

---

# 22. Settings

Keep settings minimal.

Suggested settings page:

```text
Project folders

C:\git
D:\projects

[ Add folder ]


Editor

Visual Studio Code


Terminal

Windows Terminal


Display

[ ] Show archived projects by default
```

Do not expose configuration that users rarely need.

---

# 23. Implementation Plan

## Phase 1 - Application Shell

Create the basic Tauri + React application.

Implement:

- Main window
- Project list page
- Empty state
- Settings page
- Local configuration directory

At the end of this phase, the application should launch and persist simple settings.

---

## Phase 2 - Project Configuration

Implement `projects.json`.

Functions:

```text
loadProjects()
saveProjects()
addProject()
updateProject()
removeProject()
```

Allow adding a project manually by selecting a directory.

Display:

- Name
- Path
- Status
- Favorite
- Description

At the end of this phase, the application is already useful as a simple project list.

---

## Phase 3 - Project Discovery

Implement root folder configuration.

Create a scanner that:

1. Receives a configured root path
2. Recursively scans to a limited depth
3. Detects `.git`
4. Returns repository candidates
5. Deduplicates paths
6. Allows selected repositories to be imported

Do not automatically import everything.

---

## Phase 4 - Quick Actions

Implement:

```text
Open Folder
Open Editor
Open Terminal
Open Repository
```

Keep platform-specific launcher code isolated behind `LauncherService`.

At this point, the application becomes useful as a daily project launcher.

---

## Phase 5 - Local Git Information

Create `GitService`.

Implement:

```text
getCurrentBranch()
getWorkingTreeStatus()
getLatestCommit()
getRemoteUrl()
```

Run operations asynchronously so slow repositories do not block the UI.

Cache Git state briefly if necessary.

Do not introduce persistent caching in Version 1 unless performance requires it.

---

## Phase 6 - README and ROADMAP

Implement local Markdown discovery.

For each project:

1. Check configured roadmap path
2. Check default ROADMAP.md variants
3. Read Markdown
4. Sanitize
5. Render

Add optional README description source.

At this point, Version 1 contains the complete intended product concept.

---

## Phase 7 - UX Refinement

Focus on:

- Keyboard navigation
- Fast startup
- Empty states
- Sorting
- Filters
- Search
- Missing-folder recovery
- Clear status badges
- Responsive layout
- Dark/light theme if desired

Avoid adding new product concepts during this phase.

---

# 24. Suggested MVP Acceptance Criteria

Version 1 can be considered complete when a new user can:

1. Download and launch the application
2. Select a folder containing repositories
3. See discovered projects
4. Import selected projects
5. See those projects on the main screen
6. Assign statuses
7. Add or edit descriptions
8. Favorite projects
9. See current Git branch
10. See whether the repository has local changes
11. See the latest commit
12. Open the project folder
13. Open the project in VS Code
14. Open a terminal in the project directory
15. Open the repository in a browser
16. Open a project detail view
17. Read its ROADMAP.md
18. Close and reopen the application without losing configuration
19. Use the core application while completely offline

---

# 25. Future Ideas

These should remain outside Version 1 until there is clear demand.

Possible additions:

- Additional editors
- Additional terminals
- GitLab / Bitbucket repository URL normalization
- Project tags
- Project icons
- Recently opened projects
- Keyboard shortcuts
- Tray mode
- Global launcher shortcut
- Multiple workspace roots
- Custom README/roadmap filenames
- Project grouping
- Import/export configuration
- Portable mode
- Cross-device sync as an optional external feature
- CLI companion

Any future feature should preserve the original principle:

> Local Project Hub should remain useful as a small, understandable, completely offline tool.

---

# 26. Product Positioning

Local Project Hub is not intended to replace:

- GitHub
- Jira
- Linear
- VS Code
- Git clients
- Task managers

It is the layer above local development projects.

A simple description could be:

> **Your local project shelf.**
>
> Keep track of what you're building, see where you left off, and jump back into any project instantly.

The application should feel closer to opening a bookshelf than opening a project management platform.

That simplicity is the product.
