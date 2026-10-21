"use client";

import { Component, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Fail-safe UI shell: a rendering fault in any widget can never crash the
 * whole atelier, and details stay off-screen (no stack leakage to the DOM).
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("[atelier:error-boundary]", error);
    }
  }

  private reset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-ink px-6">
          <div className="max-w-md rounded-2xl border border-gold/20 bg-coal p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
              <TriangleAlert className="h-6 w-6 text-gold" />
            </div>
            <h1 className="mt-6 font-display text-3xl text-ivory">
              The atelier paused.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-mute">
              Something unexpected happened while rendering the interface. Your
              wardrobe data is safe — a quick reset restores the room.
            </p>
            <button
              type="button"
              onClick={this.reset}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-semibold tracking-wide text-ink transition hover:bg-gold-soft"
            >
              <RotateCcw className="h-4 w-4" />
              Restore the atelier
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
