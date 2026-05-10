const BASE_SEPOLIA_EXPLORER = 'https://sepolia.basescan.org';

export function buildBasescanTxUrl(txHash: string): string {
  return `${BASE_SEPOLIA_EXPLORER}/tx/${txHash}`;
}

export function buildBasescanBlockUrl(blockNumber: string): string {
  return `${BASE_SEPOLIA_EXPLORER}/block/${blockNumber}`;
}
