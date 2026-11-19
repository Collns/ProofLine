/**
 * @file sign-payload.ts
 * @module apps/extension-chrome/src/content
 *
 * Builds the payload the Sign button hands to the background (PFL-135):
 * the extracted email payload plus, when "Wire instruction" is toggled on,
 * the wire fields from wire-fields.ts. Invalid wire fields block signing
 * (the inputs are already marked invalid inline by getWireState).
 */

import { EmailPayload } from '@proofline/types';

import { extractPayload, type ExtractResult } from './extract-payload.js';
import { getWireState } from './wire-fields.js';
import type { PartialEmailPayload } from '../shared/types.js';

export type SignPayloadResult =
  | { ok: true; payload: PartialEmailPayload; isHighValue: boolean }
  | { ok: false; reason: 'extraction'; extraction: Extract<ExtractResult, { ok: false }> }
  | { ok: false; reason: 'wire_invalid' };

export function buildSignPayload(compose: Element): SignPayloadResult {
  const extracted = extractPayload(compose);
  if (!extracted.ok) return { ok: false, reason: 'extraction', extraction: extracted };

  const wire = getWireState(compose);
  if (!wire.isWireInstruction) {
    return { ok: true, payload: extracted.payload, isHighValue: false };
  }
  if (!wire.isValid || !wire.wirePayload) {
    return { ok: false, reason: 'wire_invalid' };
  }

  const payload: PartialEmailPayload = {
    ...extracted.payload,
    isWireInstruction: true,
    wirePayload: wire.wirePayload,
  };

  // Same defense-in-depth check extractPayload does: the full schema must
  // accept the payload (placeholder identity is filled by the background).
  const check = EmailPayload.safeParse({ ...payload, from: 'placeholder@proofline.local', companyId: 'placeholder' });
  if (!check.success) return { ok: false, reason: 'wire_invalid' };

  return { ok: true, payload, isHighValue: wire.isHighValue };
}
