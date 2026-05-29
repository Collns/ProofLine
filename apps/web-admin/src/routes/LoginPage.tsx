import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FullPageSpinner } from '../components/ProtectedRoute';

// PFL-121: branded sign-in page. Google OAuth is the primary path; an
// email-link option is offered as a secondary (passwordless) flow.
export function LoginPage() {
  const { user, loading, signInWithGoogle, signInWithEmail } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to="/dashboard" replace />;

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithEmail(email.trim());
      setEmailSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the sign-in link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 text-[#0B1F3A]">
          <span aria-hidden="true" className="inline-block h-6 w-6 rounded-md bg-[#0B1F3A]" />
          <span className="text-base font-semibold tracking-tight">ProofLine</span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#0F9D58]">Admin</p>
            <h1 className="text-2xl font-semibold text-[#0B1F3A]">Sign in</h1>
            <p className="text-sm text-gray-600">
              Access your company’s ProofLine admin dashboard.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {emailSent ? (
            <div className="rounded-md border border-[#0F9D58]/30 bg-[#0F9D58]/10 px-3 py-3 text-sm text-[#0B1F3A]">
              Check <span className="font-medium">{email}</span> for a sign-in link.
            </div>
          ) : !emailMode ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : null}
                Sign in with Google
              </button>
              <button
                type="button"
                onClick={() => { setEmailMode(true); setError(null); }}
                disabled={busy}
                className="min-h-[44px] w-full rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-[#0B1F3A] transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 disabled:opacity-60"
              >
                Sign in with email
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmail} className="space-y-3" noValidate>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[#0B1F3A]">Work email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm text-[#0B1F3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD]"
                />
              </label>
              <button
                type="submit"
                disabled={busy || email.trim().length === 0}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : null}
                Send sign-in link
              </button>
              <button
                type="button"
                onClick={() => { setEmailMode(false); setError(null); }}
                className="w-full text-center text-sm font-medium text-[#0D6EFD] hover:underline"
              >
                ← Back to Google sign-in
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-xs text-gray-500">
            Verified business identity for email
          </p>
        </div>
      </main>
    </div>
  );
}
