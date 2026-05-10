import type {
  ObservabilityProvider, ErrorContext, LogLevel, Span, UserContext,
} from '../types.js';

export interface CapturedError {
  type: 'error';
  error: Error;
  context?: ErrorContext;
  capturedAt: number;
}
export interface CapturedMessage {
  type: 'message';
  msg: string;
  level: LogLevel;
  capturedAt: number;
}
export interface CapturedLog {
  type: 'log';
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
  capturedAt: number;
}

export type CapturedRecord = CapturedError | CapturedMessage | CapturedLog;

export interface StubObservabilityProvider extends ObservabilityProvider {
  getCaptured(): readonly CapturedRecord[];
  clearCaptured(): void;
  getUser(): UserContext | null;
}

export interface StubObservabilityOptions {
  now?: () => number;
}

export function makeStubObservabilityProvider(
  opts?: StubObservabilityOptions,
): StubObservabilityProvider {
  const captured: CapturedRecord[] = [];
  let user: UserContext | null = null;
  const now = opts?.now ?? (() => Date.now());

  return {
    captureError(error, context) {
      captured.push({ type: 'error', error, context, capturedAt: now() });
    },
    captureMessage(msg, level) {
      captured.push({ type: 'message', msg, level, capturedAt: now() });
    },
    log(level, event, data) {
      captured.push({ type: 'log', level, event, data, capturedAt: now() });
    },
    async traceSpan(_name, fn) {
      const span: Span = { end: () => {} };
      return fn(span);
    },
    setUser(u) {
      user = u;
    },
    getCaptured() {
      return captured;
    },
    clearCaptured() {
      captured.length = 0;
    },
    getUser() {
      return user;
    },
  };
}
