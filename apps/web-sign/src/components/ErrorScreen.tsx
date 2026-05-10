import { ProofLineLogo } from './ProofLineLogo';

interface Props {
  title: string;
  detail?: string;
  code?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  retryLabel?: string;
  cancelLabel?: string;
}

export function ErrorScreen({
  title,
  detail,
  code,
  onRetry,
  onCancel,
  retryLabel = 'Try again',
  cancelLabel = 'Cancel',
}: Props) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-8 sm:py-12 space-y-6">
        <ProofLineLogo size="sm" />
        <div role="alert" className="space-y-3">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-[#D93025]" />
            <h1 className="text-xl font-semibold text-[#0B1F3A]">{title}</h1>
          </div>
          {detail && <p className="text-sm leading-relaxed text-gray-600">{detail}</p>}
          {code && (
            <p className="text-xs text-gray-500">
              Code: <code className="font-mono">{code}</code>
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 min-h-[48px]"
            >
              {retryLabel}
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-gray-200 bg-white px-5 py-3 text-base font-semibold text-[#0B1F3A] hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 min-h-[48px]"
            >
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
