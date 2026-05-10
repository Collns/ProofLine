import { describe, it, expect, beforeEach } from 'vitest';
import { makeStubEmailProvider, type StubEmailProvider } from '../providers/stub.js';

describe('makeStubEmailProvider — send', () => {
  it('captures a basic send call', async () => {
    const p = makeStubEmailProvider();
    const result = await p.send({
      to: ['alice@example.com'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    expect(result.id).toMatch(/^stub_email_/);
    expect(p.getCaptured()).toHaveLength(1);
    expect(p.getLast()?.subject).toBe('Hello');
  });

  it('preserves tags and replyTo on send', async () => {
    const p = makeStubEmailProvider();
    await p.send({
      to: ['alice@example.com'],
      subject: 'Tagged',
      html: '<p>Hi</p>',
      text: 'Hi',
      tags: { campaign: 'launch', tier: 'free' },
      replyTo: 'support@example.com',
    });
    const last = p.getLast();
    expect(last?.tags).toEqual({ campaign: 'launch', tier: 'free' });
    expect(last?.replyTo).toBe('support@example.com');
  });

  it('captures multiple sends in order', async () => {
    const p = makeStubEmailProvider();
    await p.send({ to: ['a@x.com'], subject: 'first', html: '', text: '' });
    await p.send({ to: ['b@x.com'], subject: 'second', html: '', text: '' });
    await p.send({ to: ['c@x.com'], subject: 'third', html: '', text: '' });
    const captured = p.getCaptured();
    expect(captured).toHaveLength(3);
    expect(captured.map(c => c.subject)).toEqual(['first', 'second', 'third']);
  });
});

describe('makeStubEmailProvider — sendVerificationCode', () => {
  let p: StubEmailProvider;
  beforeEach(() => { p = makeStubEmailProvider(); });

  it('captures verification code with code in meta', async () => {
    await p.sendVerificationCode('alice@example.com', '123456');
    const last = p.getLast();
    expect(last?.type).toBe('verification_code');
    expect(last?.to).toEqual(['alice@example.com']);
    expect(last?.meta).toEqual({ code: '123456' });
  });

  it('uses correct subject template', async () => {
    await p.sendVerificationCode('alice@example.com', '987654');
    expect(p.getLast()?.subject).toBe('Your ProofLine verification code');
  });
});

describe('makeStubEmailProvider — sendCosignRequest', () => {
  let p: StubEmailProvider;
  beforeEach(() => { p = makeStubEmailProvider(); });

  it('formats subject with amount in dollars', async () => {
    await p.sendCosignRequest(
      ['ceo@acme.com'],
      { amount: 125000, recipientAccountLast4: '4242', routingNumber: '021000021' },
      'https://app.proofline.web.app/sign/abc',
    );
    expect(p.getLast()?.subject).toBe('Co-sign request: $1250.00');
  });

  it('captures wire and signLink in meta', async () => {
    const wire = {
      amount: 50000,
      recipientAccountLast4: '1111',
      routingNumber: '011000015',
      memo: 'Q2 vendor payment',
    };
    const signLink = 'https://app.proofline.web.app/sign/xyz';
    await p.sendCosignRequest(['ceo@acme.com'], wire, signLink);
    expect(p.getLast()?.meta).toEqual({ wire, signLink });
  });

  it('sends to all approver addresses', async () => {
    await p.sendCosignRequest(
      ['ceo@acme.com', 'cfo@acme.com', 'controller@acme.com'],
      { amount: 100, recipientAccountLast4: '0001', routingNumber: '021000021' },
      'https://app.proofline.web.app/sign/multi',
    );
    expect(p.getLast()?.to).toEqual([
      'ceo@acme.com',
      'cfo@acme.com',
      'controller@acme.com',
    ]);
  });
});

describe('makeStubEmailProvider — sendInvitation', () => {
  let p: StubEmailProvider;
  beforeEach(() => { p = makeStubEmailProvider(); });

  it('uses inviter company name in subject', async () => {
    await p.sendInvitation('alice@vendor.com', 'Acme Title', 'tok_abc123');
    expect(p.getLast()?.subject).toBe('Acme Title invites you to ProofLine');
  });

  it('captures inviteToken in meta', async () => {
    await p.sendInvitation('alice@vendor.com', 'Acme Title', 'tok_abc123');
    expect(p.getLast()?.meta).toEqual({
      inviterCompany: 'Acme Title',
      inviteToken: 'tok_abc123',
    });
  });
});

describe('makeStubEmailProvider — sendBilateralRequest', () => {
  let p: StubEmailProvider;
  beforeEach(() => { p = makeStubEmailProvider(); });

  it('uses document type in subject', async () => {
    await p.sendBilateralRequest(
      'counterparty@vendor.com',
      {
        documentId: 'doc_1',
        documentType: 'NDA',
        drafterName: 'Alice Chen',
        drafterCompany: 'Acme Title',
      },
      'https://app.proofline.web.app/sign/doc1',
    );
    expect(p.getLast()?.subject).toBe('Bilateral document: NDA');
  });

  it('captures full doc summary and signLink in meta', async () => {
    const doc = {
      documentId: 'doc_42',
      documentType: 'MSA',
      drafterName: 'Bob Martinez',
      drafterCompany: 'Acme Title',
    };
    const signLink = 'https://app.proofline.web.app/sign/doc42';
    await p.sendBilateralRequest('counterparty@vendor.com', doc, signLink);
    expect(p.getLast()?.meta).toEqual({ doc, signLink });
  });
});

describe('makeStubEmailProvider — utility methods', () => {
  it('clearCaptured() empties the buffer', async () => {
    const p = makeStubEmailProvider();
    await p.send({ to: ['a@x.com'], subject: 's', html: '', text: '' });
    await p.send({ to: ['b@x.com'], subject: 's', html: '', text: '' });
    expect(p.getCaptured()).toHaveLength(2);
    p.clearCaptured();
    expect(p.getCaptured()).toHaveLength(0);
    expect(p.getLast()).toBeNull();
  });

  it('getLast() returns null when nothing captured', () => {
    const p = makeStubEmailProvider();
    expect(p.getLast()).toBeNull();
  });

  it('getCaptured() reflects buffer state across sends', async () => {
    const p = makeStubEmailProvider();
    expect(p.getCaptured()).toHaveLength(0);
    await p.sendVerificationCode('alice@example.com', '111111');
    expect(p.getCaptured()).toHaveLength(1);
    expect(p.getCaptured()[0].type).toBe('verification_code');
  });

  it('uses injected now() for capturedAt', async () => {
    let t = 1_700_000_000_000;
    const p = makeStubEmailProvider({ now: () => t });
    await p.send({ to: ['a@x.com'], subject: 's', html: '', text: '' });
    t = 1_700_000_005_000;
    await p.send({ to: ['b@x.com'], subject: 's', html: '', text: '' });
    const captured = p.getCaptured();
    expect(captured[0].capturedAt).toBe(1_700_000_000_000);
    expect(captured[1].capturedAt).toBe(1_700_000_005_000);
  });
});
