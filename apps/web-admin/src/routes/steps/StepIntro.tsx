import { PrimaryButton } from '../../components/PrimaryButton';

interface Props {
  onContinue: () => void;
}

export function StepIntro({ onContinue }: Props) {
  return (
    <section className="space-y-6" aria-labelledby="intro-heading">
      <header className="space-y-3">
        <h1 id="intro-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          Let's verify your business
        </h1>
        <p className="text-base leading-relaxed text-gray-600">
          We'll prove three things about your company so your emails carry a trustworthy
          ProofLine signature.
        </p>
      </header>

      <ul className="space-y-3">
        <Bullet>
          <strong>Domain control.</strong> Add a TXT record to your DNS so we know you
          own the domain you'll be sending from.
        </Bullet>
        <Bullet>
          <strong>Business identity.</strong> Your legal name and EIN, checked against
          the state of incorporation registry.
        </Bullet>
        <Bullet>
          <strong>Officer identity.</strong> A government-issued ID for the person
          responsible for this account.
        </Bullet>
      </ul>

      <p className="text-sm text-gray-500">
        About 15 minutes if you have your EIN and a US state-issued ID handy.
      </p>

      <PrimaryButton onClick={onContinue}>Get started</PrimaryButton>
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#0D6EFD]" />
      <span className="text-base leading-relaxed text-[#1F2937]">{children}</span>
    </li>
  );
}
