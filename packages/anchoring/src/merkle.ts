import { keccak256 } from 'viem';
import type { Hex32, MerkleTree, MerkleProof } from './types.js';

export function buildMerkleTree(leaves: Hex32[]): MerkleTree {
  if (leaves.length === 0) {
    throw new Error('Cannot build tree with zero leaves');
  }

  // Layer 0 = leaves. Each subsequent layer = pairwise hashed parents.
  // If a layer has odd length, duplicate last element (standard practice).
  const layers: Hex32[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1];
    const next: Hex32[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : left;
      next.push(hashPair(left, right));
    }
    layers.push(next);
  }

  const root = layers[layers.length - 1][0];

  return {
    root,
    leaves,
    proofFor(leaf: Hex32): MerkleProof | null {
      const idx = leaves.indexOf(leaf);
      if (idx === -1) return null;
      return buildProof(layers, idx);
    },
  };
}

function hashPair(a: Hex32, b: Hex32): Hex32 {
  // Sort pair ascending so verification is order-independent
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const concat = ('0x' + lo.slice(2) + hi.slice(2)) as `0x${string}`;
  return keccak256(concat);
}

function buildProof(layers: Hex32[][], leafIndex: number): MerkleProof {
  const siblings: Hex32[] = [];
  let pathIndex = 0n;
  let idx = leafIndex;

  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level];
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1;
    const sibling = siblingIdx < layer.length ? layer[siblingIdx] : layer[idx];
    siblings.push(sibling);
    if (isRightNode) pathIndex |= (1n << BigInt(level));
    idx = Math.floor(idx / 2);
  }

  return { leaf: layers[0][leafIndex], siblings, pathIndex };
}

export function verifyMerkleProof(leaf: Hex32, proof: MerkleProof, root: Hex32): boolean {
  let current: Hex32 = leaf;
  for (let i = 0; i < proof.siblings.length; i++) {
    const sibling = proof.siblings[i];
    // Same sort-then-concat rule as hashPair
    current = hashPair(current, sibling);
  }
  return current === root;
}
