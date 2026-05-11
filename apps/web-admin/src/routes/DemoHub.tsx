/**
 * Demo Hub — single launchpad for ProofLine demo screens.
 *
 * Mounted at /demo on web-admin. Mirrors AppShell.tsx visual language
 * exactly: navy-square logo, gray-50 bg, max-w containers, blue-600
 * focus rings.
 */

import { Link } from 'react-router-dom';

interface DemoLink {
  label: string;
  href: string;
  beat?: string;
  accent?: 'blue' | 'green' | 'red' | 'amber';
  description?: string;
  internal?: boolean; // true = use react-router Link (within web-admin)
}

const LINKS: DemoLink[] = [
  // ── Onboarding ────────────────────────────────────
  {
    label: 'Onboarding wizard',
    href: '/onboarding',
    beat: 'T+0–25s',
    description: '9-step setup: DNS, KYB, KYC, key ceremony, anchor.',
    internal: true,
  },

  // ── Dashboard + Invitations ───────────────────────
  {
    label: 'Dashboard',
    href: '/dashboard',
    beat: 'T+25s',
    description: 'Network coverage 43%. Recent invitations.',
    internal: true,
  },
  {
    label: 'Invite counterparties',
    href: '/invitations/new',
    beat: 'T+30s',
    description: 'Single + bulk paste up to 100.',
    internal: true,
  },
  {
    label: 'Invitations list',
    href: '/invitations',
    beat: 'T+40s',
    description: 'Filter, search, paginate 28 invites.',
    internal: true,
  },

  // ── Cosign (the money shot) ────────────────────────
  {
    label: 'Cosign — happy path',
    href:
      'https://proofline-counterparty.web.app/cosign/demo?t=demo&fixture=ready',
    beat: 'T+125s',
    accent: 'blue',
    description: '$400k. 6-step verify. Touch ID approves.',
  },
  {
    label: 'Cosign — tampered',
    href:
      'https://proofline-counterparty.web.app/cosign/demo?t=demo&fixture=tampered',
    beat: 'T+155s',
    accent: 'red',
    description: 'Wire mismatch detected. Refused.',
  },
  {
    label: 'Cosign — expired',
    href:
      'https://proofline-counterparty.web.app/cosign/demo?t=demo&fixture=expired',
    accent: 'amber',
    description: 'Link expired. Request fresh.',
  },

  // ── Verify (recipient view) ────────────────────────
  {
    label: 'Verify — verified wire',
    href: 'https://proofline-verify.web.app/v/demo?fixture=verified-wire',
    beat: 'T+140s',
    accent: 'green',
    description: 'Green check, anchor on Basescan.',
  },
  {
    label: 'Verify — bilateral',
    href: 'https://proofline-verify.web.app/v/demo?fixture=bilateral',
    accent: 'green',
    description: 'Both parties signed. Emerald state.',
  },
  {
    label: 'Verify — suspected spoof',
    href: 'https://proofline-verify.web.app/v/demo?fixture=suspected-spoof',
    accent: 'red',
    description: 'Sender domain verified, body unsigned.',
  },

  // ── Backstage ──────────────────────────────────────
  {
    label: 'Base Sepolia explorer',
    href: 'https://sepolia.basescan.org/',
    description: 'On-chain anchor receipts.',
  },
  {
    label: 'Firebase console',
    href:
      'https://console.firebase.google.com/project/proofline-cdabb/overview',
    description: 'Deploys, logs, hosting.',
  },
];

export function DemoHub() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header — same shape as AppShell */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link
            to="/demo"
            className="flex items-center gap-2 text-[#0B1F3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 rounded-sm"
          >
            <span
              aria-hidden="true"
              className="inline-block h-6 w-6 rounded-md bg-[#0B1F3A]"
            />
            <span className="text-base font-semibold tracking-tight">
              ProofLine
            </span>
          </Link>
          <nav className="hidden gap-1 sm:flex" aria-label="Main">
            <Link
              to="/dashboard"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-[#0B1F3A]"
            >
              Dashboard
            </Link>
            <Link
              to="/invitations"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-[#0B1F3A]"
            >
              Invitations
            </Link>
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <div className="mb-10 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#0F9D58]">
            Demo hub
          </p>
          <h1 className="mb-3 text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
            ProofLine — live demo
          </h1>
          <p className="mx-auto max-w-xl text-base text-gray-600">
            Cryptographic identity layer for B2B financial communications.
            Click any tile to jump to that screen.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {LINKS.map((link) => (
            <DemoTile key={link.href} link={link} />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="mx-auto max-w-3xl px-4 pb-10 pt-6 text-center text-xs text-gray-500">
        ProofLine · Verified business identity for email
      </footer>
    </div>
  );
}

function DemoTile({ link }: { link: DemoLink }) {
  const accentClass = accentBorderClass(link.accent);
  const baseClass = [
    'group relative aspect-square',
    'flex flex-col justify-between',
    'rounded-lg border bg-white p-4',
    'transition-all duration-150',
    'hover:shadow-md hover:-translate-y-0.5',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
    accentClass,
  ].join(' ');

  const content = (
    <>
      <div>
        {link.beat && (
          <span className="font-mono text-[10px] uppercase tracking-wide text-gray-500">
            {link.beat}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center">
        <h3 className="text-sm font-semibold leading-snug text-[#0B1F3A]">
          {link.label}
        </h3>
      </div>
      <div className="flex items-end justify-between gap-2">
        {link.description && (
          <p className="line-clamp-2 flex-1 text-xs leading-tight text-gray-500">
            {link.description}
          </p>
        )}
        <span
          aria-hidden="true"
          className="flex-shrink-0 text-xs text-gray-400 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        >
          ↗
        </span>
      </div>
    </>
  );

  if (link.internal) {
    return (
      <Link to={link.href} className={baseClass}>
        {content}
      </Link>
    );
  }

  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className={baseClass}
    >
      {content}
    </a>
  );
}

function accentBorderClass(accent?: DemoLink['accent']): string {
  switch (accent) {
    case 'blue':
      return 'border-2 border-[#0D6EFD]';
    case 'green':
      return 'border-2 border-[#0F9D58]';
    case 'red':
      return 'border-2 border-[#D93025]';
    case 'amber':
      return 'border-2 border-[#B45309]';
    default:
      return 'border border-gray-200';
  }
}