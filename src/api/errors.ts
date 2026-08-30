// Mirror of src-tauri/src/error.rs - adding a Rust variant requires a
// matching edit here; the exhaustive switch in userMessage() enforces it.

export type AppError =
  | { kind: "projectNotFound"; id: string }
  | { kind: "pathMissing"; path: string }
  | { kind: "notADirectory"; path: string }
  | { kind: "duplicateProject"; id: string; name: string }
  | { kind: "configInvalid"; file: string; backupPath?: string; detail: string }
  | { kind: "configWrite"; file: string; detail: string }
  | { kind: "configVersionUnsupported"; file: string; found: number; supported: number }
  | { kind: "gitUnavailable" }
  | { kind: "gitFailed"; detail: string }
  | { kind: "branchNotFound"; branch: string }
  | { kind: "sessionNotFound"; id: string }
  | { kind: "sessionExited"; id: string }
  | { kind: "runTargetNotFound"; target: string }
  | { kind: "nameInvalid"; detail: string }
  | { kind: "alreadyExists"; path: string }
  | { kind: "ghUnavailable" }
  | { kind: "ghFailed"; detail: string }
  | { kind: "programNotFound"; program: string }
  | { kind: "launchFailed"; program: string; detail: string }
  | { kind: "unsupportedPlatform"; detail: string }
  | { kind: "invalidInput"; detail: string }
  | { kind: "io"; detail: string }
  | { kind: "unknown"; detail: string };

export function parseAppError(err: unknown): AppError {
  if (typeof err === "object" && err !== null && "kind" in err) {
    return err as AppError;
  }
  return { kind: "unknown", detail: String(err) };
}

export interface UserMessage {
  title: string;
  detail?: string;
}

export function userMessage(err: AppError): UserMessage {
  switch (err.kind) {
    case "projectNotFound":
      return { title: "Project not found", detail: "It may have been removed. Try refreshing." };
    case "pathMissing":
      return { title: "Project folder is missing", detail: err.path };
    case "notADirectory":
      return { title: "Not a folder", detail: err.path };
    case "duplicateProject":
      return { title: "Already imported", detail: `${err.name} is already in your project list.` };
    case "configInvalid":
      return {
        title: `${err.file} could not be read`,
        detail: err.backupPath
          ? `Your data is safe - the file was backed up to ${err.backupPath}.`
          : err.detail,
      };
    case "configWrite":
      return { title: `Could not save ${err.file}`, detail: err.detail };
    case "configVersionUnsupported":
      return {
        title: "Configuration is from a newer version",
        detail: `${err.file} was written by a newer ProjQue (version ${err.found}). Update the app to make changes.`,
      };
    case "gitUnavailable":
      return { title: "Git is not installed", detail: "Git information is hidden until git is available." };
    case "gitFailed":
      return { title: "Git command failed", detail: err.detail };
    case "branchNotFound":
      return {
        title: `Branch "${err.branch}" not found`,
        detail: "It may have been deleted - refresh and try again.",
      };
    case "sessionNotFound":
      return { title: "Agent session not found", detail: "It may have been removed." };
    case "sessionExited":
      return { title: "Agent session has ended" };
    case "runTargetNotFound":
      return {
        title: "Run target no longer exists",
        detail: "The project files may have changed - reopen the Run menu.",
      };
    case "nameInvalid":
      return { title: "Invalid name", detail: err.detail };
    case "alreadyExists":
      return { title: "Folder already exists", detail: err.path };
    case "ghUnavailable":
      return {
        title: "GitHub CLI not available",
        detail: "Install gh and run 'gh auth login' to enable GitHub features.",
      };
    case "ghFailed":
      return { title: "GitHub CLI failed", detail: err.detail };
    case "programNotFound":
      return {
        title: `${err.program} not found`,
        detail: "Install it or pick another tool in Settings.",
      };
    case "launchFailed":
      return { title: `Failed to launch ${err.program}`, detail: err.detail };
    case "unsupportedPlatform":
      return { title: "Not supported on this platform", detail: err.detail };
    case "invalidInput":
      return { title: "Invalid input", detail: err.detail };
    case "io":
      return { title: "File system error", detail: err.detail };
    case "unknown":
      return { title: "Something went wrong", detail: err.detail };
  }
}
