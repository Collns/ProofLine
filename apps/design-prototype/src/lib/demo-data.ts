export const demoData = {
  customer: {
    name: "Acme Title LLC",
    domain: "acme-title.com",
    location: "TX",
    verifiedAt: "Apr 12 2026",
    networkCoverage: 38
  },
  officers: [
    { id: "1", name: "Alice Park", role: "Owner", limit: null, avatarColor: "bg-blue-500" },
    { id: "2", name: "Bob Rivera", role: "Manager", limit: 1000000, avatarColor: "bg-teal-500" },
    { id: "3", name: "Diane Greer", role: "Manager", limit: 500000, avatarColor: "bg-emerald-500" },
    { id: "4", name: "Sarah Chen", role: "Employee", limit: 50000, avatarColor: "bg-amber-500" }
  ],
  wire: {
    amount: 400000,
    recipient: "First National Bank",
    account: "••••5678",
    routing: "021000021",
    purpose: "Closing 123 Main St · escrow #82194",
    tamperedAccount: "••••9999"
  },
  anchor: {
    network: "Base Sepolia",
    block: "12,345,678",
    txHash: "0xab8e21f9c1d0a5b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7e6d5",
    sequence: "4,182"
  }
};
