export type Hex32 = `0x${string}`;  // 32-byte hash, 66 chars total
export type TxHash = `0x${string}`;
export type EthAddress = `0x${string}`;

export interface MerkleProof {
  leaf: Hex32;
  siblings: Hex32[];          // ordered from leaf → root
  pathIndex: bigint;          // bitmask: 0=left, 1=right at each level
}

export interface MerkleTree {
  root: Hex32;
  leaves: Hex32[];
  proofFor(leaf: Hex32): MerkleProof | null;
}

export interface AnchorReceipt {
  root: Hex32;
  txHash: TxHash;
  blockNumber: bigint;
  timestamp: bigint;
}

export interface AnchorProvider {
  /** Build a Merkle tree from a flat list of 32-byte leaves. */
  buildTree(leaves: Hex32[]): MerkleTree;

  /** Submit a Merkle root on-chain. Signs with deployer key. */
  postAnchor(root: Hex32): Promise<AnchorReceipt>;

  /** Read anchor metadata for a known root, or null if not anchored. */
  readAnchor(root: Hex32): Promise<{ blockNumber: bigint; timestamp: bigint } | null>;

  /** Pure verification: does proof correctly link leaf to root? */
  verifyProof(leaf: Hex32, proof: MerkleProof, root: Hex32): boolean;
}
