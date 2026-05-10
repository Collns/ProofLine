export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ErrorContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  fingerprint?: string[];
}

export interface Span {
  end(): void;
}

export interface UserContext {
  id: string;
  companyId: string;
}

export interface ObservabilityProvider {
  captureError(err: Error, context?: ErrorContext): void;
  captureMessage(msg: string, level: LogLevel): void;
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void;
  traceSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>;
  setUser(user: UserContext | null): void;
}
