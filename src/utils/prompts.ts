/** The "Tidy up the code" brief. Behaviour-preserving by construction: the
 *  agent may only remove what it can prove unused, must run the project's
 *  own checks before and after, and must not commit - the post-session
 *  review card is where the user keeps or undoes the result. */
export const CLEANUP_PROMPT =
  `Tidy up this project's code without changing what it does. This is maintenance, not a feature.\n\n` +
  `Goals, in order:\n` +
  `1. Remove dead code: unused files, functions, components, variables, imports, dependencies, commented-out blocks, leftover debug output, and features nothing can reach anymore.\n` +
  `2. Remove duplication where extracting a shared piece clearly makes the code simpler.\n` +
  `3. Simplify code that is more complicated than it needs to be, the way a careful maintainer would.\n\n` +
  `Rules:\n` +
  `- Behaviour must stay identical: no new features, no changed wording anywhere the user can see, no changed data or file formats, no changed public interfaces.\n` +
  `- Only remove something when you can show nothing uses it - search the whole project, including configuration, templates, scripts, styles, and references by name (strings, dynamic imports, reflection). If you are not sure, leave it and list it in your summary instead.\n` +
  `- If the project has a build, type check, linter, or tests, run them BEFORE you start (so you know the baseline) and AFTER every few changes. If something breaks, undo your last change rather than patching around it.\n` +
  `- Do not touch generated files, lockfiles, the .git directory, roleplay-*.md reports, IDEAS.md, or documentation - except to delete docs for something you removed.\n` +
  `- Do not commit. ProjQue shows a review when you are done, where the user keeps or undoes your work.\n` +
  `- Work in small, safe steps; prefer leaving something in over a risky removal.\n\n` +
  `Finish with a plain-language summary for someone who is not a programmer: what you removed and why it was safe, what you simplified, roughly how much smaller the code got, and anything you deliberately left alone because you were unsure.`;
