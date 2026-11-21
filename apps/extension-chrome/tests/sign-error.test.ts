/**
 * PFL-190 #5 — a signing-popup error must reach the compose banner immediately
 * with a specific, actionable message (and a Retry), instead of leaving the
 * compose stuck on "Signing…" until the popup is closed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginSigning,
  failSigningWithMessage,
  friendlySignError,
  getSignState,
  SEND_ALERT_ATTR,
  SIGNING_PROGRESS_ATTR,
} from '../src/content/send-guard.js';
import { INJECTED_MARKER } from '../src/content/shared.js';

function makeCompose(): HTMLElement {
  document.body.innerHTML = '';
  const compose = document.createElement('div');
  const sign = document.createElement('button');
  sign.setAttribute(INJECTED_MARKER, 'true');
  const body = document.createElement('div');
  body.setAttribute('role', 'textbox');
  body.setAttribute('contenteditable', 'true');
  compose.append(sign, body);
  document.body.appendChild(compose);
  return compose;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('friendlySignError', () => {
  it('maps known codes to actionable copy', () => {
    expect(friendlySignError('USER_CANCELLED')).toMatch(/cancelled/i);
    expect(friendlySignError('SENDER_DOMAIN_MISMATCH')).toMatch(/verified domain/i);
    expect(friendlySignError('AUTH_REQUIRED')).toMatch(/connect proofline/i);
  });

  it('prefers a specific server message, but falls back to the code for generic ones', () => {
    expect(friendlySignError('X', 'From address must match acme.com')).toBe('From address must match acme.com');
    expect(friendlySignError('POLICY_DENIED', 'Server rejected the assertion.')).toBe(
      "ProofLine couldn't sign this email (POLICY_DENIED).",
    );
    expect(friendlySignError('WEIRD')).toBe("ProofLine couldn't sign this email (WEIRD).");
  });
});

describe('failSigningWithMessage', () => {
  it('clears the "Signing…" progress and shows the specific error + Retry', () => {
    const compose = makeCompose();
    beginSigning(compose, { schedule: () => ({ cancel: () => {} }) });
    expect(compose.querySelector(`[${SIGNING_PROGRESS_ATTR}]`)).not.toBeNull();
    expect(getSignState(compose)).toBe('pending');

    failSigningWithMessage(compose, 'This account can only sign mail from acme.com');

    expect(compose.querySelector(`[${SIGNING_PROGRESS_ATTR}]`)).toBeNull(); // no longer "Signing…"
    const alert = compose.querySelector(`[${SEND_ALERT_ATTR}]`)!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toMatch(/only sign mail from acme\.com/);
    expect(alert.querySelector('[data-proofline-retry-sign]')).not.toBeNull();
    expect(getSignState(compose)).toBe('failed');
  });
});
