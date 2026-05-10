import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-4">
        <p className="text-6xl font-bold text-gray-200" aria-hidden="true">404</p>
        <h1 className="text-xl font-semibold text-[#0B1F3A]">Page not found</h1>
        <p className="text-sm text-gray-600">
          This URL does not match a known verification route.
        </p>
        <div className="text-sm text-gray-500 space-y-1">
          <p>Expected formats:</p>
          <p className="font-mono text-xs bg-gray-100 rounded px-2 py-1">/v/&#123;messageId&#125;</p>
          <p className="font-mono text-xs bg-gray-100 rounded px-2 py-1">/b/&#123;docId&#125;</p>
        </div>
        <Link
          to="/v/demo?fixture=verified-wire"
          className="inline-block px-4 py-2 text-sm font-medium rounded-lg bg-[#0B1F3A] text-white hover:bg-[#1a3255] focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:ring-offset-2"
        >
          View demo
        </Link>
      </div>
    </div>
  );
}
