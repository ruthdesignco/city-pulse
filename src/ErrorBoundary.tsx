import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Catches a failed tile/routes.json fetch (or any other render-time
// throw) so it takes down the error message and a retry button, not the
// whole page including the Freshness pill. Loaders clear their cached
// promise on rejection (see useCity.ts, useRoutes.ts), so retrying actually
// refetches instead of suspending on the same dead promise.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown): void {
    // The error text is aimed at developers (e.g. "run `npm run bake` first");
    // it's logged here, not shown, so a visitor never sees it.
    console.error(error)
  }

  private retry = (): void => this.setState({ error: null })

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary">
        <p>Something went wrong loading City Pulse.</p>
        <button type="button" onClick={this.retry}>
          Try again
        </button>
      </div>
    )
  }
}
