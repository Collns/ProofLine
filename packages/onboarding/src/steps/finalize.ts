import {
  ok,
  err,
  type FinalizeResult,
  type OnboardingError,
  type OnboardingStep,
  type Result,
} from '../types.js';
import type { OnboardingDeps } from '../deps.js';
import type { Hex32, TxHash } from '@proofline/anchoring';
import type { RoleCredential } from '@proofline/types';
import { defaultUuid } from '../util.js';

const ALLOWED: OnboardingStep[] = ['finalize_pending'];

function asHex32(hex: string): Hex32 {
  return (hex.startsWith('0x') ? hex : `0x${hex}`) as Hex32;
}

export async function finalizeStep(
  input: {
    onboardingId: string;
    officerWebAuthnPublicKey: string;
    officerCredentialId: string;
  },
  deps: OnboardingDeps,
): Promise<Result<FinalizeResult, OnboardingError>> {
  const ob = await deps.store.get(input.onboardingId);
  if (!ob) return err({ code: 'NOT_FOUND' });

  // Idempotent: if already finalized, return the cached result
  if (
    ob.step === 'finalized' &&
    ob.companyId &&
    ob.rootKeyHandle &&
    ob.rootPublicKey &&
    ob.firstRoleCredentialJson &&
    ob.anchorTxHash &&
    ob.anchorBlock !== undefined &&
    ob.anchorRoot
  ) {
    const firstRoleCredential = JSON.parse(ob.firstRoleCredentialJson) as RoleCredential;
    return ok({
      companyId: ob.companyId,
      rootKeyHandle: ob.rootKeyHandle,
      rootPublicKey: ob.rootPublicKey,
      firstRoleCredential,
      anchorTxHash: ob.anchorTxHash,
      anchorBlock: BigInt(ob.anchorBlock),
    });
  }

  if (!ALLOWED.includes(ob.step)) {
    return err({ code: 'BAD_STATE', expected: ALLOWED, actual: ob.step });
  }

  // 1. Allocate companyId and provision the company root key in KMS
  const companyId = (deps.uuid ?? defaultUuid)();

  let rootKeyHandle;
  let rootPublicKey: string;
  try {
    const kms = await deps.kmsProvisioner.createCompanyRootKey({ companyId });
    rootKeyHandle = kms.handle;
    rootPublicKey = kms.publicKey;
  } catch (e) {
    return err({
      code: 'KMS_FAILED',
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  // 2. Build the first role credential (owner) for the officer's WebAuthn key.
  //    issuerSig is computed by signing the canonicalized credential body
  //    (without issuerSig) with the company root key.
  const userId = (deps.uuid ?? defaultUuid)();
  const issuedAt = deps.now();

  const credentialBody = {
    v: 1 as const,
    credentialId: input.officerCredentialId,
    publicKey: input.officerWebAuthnPublicKey,
    userId,
    companyId,
    role: 'owner' as const,
    perEmailLimitUsd: null,
    dailyLimitUsd: null,
    issuedAt,
    revokedAt: null,
  };

  const canonical = JSON.stringify(credentialBody);
  const messageBytes = new TextEncoder().encode(canonical);
  const issuerSig = await deps.crypto.sign(rootKeyHandle, messageBytes);

  const firstRoleCredential: RoleCredential = {
    ...credentialBody,
    issuerSig,
  };

  // 3. Anchor on Base Sepolia. Build a single-leaf Merkle tree from the
  //    sha256 of the role credential JSON; root === leaf for size-1 trees.
  const credentialJson = JSON.stringify(firstRoleCredential);
  const credentialHash = deps.crypto.hash(new TextEncoder().encode(credentialJson));
  const leaf = asHex32(Buffer.from(credentialHash).toString('hex'));

  let txHash: TxHash;
  let blockNumber: bigint;
  let root: Hex32;
  try {
    const tree = deps.anchor.buildTree([leaf]);
    root = tree.root;
    const receipt = await deps.anchor.postAnchor(root);
    txHash = receipt.txHash;
    blockNumber = receipt.blockNumber;
  } catch (e) {
    return err({
      code: 'ANCHOR_FAILED',
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. Persist final state. Step advances ONLY after anchor succeeds; failure
  //    leaves step at 'finalize_pending' so the caller can retry safely.
  const now = deps.now();
  await deps.store.update(ob.onboardingId, {
    step: 'finalized',
    companyId,
    rootKeyHandle,
    rootPublicKey,
    firstRoleCredentialId: input.officerCredentialId,
    firstRoleCredentialJson: credentialJson,
    anchorTxHash: txHash,
    anchorBlock: blockNumber.toString(),
    anchorRoot: root,
    finalizedAt: now,
    updatedAt: now,
  });

  return ok({
    companyId,
    rootKeyHandle,
    rootPublicKey,
    firstRoleCredential,
    anchorTxHash: txHash,
    anchorBlock: blockNumber,
  });
}
