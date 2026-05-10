interface ExpiredBannerProps {
  detail?: string;
}

export function ExpiredBanner({ detail }: ExpiredBannerProps) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-700/40 bg-amber-700/5 p-5"
    >
      <p className="text-sm font-semibold text-amber-700">Cosign link expired</p>
      <p className="mt-1 text-sm text-gray-700">
        {detail ?? 'Cosign links expire for security. You can request a fresh link and continue.'}
      </p>
    </div>
  );
}
