import * as Sentry from '@sentry/node';
import type {
  ObservabilityProvider, ErrorContext, LogLevel, Span, UserContext,
} from '../types.js';
import { sanitizeForLogging } from '../sanitizer.js';

export interface SentryOptions {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRate?: number;
}

type SentrySeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

function toSentrySeverity(level: LogLevel): SentrySeverity {
  return level === 'warn' ? 'warning' : level;
}

export function makeSentryProvider(opts: SentryOptions): ObservabilityProvider {
  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    tracesSampleRate: opts.tracesSampleRate ?? 1.0,
    beforeSend: (event) => sanitizeForLogging(event) as typeof event,
  });

  return {
    captureError(error, context) {
      Sentry.captureException(error, {
        tags: context?.tags,
        extra: context?.extra
          ? (sanitizeForLogging(context.extra) as Record<string, unknown>)
          : undefined,
        fingerprint: context?.fingerprint,
      });
    },
    captureMessage(msg, level) {
      Sentry.captureMessage(msg, toSentrySeverity(level));
    },
    log(level, event, data) {
      const safeData = data
        ? (sanitizeForLogging(data) as Record<string, unknown>)
        : undefined;
      Sentry.addBreadcrumb({ category: event, level: toSentrySeverity(level), data: safeData });
      const line = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...(safeData ?? {}),
      });
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    },
    async traceSpan(name, fn) {
      return Sentry.startSpan({ name }, async () => {
        const span: Span = { end: () => {} };
        return fn(span);
      });
    },
    setUser(u) {
      Sentry.setUser(u ? { id: u.id, companyId: u.companyId } : null);
    },
  };
}
