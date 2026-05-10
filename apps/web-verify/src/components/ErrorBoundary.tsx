import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="min-h-screen bg-gray-50 flex items-center justify-center p-4"
        >
          <div className="max-w-md w-full rounded-xl border border-gray-200 bg-white p-6 text-center">
            <div className="text-4xl mb-4" aria-hidden="true">
              <svg
                className="mx-auto"
                width="48"
                height="48"
                viewBox="0 0 48 48"
                fill="none"
              >
                <circle cx="24" cy="24" r="22" stroke="#D93025" strokeWidth="2" />
                <path
                  d="M24 14v14M24 32v2"
                  stroke="#D93025"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-gray-900 mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-gray-600 mb-4">
              An unexpected error occurred while loading this page. Try refreshing.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-[#0B1F3A] text-white hover:bg-[#1a3255] focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:ring-offset-2"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
