import { describe, it, expect } from 'vitest';
import {
  makeStubObservabilityProvider,
  type CapturedError,
  type CapturedMessage,
  type CapturedLog,
} from '../providers/stub.js';

describe('makeStubObservabilityProvider', () => {
  it('captureError stores Error + context, retrievable via getCaptured()', () => {
    const p = makeStubObservabilityProvider();
    const err = new Error('boom');
    p.captureError(err, { tags: { area: 'wire' }, fingerprint: ['boom'] });
    const captured = p.getCaptured();
    expect(captured).toHaveLength(1);
    const rec = captured[0] as CapturedError;
    expect(rec.type).toBe('error');
    expect(rec.error).toBe(err);
    expect(rec.context?.tags).toEqual({ area: 'wire' });
    expect(rec.context?.fingerprint).toEqual(['boom']);
  });

  it('captureMessage stores msg + level', () => {
    const p = makeStubObservabilityProvider();
    p.captureMessage('something happened', 'warn');
    const rec = p.getCaptured()[0] as CapturedMessage;
    expect(rec.type).toBe('message');
    expect(rec.msg).toBe('something happened');
    expect(rec.level).toBe('warn');
  });

  it('log stores level + event + data', () => {
    const p = makeStubObservabilityProvider();
    p.log('info', 'wire.signed', { wireId: 'w_1', amount: 100 });
    const rec = p.getCaptured()[0] as CapturedLog;
    expect(rec.type).toBe('log');
    expect(rec.level).toBe('info');
    expect(rec.event).toBe('wire.signed');
    expect(rec.data).toEqual({ wireId: 'w_1', amount: 100 });
  });

  it('multiple captures preserve insertion order', () => {
    const p = makeStubObservabilityProvider();
    p.log('info', 'one');
    p.captureMessage('two', 'info');
    p.captureError(new Error('three'));
    const types = p.getCaptured().map((r) => r.type);
    expect(types).toEqual(['log', 'message', 'error']);
  });

  it('clearCaptured() empties the buffer', () => {
    const p = makeStubObservabilityProvider();
    p.log('info', 'a');
    p.log('info', 'b');
    expect(p.getCaptured()).toHaveLength(2);
    p.clearCaptured();
    expect(p.getCaptured()).toHaveLength(0);
  });

  it('setUser stores, getUser retrieves; null clears', () => {
    const p = makeStubObservabilityProvider();
    expect(p.getUser()).toBeNull();
    p.setUser({ id: 'u_1', companyId: 'co_1' });
    expect(p.getUser()).toEqual({ id: 'u_1', companyId: 'co_1' });
    p.setUser(null);
    expect(p.getUser()).toBeNull();
  });

  it('traceSpan invokes fn with a span and returns its result', async () => {
    const p = makeStubObservabilityProvider();
    const result = await p.traceSpan('op.name', async (span) => {
      expect(typeof span.end).toBe('function');
      span.end();
      return 42;
    });
    expect(result).toBe(42);
  });

  it('uses injected now() for capturedAt', () => {
    let t = 1_700_000_000_000;
    const p = makeStubObservabilityProvider({ now: () => t });
    p.log('info', 'a');
    t = 1_700_000_005_000;
    p.captureMessage('m', 'info');
    const captured = p.getCaptured();
    expect(captured[0].capturedAt).toBe(1_700_000_000_000);
    expect(captured[1].capturedAt).toBe(1_700_000_005_000);
  });
});
