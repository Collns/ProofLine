import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-xl px-4 py-16 space-y-4 text-center">
        <h1 className="text-3xl font-semibold text-[#0B1F3A]">Page not found</h1>
        <p className="text-base text-gray-600">
          We couldn't find that page.
        </p>
        <Link
          to="/onboarding"
          className="inline-block text-sm font-medium text-[#0D6EFD] hover:underline"
        >
          Start onboarding →
        </Link>
      </div>
    </div>
  );
}
