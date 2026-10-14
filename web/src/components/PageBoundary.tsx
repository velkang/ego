import { Component, type ReactNode } from "react";

export class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="page">
          <h1>This page couldn’t open</h1>
          <p role="alert">Check your connection, then reload to try again.</p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </main>
      );
    return this.props.children;
  }
}
