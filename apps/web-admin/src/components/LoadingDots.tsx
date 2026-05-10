interface Props {
  label?: string;
}

export function LoadingDots({ label }: Props) {
  return (
    <div className="flex items-center gap-3" role="status" aria-live="polite">
      <span className="inline-flex gap-1" aria-hidden="true">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#0D6EFD]" style={{ animationDelay: '0ms'   }} />
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#0D6EFD]" style={{ animationDelay: '150ms' }} />
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#0D6EFD]" style={{ animationDelay: '300ms' }} />
      </span>
      {label && <span className="text-sm text-gray-600">{label}</span>}
    </div>
  );
}
