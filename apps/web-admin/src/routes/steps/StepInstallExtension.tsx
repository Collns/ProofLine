import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';

interface Props {
  onSkip: () => void;
}

// TODO(PFL-EXT-WEBSTORE): replace placeholder with real Chrome Web Store URL
// once the extension is published.
const WEBSTORE_URL = 'https://chrome.google.com/webstore/search/proofline';

export function StepInstallExtension({ onSkip }: Props) {
  return (
    <section className="space-y-6" aria-labelledby="extension-heading">
      <header className="space-y-2">
        <h1 id="extension-heading" className="text-2xl font-semibold text-[#0B1F3A] sm:text-3xl">
          Install the ProofLine extension
        </h1>
        <p className="text-base leading-relaxed text-gray-600">
          Sign your emails directly in Gmail. No workflow change.
        </p>
      </header>

      <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 sm:p-5">
        <ul className="space-y-2 text-sm text-[#1F2937]">
          <BulletItem>One-click signing on send.</BulletItem>
          <BulletItem>Banner appears in your recipient's inbox.</BulletItem>
          <BulletItem>Touch ID or Face ID for the first send of a session — silent thereafter.</BulletItem>
        </ul>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <SecondaryButton onClick={onSkip}>Skip for now → Go to dashboard</SecondaryButton>
        <a
          href={WEBSTORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[#0D6EFD] px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#0B5BD6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D6EFD] focus-visible:ring-offset-2 min-h-[48px]"
        >
          Add to Chrome
        </a>
      </div>
    </section>
  );
}

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#0D6EFD]" />
      <span>{children}</span>
    </li>
  );
}
