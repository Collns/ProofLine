interface ErrorScreenProps {
  title: string;
  detail: string;
  /** Optional secondary call-to-action — e.g., "Request fresh link". */
  cta?: { label: string; onClick: () => void; href?: string };
}

export function ErrorScreen({ title, detail, cta }: ErrorScreenProps) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-red-600/50 bg-red-50 p-6"
    >
      <p className="text-sm font-semibold text-red-600">{title}</p>
      <p className="mt-2 text-sm text-gray-900">{detail}</p>
      {cta ? (
        cta.href ? (
          <a
            href={cta.href}
            className="mt-4 inline-block rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            {cta.label}
          </a>
        ) : (
          <button
            type="button"
            onClick={cta.onClick}
            className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            {cta.label}
          </button>
        )
      ) : null}
    </div>
  );
}
