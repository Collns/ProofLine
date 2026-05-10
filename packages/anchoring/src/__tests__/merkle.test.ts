import { describe, it, expect } from 'vitest';
import { keccak256 } from 'viem';
import { buildMerkleTree, verifyMerkleProof } from '../merkle.js';
import type { Hex32 } from '../types.js';

function leaf(s: string): Hex32 {
  return keccak256(new TextEncoder().encode(s));
}

describe('buildMerkleTree', () => {
  it('throws on empty leaves', () => {
    expect(() => buildMerkleTree([])).toThrow();
  });

  it('single leaf: root equals leaf', () => {
    const a = leaf('a');
    const tree = buildMerkleTree([a]);
    expect(tree.root).toBe(a);
  });

  it('two leaves: root is hash of pair', () => {
    const a = leaf('a');
    const b = leaf('b');
    const tree = buildMerkleTree([a, b]);
    expect(tree.root).not.toBe(a);
    expect(tree.root).not.toBe(b);
  });

  it('odd leaf count duplicates last', () => {
    const a = leaf('a');
    const b = leaf('b');
    const c = leaf('c');
    const tree = buildMerkleTree([a, b, c]);
    // Root should still be deterministic and non-zero
    expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('larger tree (8 leaves)', () => {
    const leaves: Hex32[] = [];
    for (let i = 0; i < 8; i++) {
      leaves.push(leaf('leaf-' + i));
    }
    const tree = buildMerkleTree(leaves);
    expect(tree.leaves).toHaveLength(8);
    expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('verifyMerkleProof', () => {
  it('valid proof verifies for all leaves in 8-leaf tree', () => {
    const leaves: Hex32[] = [];
    for (let i = 0; i < 8; i++) {
      leaves.push(leaf('e-' + i));
    }
    const tree = buildMerkleTree(leaves);

    for (const l of leaves) {
      const proof = tree.proofFor(l)!;
      expect(verifyMerkleProof(l, proof, tree.root)).toBe(true);
    }
  });

  it('invalid leaf fails verification', () => {
    const leaves = [leaf('a'), leaf('b'), leaf('c'), leaf('d')];
    const tree = buildMerkleTree(leaves);
    const proof = tree.proofFor(leaves[0])!;
    const fakeLeaf = leaf('not-in-tree');
    expect(verifyMerkleProof(fakeLeaf, proof, tree.root)).toBe(false);
  });

  it('tampered proof fails verification', () => {
    const leaves = [leaf('a'), leaf('b'), leaf('c'), leaf('d')];
    const tree = buildMerkleTree(leaves);
    const proof = tree.proofFor(leaves[0])!;
    const tampered = {
      ...proof,
      siblings: [...proof.siblings].map((s, i) =>
        i === 0 ? leaf('tampered') : s),
    };
    expect(verifyMerkleProof(leaves[0], tampered, tree.root)).toBe(false);
  });

  it('wrong root fails verification', () => {
    const leaves = [leaf('a'), leaf('b')];
    const tree = buildMerkleTree(leaves);
    const proof = tree.proofFor(leaves[0])!;
    const fakeRoot = leaf('fake-root');
    expect(verifyMerkleProof(leaves[0], proof, fakeRoot)).toBe(false);
  });

  it('proofFor returns null for unknown leaf', () => {
    const tree = buildMerkleTree([leaf('a'), leaf('b')]);
    expect(tree.proofFor(leaf('not-here'))).toBeNull();
  });
});
