import * as React from 'react';
import { motion } from 'motion/react';
import { 
  Shield, 
  ShieldX, 
  ShieldAlert, 
  Terminal, 
  Mail, 
  CheckCircle,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { cn } from '../lib/tokens';
import { VerifyBadge } from '../components/ProofComponents';

interface BannerProps {
  state: 'verified' | 'unverified' | 'tampered' | 'bilateral';
}

export const EmailPluginBanner: React.FC<BannerProps> = ({ state }) => {
  const configs = {
    verified: {
      bg: 'bg-proof-green-600/5',
      border: 'border-proof-green-600/20',
      icon: Shield,
      iconColor: 'text-proof-green-600',
      title: 'Verified by ProofLine — Acme Title LLC',
      sub: 'Hardware-signed by Sarah Chen + Bob Rivera · Anchored 2m ago'
    },
    unverified: {
      bg: 'bg-gray-900/5',
      border: 'border-gray-200',
      icon: ShieldAlert,
      iconColor: 'text-gray-400',
      title: 'Sender not on ProofLine — Treat with caution',
      sub: 'No cryptographic signature found. Domain looks similar to a verified one (typosquat?)'
    },
    tampered: {
      bg: 'bg-proof-red-600/5',
      border: 'border-proof-red-600/20',
      icon: ShieldX,
      iconColor: 'text-proof-red-600',
      title: 'TAMPERED INSTRUCTION — Secure Audit Failed',
      sub: 'The payload in this email does not match the signature. Do not send funds.'
    },
    bilateral: {
      bg: 'bg-proof-emerald-400/5',
      border: 'border-proof-emerald-400/20',
      icon: Shield,
      iconColor: 'text-proof-emerald-700',
      title: 'Bilateral Agreement Confirmed',
      sub: 'Signed by Acme Title + First National Bank. Mutually anchored.'
    }
  };

  const config = configs[state];
  const Icon = config.icon;

  return (
    <div className={cn(
      "p-3 rounded-lg border flex items-start gap-4 font-sans max-w-2xl mx-auto my-4",
      config.bg,
      config.border
    )}>
      <div className={cn("p-2 rounded-full bg-white shadow-sm mt-1", config.iconColor)}>
         <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
         <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-gray-900">{config.title}</h4>
            <span className="text-[9px] font-mono text-gray-400 uppercase tracking-tighter">ProofLine v2.4</span>
         </div>
         <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">{config.sub}</p>
         <div className="flex items-center gap-3 mt-2">
            <button className="text-[10px] font-bold text-proof-blue-600 hover:underline">View Integrity Proof</button>
            <span className="w-0.5 h-0.5 rounded-full bg-gray-300" />
            <button className="text-[10px] font-bold text-proof-blue-600 hover:underline">Download Metadata</button>
         </div>
      </div>
    </div>
  );
};

export const TransactionalEmail: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 p-8 flex flex-col items-center">
       <div className="flex items-center gap-4 mb-8 text-gray-400 text-sm font-medium">
          <Mail className="w-4 h-4" />
          <span>Email Context Preview</span>
       </div>

       <div className="w-full max-w-3xl bg-white rounded shadow-sm border border-gray-200 overflow-hidden">
          {/* Email Header */}
          <div className="bg-gray-50 border-b border-gray-100 p-6">
             <div className="flex justify-between items-start mb-6">
                <div>
                   <div className="text-xs text-gray-400 mb-1">From</div>
                   <div className="text-sm font-semibold">Bob Rivera <span className="font-normal text-gray-500">&lt;bob@acme-title.com&gt;</span></div>
                </div>
                <div className="text-right">
                   <div className="text-xs text-gray-400 mb-1">Date</div>
                   <div className="text-sm">May 9, 2026 · 9:42 PM</div>
                </div>
             </div>
             <div>
                <div className="text-xs text-gray-400 mb-1">Subject</div>
                <h1 className="text-lg font-bold">Co-sign request: $400,000 wire (escrow #82194)</h1>
             </div>
          </div>

          <EmailPluginBanner state="verified" />

          {/* Email Body */}
          <div className="p-10 space-y-8">
             <p className="text-sm text-gray-600 font-sans leading-relaxed">
                Alice, <br/><br/>
                I've drafted the wire instruction for the Main St closing. It requires your second signature before we can anchor it to the ledger. 
                Please review the details below and sign via the ProofLine mobile app or web dashboard.
             </p>

             <div className="p-8 bg-gray-50 rounded-xl border border-gray-100 border-dashed space-y-6">
                <div className="flex items-center justify-between">
                   <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Signed Instruction Payload</div>
                   <VerifyBadge state="pending" />
                </div>
                
                <div className="grid grid-cols-2 gap-8">
                   <div>
                      <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Amount</div>
                      <div className="text-2xl font-serif">$400,000.00 USD</div>
                   </div>
                   <div>
                      <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Account</div>
                      <div className="text-sm font-mono tracking-tighter">First National · ••••5678</div>
                   </div>
                </div>

                <div className="pt-4 border-t border-gray-200">
                   <button className="w-full py-4 bg-gray-900 text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-gray-800 transition-all">
                      Co-sign Transfer <ExternalLink className="w-4 h-4" />
                   </button>
                   <p className="text-[10px] text-gray-500 text-center mt-3 font-medium">
                      Authored by Bob Rivera · Hardware Encrypted
                   </p>
                </div>
             </div>

             <div className="flex items-center gap-4 text-xs font-medium text-gray-400 py-8 border-t border-gray-100">
                <Shield className="w-4 h-4" />
                <span>Protected by ProofLine End-to-End Cryptography</span>
             </div>
          </div>
       </div>

       {/* Variants */}
       <div className="mt-12 space-y-4 w-full max-w-2xl">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center">Security State Variants</h3>
          <EmailPluginBanner state="unverified" />
          <EmailPluginBanner state="tampered" />
          <EmailPluginBanner state="bilateral" />
       </div>
    </div>
  );
};
