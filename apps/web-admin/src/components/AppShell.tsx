import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

interface Props {
  children: ReactNode;
  // Optional eyebrow text shown above the page heading.
  eyebrow?: string;
  heading?: string;
  description?: ReactNode;
  // When true, the dashboard nav is hidden (e.g. on a focused form page
  // where the back-link in the page header is the primary navigation).
  hideNav?: boolean;
}

export function AppShell({
  children,
  eyebrow,
  heading,
  description,
  hideNav,
}: Props) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-[#0B1F3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 rounded-sm"
          >
            <span aria-hidden="true" className="inline-block h-6 w-6 rounded-md bg-[#0B1F3A]" />
            <span className="text-base font-semibold tracking-tight">ProofLine</span>
          </Link>
          {!hideNav ? (
            <nav className="hidden gap-1 sm:flex" aria-label="Main">
              <ShellNavLink to="/dashboard" end>Dashboard</ShellNavLink>
              <ShellNavLink to="/invitations">Invitations</ShellNavLink>
            </nav>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        {(eyebrow || heading || description) && (
          <div className="mb-6 space-y-1.5">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-wide text-[#0F9D58]">
                {eyebrow}
              </p>
            ) : null}
            {heading ? (
              <h1 className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
                {heading}
              </h1>
            ) : null}
            {description ? (
              <div className="text-base text-gray-600">{description}</div>
            ) : null}
          </div>
        )}
        {children}
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 pt-6 text-center text-xs text-gray-500">
        ProofLine · Verified business identity for email
      </footer>
    </div>
  );
}

function ShellNavLink({
  to,
  end,
  children,
}: {
  to: string;
  end?: boolean;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
          isActive
            ? 'bg-[#0D6EFD]/10 text-[#0D6EFD]'
            : 'text-gray-600 hover:bg-gray-100 hover:text-[#0B1F3A]',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}
