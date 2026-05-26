import { Component, type ReactNode } from "react";

/**
 * Isolates chart rendering crashes (e.g. a lightweight-charts data assertion)
 * so a single bad data point shows a small inline error instead of taking down
 * the whole dashboard. `resetKey` clears the error when it changes (new item,
 * new timeframe, fresh data) so the chart retries automatically.
 */
export class ChartErrorBoundary extends Component<
  { children: ReactNode; resetKey?: unknown },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="text-muted-foreground flex h-full w-full items-center justify-center p-3 text-center font-mono text-[11px]">
          chart error — {this.state.error.message.slice(0, 140)}
        </div>
      );
    }
    return this.props.children;
  }
}
