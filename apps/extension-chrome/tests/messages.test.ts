import { describe, it, expect } from 'vitest';
import {
  isContentToBackgroundMessage,
  type ContentToBackgroundMessage,
  type BackgroundResponse,
} from '../src/shared/types.js';
import { handleMessage } from '../src/background/messages.js';

describe('isContentToBackgroundMessage', () => {
  it('accepts SIGN_BUTTON_CLICKED with valid shape', () => {
    const msg: ContentToBackgroundMessage = {
      type: 'SIGN_BUTTON_CLICKED',
      composeId: 'draft-123',
    };
    expect(isContentToBackgroundMessage(msg)).toBe(true);
  });

  it('accepts PING with no payload', () => {
    expect(isContentToBackgroundMessage({ type: 'PING' })).toBe(true);
  });

  it('rejects unknown types and malformed values', () => {
    expect(isContentToBackgroundMessage({ type: 'NOT_A_REAL_TYPE' })).toBe(false);
    expect(isContentToBackgroundMessage({ noType: true })).toBe(false);
    expect(isContentToBackgroundMessage(null)).toBe(false);
    expect(isContentToBackgroundMessage('SIGN_BUTTON_CLICKED')).toBe(false);
    expect(isContentToBackgroundMessage(undefined)).toBe(false);
  });
});

describe('handleMessage (background)', () => {
  const fakeSender = {} as chrome.runtime.MessageSender;

  it('acks a valid SIGN_BUTTON_CLICKED with stub:true', () => {
    const response = handleMessage(
      { type: 'SIGN_BUTTON_CLICKED', composeId: null },
      fakeSender,
    ) as BackgroundResponse;

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.stub).toBe(true);
      expect(response.receivedType).toBe('SIGN_BUTTON_CLICKED');
    }
  });

  it('returns ok:false for unknown message shapes', () => {
    const response = handleMessage({ totally: 'wrong' }, fakeSender) as BackgroundResponse;
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error).toBe('unknown_message_shape');
    }
  });
});
