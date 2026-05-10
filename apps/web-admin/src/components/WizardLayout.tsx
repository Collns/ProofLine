import type { ReactNode } from 'react';
import { Stepper } from './Stepper';
import type { WizardStep } from '../state/wizard-store';

interface Props {
  step: WizardStep;
  children: ReactNode;
}

export function WizardLayout({ step, children }: Props) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
        <ProoflineLogo />
        <div className="mt-4 sm:mt-6">
          <Stepper currentStep={step} />
        </div>
        <main key={step} className="step-enter mt-6 sm:mt-8 space-y-6">
          {children}
        </main>
        <footer className="mt-12 border-t border-gray-200 pt-6 text-center text-xs text-gray-500">
          ProofLine · Verified business identity for email
        </footer>
      </div>
    </div>
  );
}

function ProoflineLogo() {
  return (
    <div className="flex items-center gap-2 text-[#0B1F3A]">
      <span aria-hidden="true" className="inline-block h-6 w-6 rounded-md bg-[#0B1F3A]" />
      <span className="text-base font-semibold tracking-tight">ProofLine</span>
    </div>
  );
}
