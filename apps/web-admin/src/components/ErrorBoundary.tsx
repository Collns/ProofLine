import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[web-admin] uncaught error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-gray-50">
          <div className="mx-auto max-w-xl px-4 py-12">
            <h1 className="text-xl font-semibold text-[#0B1F3A]">Something went wrong</h1>
            <p className="mt-2 text-sm text-gray-600">
              The page hit an unexpected error. Reload to try again.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md bg-[#0D6EFD] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0B5BD6]"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
