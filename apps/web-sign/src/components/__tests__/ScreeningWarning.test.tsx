import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SigningScreening } from '@proofline/types';
import { ScreeningWarning } from '../ScreeningWarning';

const html = (screening?: SigningScreening) => renderToStaticMarkup(<ScreeningWarning screening={screening} />);

describe('ScreeningWarning (PFL-028)', () => {
  it('renders nothing with no screening or a clean result', () => {
    expect(html(undefined)).toBe('');
    expect(html({ status: 'ok', provider: 'heuristic', flags: [] })).toBe('');
  });

  it('warns on flags with human labels and the quoted evidence, and never says blocked', () => {
    const out = html({
      status: 'ok', provider: 'gemini', score: 88,
      summary: 'Changed bank details with urgency.',
      flags: [
        { type: 'payment_change', evidence: 'our bank details have changed' },
        { type: 'secrecy', evidence: 'do not call the office' },
      ],
    });
    expect(out).toContain('payment-redirection fraud');
    expect(out).toContain('trusted phone number');
    expect(out).toContain('New or changed bank / account details');
    expect(out).toContain('Asked to keep it quiet');
    expect(out).toContain('our bank details have changed');
    expect(out).toContain('Changed bank details with urgency.');
    expect(out.toLowerCase()).not.toContain('blocked');
    expect(out).toContain('role="alert"');
  });

  it('says screening could not run when unavailable (not a clean result)', () => {
    const out = html({ status: 'unavailable', provider: 'gemini', flags: [] });
    expect(out).toContain('could not run');
    expect(out).toContain('not a clean result');
  });
});
