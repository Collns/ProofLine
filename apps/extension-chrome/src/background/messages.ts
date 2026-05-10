import { log, warn } from '../shared/log.js';
import {
  isContentToBackgroundMessage,
  type BackgroundResponse,
  type ContentToBackgroundMessage,
} from '../shared/types.js';

export function handleMessage(
  raw: unknown,
  _sender: chrome.runtime.MessageSender,
): BackgroundResponse {
  if (!isContentToBackgroundMessage(raw)) {
    warn('background', 'rejected unknown message shape', raw);
    return { ok: false, error: 'unknown_message_shape' };
  }
  const msg = raw as ContentToBackgroundMessage;
  log('background', 'message received', msg);

  // Real handlers wire later (PFL-044/047). For now we ack with a stub
  // so the content script can prove the round-trip works.
  switch (msg.type) {
    case 'SIGN_BUTTON_CLICKED':
    case 'PING':
      return { ok: true, stub: true, receivedType: msg.type };
    case 'PAYLOAD_EXTRACTED':
      return { ok: true, stub: 'extracted', receivedType: msg.type };
    case 'EXTRACTION_FAILED':
      return { ok: false, error: msg.error.code };
  }
}
