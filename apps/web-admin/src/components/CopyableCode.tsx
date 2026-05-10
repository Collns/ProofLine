import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
}

export function CopyableCode({ value, label }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — silently fail; user can select+copy manually.
    }
  }

  return (
    <div className="space-y-1.5">
      {label && <p className="text-sm font-medium text-[#0B1F3A]">{label}</p>}
      <div className="flex items-stretch gap-2">
        <code className="font-mono flex-1 select-all overflow-x-auto rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-[#1F2937]">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy to clipboard'}
          className={[
            'shrink-0 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium',
            'transition-colors duration-200 hover:bg-gray-50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2',
            copied ? 'text-[#0F9D58]' : 'text-[#0B1F3A]',
          ].join(' ')}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
