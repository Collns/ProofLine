import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// PFL-121: gate for routes that require authentication.
//   - loading              → spinner
//   - not signed in        → /login
//   - signed in, requireCompany && no companyId → /onboarding
//   - otherwise            → render children
//
// `requireCompany` defaults to true. Set it false for /onboarding itself,
// where a freshly-signed-in user legitimately has no company yet.
export function ProtectedRoute({
  children,
  requireCompany = true,
}: {
  children: ReactNode;
  requireCompany?: boolean;
}) {
  const { user, loading, companyId, companyResolved } = useAuth();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  if (requireCompany) {
    if (!companyResolved) return <FullPageSpinner />;
    if (!companyId) return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

export function FullPageSpinner() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gray-50"
      role="status"
      aria-label="Loading"
    >
      <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[#0D6EFD] border-t-transparent" />
    </div>
  );
}
