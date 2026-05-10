import { useState } from 'react';
import { Field } from './Field';
import { PrimaryButton } from './PrimaryButton';

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
const MESSAGE_MAX = 280;

export interface SingleInviteSubmit {
  email: string;
  message: string | null;
  sponsoredCost: boolean;
}

interface Props {
  onSubmit: (input: SingleInviteSubmit) => Promise<void> | void;
  disabled?: boolean;
  selfDomainLowerCase?: string;
}

export function InviteFormSingle({
  onSubmit,
  disabled,
  selfDomainLowerCase,
}: Props) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sponsored, setSponsored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    const trimmed = email.trim();
    if (!trimmed) return 'Enter an email address.';
    if (!EMAIL_RE.test(trimmed)) return 'That doesn’t look like a valid email.';
    if (
      selfDomainLowerCase &&
      trimmed.toLowerCase().endsWith(`@${selfDomainLowerCase}`)
    ) {
      return 'You can’t invite an address on your own domain.';
    }
    if (message.length > MESSAGE_MAX) {
      return `Message is ${message.length - MESSAGE_MAX} characters over the ${MESSAGE_MAX} limit.`;
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        email:         email.trim(),
        message:       message.trim() ? message.trim() : null,
        sponsoredCost: sponsored,
      });
      setEmail('');
      setMessage('');
      setSponsored(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Couldn’t send invitation. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <Field
        label="Counterparty email"
        type="email"
        autoComplete="email"
        placeholder="wires@scotiabank.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={disabled || busy}
        error={error ?? undefined}
        hint="They’ll receive a one-click sign-up link valid for 30 days."
      />

      <div className="space-y-1.5">
        <label
          htmlFor="invite-message"
          className="block text-sm font-medium text-[#0B1F3A]"
        >
          Personal message <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <textarea
          id="invite-message"
          rows={3}
          maxLength={MESSAGE_MAX + 50}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={disabled || busy}
          placeholder="Hey — we’re sending wires through ProofLine now. Sign up so we can transact securely."
          className={[
            'block w-full rounded-md border border-gray-200 bg-white px-3 py-2.5',
            'text-sm text-[#1F2937] placeholder:text-gray-400',
            'shadow-sm transition-colors duration-200',
            'focus:outline-none focus:ring-2 focus:ring-[#0D6EFD] focus:border-[#0D6EFD]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          ].join(' ')}
        />
        <p
          className={[
            'text-xs',
            message.length > MESSAGE_MAX ? 'text-[#D93025]' : 'text-gray-500',
          ].join(' ')}
        >
          {message.length}/{MESSAGE_MAX}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-white px-4 py-3">
        <input
          type="checkbox"
          checked={sponsored}
          onChange={(e) => setSponsored(e.target.checked)}
          disabled={disabled || busy}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0D6EFD] focus:ring-[#0D6EFD]"
        />
        <span className="text-sm text-[#1F2937]">
          <span className="font-medium text-[#0B1F3A]">Sponsor onboarding cost</span>
          <span className="block text-xs text-gray-500">
            Cover this counterparty’s verification fee. Off by default.
          </span>
        </span>
      </label>

      <PrimaryButton type="submit" loading={busy} disabled={disabled}>
        Send invitation
      </PrimaryButton>
    </form>
  );
}
