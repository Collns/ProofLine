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
      const block = await publicClient.getBlock({
        blockNumber: receipt.blockNumber,
      });

      return {
        root,
        txHash,
        blockNumber: receipt.blockNumber,
        timestamp: block.timestamp,
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

      const block = await publicClient.getBlock({ blockNumber });
      return { blockNumber, timestamp: block.timestamp };
    },

    verifyProof(leaf: Hex32, proof: MerkleProof, root: Hex32): boolean {
      return verifyMerkleProof(leaf, proof, root);
    },
  };
}
