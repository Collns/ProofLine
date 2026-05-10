import type { ChecklistStep } from '../lib/verify-checklist';

interface VerificationChecklistProps {
  steps: ChecklistStep[];
}

const ICON_PASSED  = '✓';
const ICON_FAILED  = '✕';
const ICON_RUNNING = '…';
const ICON_PENDING = '·';

function statusClasses(status: ChecklistStep['status']): { row: string; icon: string; label: string } {
  switch (status) {
    case 'passed':
      return {
        row:   'border-gray-200',
        icon:  'bg-green-600 text-white',
        label: 'text-gray-900',
      };
    case 'failed':
      return {
        row:   'border-red-600 bg-red-50',
        icon:  'bg-red-600 text-white',
        label: 'text-red-600 font-medium',
      };
    case 'running':
      return {
        row:   'border-blue-600',
        icon:  'bg-blue-600 text-white animate-pulse',
        label: 'text-gray-900',
      };
    case 'pending':
    default:
      return {
        row:   'border-gray-200',
        icon:  'bg-gray-100 text-gray-500',
        label: 'text-gray-500',
      };
  }
}

function iconChar(status: ChecklistStep['status']): string {
  if (status === 'passed')  return ICON_PASSED;
  if (status === 'failed')  return ICON_FAILED;
  if (status === 'running') return ICON_RUNNING;
  return ICON_PENDING;
}

export function VerificationChecklist({ steps }: VerificationChecklistProps) {
  return (
    <section
      aria-label="Pre-approval verification checklist"
      className="rounded-2xl border border-gray-200 bg-white shadow-sm"
    >
      <header className="border-b border-gray-200 px-5 py-3">
        <p className="text-xs uppercase tracking-wider text-gray-500">Verification</p>
      </header>
      <ul className="divide-y divide-gray-100">
        {steps.map((step) => {
          const cls = statusClasses(step.status);
          return (
            <li
              key={step.id}
              className={`flex items-start gap-3 border-l-2 px-5 py-3 ${cls.row}`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${cls.icon}`}
              >
                {iconChar(step.status)}
              </span>
              <div className="min-w-0">
                <p className={`text-sm ${cls.label}`}>{step.label}</p>
                {step.status === 'failed' && step.failureDetail ? (
                  <p className="mt-1 text-xs text-red-600">{step.failureDetail}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
