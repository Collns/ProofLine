import {
  createPublicClient,
  createWalletClient,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import type {
  AnchorProvider,
  AnchorReceipt,
  Hex32,
  MerkleProof,
  MerkleTree,
} from '../types.js';
import { buildMerkleTree, verifyMerkleProof } from '../merkle.js';

// ABI fragment matching contracts/src/Anchor.sol — only the functions
// we call. Keep this minimal; full ABI is unnecessary.
const ANCHOR_ABI = [
  {
    type: 'function',
    name: 'anchorRoot',
    inputs: [{ name: 'root', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'rootToBlock',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isAnchored',
    inputs: [{ name: 'root', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'latestSequence',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

export interface ViemAnchorConfig {
  rpcUrl: string;
  contractAddress: `0x${string}`;
  deployerPrivateKey: `0x${string}`;
}

export function makeViemBaseSepoliaAnchorProvider(
  config: ViemAnchorConfig,
): AnchorProvider {
  const account = privateKeyToAccount(config.deployerPrivateKey);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  });

  return {
    buildTree(leaves: Hex32[]): MerkleTree {
      return buildMerkleTree(leaves);
    },

    async postAnchor(root: Hex32): Promise<AnchorReceipt> {
      const txHash = await walletClient.writeContract({
        address: config.contractAddress,
        abi: ANCHOR_ABI,
        functionName: 'anchorRoot',
        args: [root],
        chain: baseSepolia,
      });

      // Wait for confirmation — gives us block number
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      // Base Sepolia's RPC sometimes can't serve block details immediately
      // after confirmation. The block NUMBER from the receipt is reliable;
      // only the block-details fetch is flaky — fall back to wall-clock
      // seconds for the timestamp rather than failing the whole anchor.
      let timestamp: bigint;
      try {
        const block = await publicClient.getBlock({
          blockNumber: receipt.blockNumber,
        });
        timestamp = block.timestamp;
      } catch {
        timestamp = BigInt(Math.floor(Date.now() / 1000));
      }

      return {
        root,
        txHash,
        blockNumber: receipt.blockNumber,
        timestamp,
      };
    },

    async readAnchor(root: Hex32) {
      const blockNumber = await publicClient.readContract({
        address: config.contractAddress,
        abi: ANCHOR_ABI,
        functionName: 'rootToBlock',
        args: [root],
      });
      if (blockNumber === 0n) return null;

      // Same flaky-getBlock guard as postAnchor: the on-chain block number
      // is authoritative; fall back to wall-clock if details can't be read.
      let timestamp: bigint;
      try {
        const block = await publicClient.getBlock({ blockNumber });
        timestamp = block.timestamp;
      } catch {
        timestamp = BigInt(Math.floor(Date.now() / 1000));
      }
      return { blockNumber, timestamp };
    },

    verifyProof(leaf: Hex32, proof: MerkleProof, root: Hex32): boolean {
      return verifyMerkleProof(leaf, proof, root);
    },
  };
}
