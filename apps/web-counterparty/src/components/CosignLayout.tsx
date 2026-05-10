import type { ReactNode } from 'react';
import { ProofLineLogo } from './ProofLineLogo';

interface CosignLayoutProps {
  children: ReactNode;
  /** Optional subtitle shown next to the logo (e.g., "Cosign request"). */
  label?: string;
}

export function CosignLayout({ children, label = 'Cosign request' }: CosignLayoutProps) {
  return (
    <div className="min-h-dvh flex flex-col bg-gray-50">
      <header className="bg-navy-900 text-white">
        <div className="mx-auto max-w-2xl px-4 py-4 flex items-center gap-3">
          <ProofLineLogo />
          <span className="text-sm text-white/70">·</span>
          <span className="text-sm font-medium text-white/90">{label}</span>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-4 py-6 pb-32 sm:pb-6">{children}</div>
      </main>
    </div>
  );
}
