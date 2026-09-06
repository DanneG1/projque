import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyAppearance } from "./utils/appearance";
import "./styles/tokens.css";
import "./styles/styles.css";
import "./styles/global.css";

// Follow the OS from the first paint; App/SessionWindow re-apply the saved
// settings once they are loaded.
applyAppearance("system", "classic");

// A detached session window is the same bundle with ?session=<id>: it
// renders one terminal instead of the app. Lazy, like the Agents page, so
// index never imports the terminal module directly (see terminal/manager).
const SessionWindow = lazy(() =>
  import("./pages/SessionWindow").then((m) => ({ default: m.SessionWindow })),
);
const detachedSession = new URLSearchParams(window.location.search).get("session");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {detachedSession ? (
      <Suspense fallback={null}>
        <SessionWindow sessionId={detachedSession} />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
