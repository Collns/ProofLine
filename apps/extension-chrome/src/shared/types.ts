// Message shapes exchanged between the content script and the
// background service worker.
//
// Discriminated by `type`. The content script sends; the SW responds.
// New variants get added here so both sides stay in sync.

export interface SignButtonClickedMessage {
  type: 'SIGN_BUTTON_CLICKED';
  composeId: string | null;
}

export interface PingMessage {
  type: 'PING';
}

export type ContentToBackgroundMessage =
  | SignButtonClickedMessage
  | PingMessage;

export interface BackgroundAck {
  ok: true;
  stub?: boolean;
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
]);

export function isContentToBackgroundMessage(
  value: unknown,
): value is ContentToBackgroundMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown };
  if (typeof candidate.type !== 'string') return false;
  return KNOWN_TYPES.has(candidate.type as ContentToBackgroundMessage['type']);
}
