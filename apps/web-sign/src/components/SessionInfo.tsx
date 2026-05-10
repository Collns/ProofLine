interface Props {
  recipientCount: number;
  ttlMinutes?: number;
}

export function SessionInfo({ recipientCount, ttlMinutes = 15 }: Props) {
  return (
    <details className="rounded-md border border-gray-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer font-medium text-[#0B1F3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] rounded">
        What does signing do?
      </summary>
      <div className="mt-3 space-y-2 text-gray-600">
        <p>
          Your device produces a cryptographic signature over this message's
          canonical bytes. ProofLine never sees your private key.
        </p>
        <p>
          We open a session for the {recipientCount === 1 ? 'recipient' : 'recipients'} on this email.
          For the next {ttlMinutes} minutes, replies to{' '}
          {recipientCount === 1 ? 'this address' : 'these addresses'} can be
          signed silently — no biometric prompt — but the full policy pipeline
          still runs server-side on every send.
        </p>
        <p>
          High-value wires always require fresh biometric, even mid-session.
        </p>
      </div>
    </details>
  );
}
