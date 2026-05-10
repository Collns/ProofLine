import { ProofLineLogo } from '../components/ProofLineLogo';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-12 space-y-4 text-center">
        <div className="flex justify-center">
          <ProofLineLogo size="sm" />
        </div>
        <h1 className="text-xl font-semibold text-[#0B1F3A]">Page not found</h1>
        <p className="text-sm text-gray-600">
          This window opens automatically when you sign an email. You can close it.
        </p>
      </div>
    </div>
  );
}
