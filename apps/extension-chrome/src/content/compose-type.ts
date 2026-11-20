/**
 * @file compose-type.ts
 * @module apps/extension-chrome/src/content
 *
 * PFL-188 — best-effort classification of a Gmail compose surface for the
 * unsigned-send audit log: new compose, inline reply/reply-all/forward, and
 * popped-out reply/forward. Gmail's DOM doesn't label these cleanly, so this
 * is heuristic (never used for enforcement — only for the audit record).
 */

export function composeType(compose: Element): string {
  const dialog =
    compose.getAttribute('role') === 'dialog'
      ? compose
      : compose.closest('[role="dialog"]');
  const label = (dialog?.getAttribute('aria-label') ?? '').toLowerCase();

  if (dialog) {
    if (label.includes('forward')) return 'popout_forward';
    if (label.includes('reply')) return 'popout_reply';
    // A fresh "New Message" dialog, or a Gmail compose with no reply/forward hint.
    return 'new_compose';
  }

  // No dialog → inline reply/forward inside the thread.
  const subject = compose.querySelector<HTMLInputElement>('input[name="subjectbox"]')?.value?.trim().toLowerCase() ?? '';
  if (subject.startsWith('fwd:') || subject.startsWith('fw:')) return 'inline_forward';
  return 'inline_reply';
}
