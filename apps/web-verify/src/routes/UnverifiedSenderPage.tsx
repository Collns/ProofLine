export function UnverifiedSenderPage() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="max-w-xl w-full space-y-6">
        <header className="space-y-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold rounded-full bg-gray-200 text-gray-700">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M5.5 5.5C5.5 4.67 6.17 4 7 4C7.83 4 8.5 4.67 8.5 5.5C8.5 6.33 7 7 7 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="7" cy="10" r="0.75" fill="currentColor" />
            </svg>
            Not enrolled
          </span>
          <h1 className="text-2xl font-bold text-[#0B1F3A]">
            This sender is not on ProofLine
          </h1>
          <p className="text-base text-gray-600 leading-relaxed">
            ProofLine cannot verify messages from senders who are not enrolled. This is not a
            sign of fraud — it just means there is no signature to check. Use your usual judgment
            before acting on the message.
          </p>
        </header>

        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[#0B1F3A]">Are you the sender?</h2>
          <p className="text-sm text-gray-600">
            If you send wire instructions, banking changes, or other high-value documents, enroll
            your company to give recipients a one-click way to verify your messages.
          </p>
          <a
            href="https://proofline.com/enroll"
            className="inline-block px-4 py-2 text-sm font-medium rounded-lg bg-[#0B1F3A] text-white hover:bg-[#1a3255] focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:ring-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn how to enroll
          </a>
        </div>

        <footer className="text-xs text-gray-400 text-center">
          ProofLine — cryptographic identity for B2B financial communications.
        </footer>
      </div>
    </div>
  );
}
