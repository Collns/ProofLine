import { Link } from 'react-router-dom';

export function DashboardHome() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-xl px-4 py-12 space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0F9D58]">Verified</p>
          <h1 className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
            Welcome to ProofLine
          </h1>
          <p className="text-base text-gray-600">
            Your company is verified and ready to send signed mail. The full admin dashboard
            (active sessions, device management, manual review queue) lands in upcoming releases.
          </p>
        </header>
        <div className="rounded-md border border-gray-200 bg-white p-4 sm:p-5 space-y-3">
          <p className="text-sm font-medium text-[#0B1F3A]">Next steps</p>
          <ul className="space-y-1.5 text-sm text-[#1F2937]">
            <li>• Install the Chrome extension to start signing in Gmail.</li>
            <li>• Invite teammates and assign roles.</li>
            <li>• Review your domain's anchor on Base Sepolia for an audit trail.</li>
          </ul>
        </div>
        <Link
          to="/onboarding"
          className="text-sm font-medium text-[#0D6EFD] hover:underline"
        >
          ← Run another company through onboarding
        </Link>
      </div>
    </div>
  );
}
