// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error("App crashed:", err); }
  render() {
    if (!this.state.err) return this.props.children;
    return <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 640, margin: "0 auto" }}>
      <h2>MedAI could not start</h2>
      <p>Please reload the page. If this keeps happening, send this message to the site admin:</p>
      <pre style={{ whiteSpace: "pre-wrap", background: "#fff6e0", padding: 12, borderRadius: 8 }}>{String(this.state.err.message || this.state.err)}</pre>
      <button onClick={() => window.location.reload()}>Reload</button>
    </div>;
  }
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
