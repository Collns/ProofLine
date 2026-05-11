// Message shapes exchanged between the content script and the
// background service worker.
//
// Discriminated by `type`. The content script sends; the SW responds.
// New variants get added here so both sides stay in sync.

import type { EmailPayload } from '@proofline/types';

// Fields the content script can extract from Gmail's compose DOM.
// `from` and `companyId` are filled by the background SW from auth
// state — never trust the page DOM for the user's own identity.
export type PartialEmailPayload = Omit<EmailPayload, 'from' | 'companyId'>;

export type ExtractError =
  | { code: 'EMPTY_TO' }
  | { code: 'INVALID_EMAIL'; field: 'to' | 'cc' | 'bcc'; value: string }
  | { code: 'EMPTY_SUBJECT' }
  | { code: 'DOM_UNEXPECTED'; reason: string; domSnapshot: string };

export interface SignButtonClickedMessage {
  type: 'SIGN_BUTTON_CLICKED';
  composeId: string | null;
}

export interface PingMessage {
  type: 'PING';
}

export interface PayloadExtractedMessage {
  type: 'PAYLOAD_EXTRACTED';
  composeId: string;
  canonicalHashHex: string;
  partialPayload: PartialEmailPayload;
}

export interface ExtractionFailedMessage {
  type: 'EXTRACTION_FAILED';
  composeId: string;
  error: ExtractError;
}

export type ContentToBackgroundMessage =
  | SignButtonClickedMessage
  | PingMessage
  | PayloadExtractedMessage
  | ExtractionFailedMessage;

// ── Background → content (injected via chrome.tabs.sendMessage) ──────────────

export interface PayloadSignedMessage {
  type: 'PAYLOAD_SIGNED';
  composeId: string;
  bannerHtml: string;
}

export interface PayloadNeedsCosignMessage {
  type: 'PAYLOAD_NEEDS_COSIGN';
  composeId: string;
  approvers: string[];
}

export interface SignFailedMessage {
  type: 'SIGN_FAILED';
  composeId: string;
  code: string;
  message: string;
}

export type BackgroundToContentMessage =
  | PayloadSignedMessage
  | PayloadNeedsCosignMessage
  | SignFailedMessage;

const KNOWN_BG_TO_CONTENT: ReadonlySet<BackgroundToContentMessage['type']> = new Set([
  'PAYLOAD_SIGNED',
  'PAYLOAD_NEEDS_COSIGN',
  'SIGN_FAILED',
]);

export function isBackgroundToContentMessage(
  value: unknown,
): value is BackgroundToContentMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown };
  if (typeof candidate.type !== 'string') return false;
  return KNOWN_BG_TO_CONTENT.has(
    candidate.type as BackgroundToContentMessage['type'],
  );
}

export interface BackgroundAck {
  ok: true;
  stub?: boolean | 'extracted';
  receivedType: ContentToBackgroundMessage['type'];
}

export interface BackgroundError {
  ok: false;
  error: string;
}

export type BackgroundResponse = BackgroundAck | BackgroundError;

const KNOWN_TYPES: ReadonlySet<ContentToBackgroundMessage['type']> = new Set([
  'SIGN_BUTTON_CLICKED',
  'PING',
  'PAYLOAD_EXTRACTED',
  'EXTRACTION_FAILED',
]);

export function isContentToBackgroundMessage(
  value: unknown,
): value is ContentToBackgroundMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown };
  if (typeof candidate.type !== 'string') return false;
  return KNOWN_TYPES.has(candidate.type as ContentToBackgroundMessage['type']);
}
