import { NUMBERED_STEPS, STEP_LABEL, type WizardStep } from '../state/wizard-store';

interface Props {
  currentStep: WizardStep;
}

// Sticky pill: "Step N of 6 — {label}" with collapsed-dot indicator.
// The post-success steps (key-ceremony / anchored / extension) collapse
// into "Almost done" once the visible 1-of-6 flow is complete.
export function Stepper({ currentStep }: Props) {
  const visibleIdx = NUMBERED_STEPS.indexOf(currentStep);
  const isPostFlow = visibleIdx === -1;
  const total = NUMBERED_STEPS.length;
  const stepNumber = isPostFlow ? total : visibleIdx + 1;
  const announce = isPostFlow
    ? `Final steps — ${STEP_LABEL[currentStep]}`
    : `Step ${stepNumber} of ${total} — ${STEP_LABEL[currentStep]}`;

  return (
    <div className="sticky top-0 z-10 -mx-4 border-b border-gray-200 bg-white/85 px-4 py-3 backdrop-blur sm:-mx-0 sm:rounded-md sm:border sm:bg-white">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="flex items-center gap-3 text-sm font-medium text-[#0B1F3A]"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {isPostFlow ? `${total} of ${total}` : `${stepNumber} of ${total}`}
        </span>
        <span className="text-[#1F2937]">{STEP_LABEL[currentStep]}</span>
      </div>
      <div className="mt-2 flex gap-1.5" aria-hidden="true">
        {NUMBERED_STEPS.map((step, idx) => {
          const filled = isPostFlow || idx <= visibleIdx;
          return (
            <span
              key={step}
              className={[
                'h-1 flex-1 rounded-full transition-colors duration-300',
                filled ? 'bg-[#0D6EFD]' : 'bg-gray-200',
              ].join(' ')}
            />
          );
        })}
      </div>
      <span className="sr-only">{announce}</span>
    </div>
  );
}
