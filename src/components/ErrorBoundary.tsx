import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onReset: () => void;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: "40px 24px",
            maxWidth: 560,
            margin: "0 auto",
            textAlign: "center",
            color: "var(--text)",
          }}
        >
          <h2 style={{ fontSize: 18, marginBottom: 10 }}>Something broke on this screen</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 8 }}>
            {this.state.error.message}
          </p>
          <pre
            style={{
              textAlign: "left",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-faint)",
              background: "var(--bg-sunken)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "10px 12px",
              overflow: "auto",
              maxHeight: 160,
              marginBottom: 16,
              userSelect: "text",
            }}
          >
            {this.state.error.stack}
          </pre>
          <button
            className="btn"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
          >
            Back to projects
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
