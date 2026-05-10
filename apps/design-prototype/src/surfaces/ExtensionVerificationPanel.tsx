import * as React from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  ShieldCheck, 
  ExternalLink, 
  Clock, 
  Users, 
  FileText, 
  FileCode,
  History as HistoryIcon,
  ArrowRight,
  ShieldAlert,
  ChevronRight,
  Fingerprint,
  Smartphone,
  Info
} from 'lucide-react';
import { 
  WirePayloadCard, 
  SignerChip, 
  AnchorReceipt, 
  VerifyBadge,
  PayloadHashCaption
} from '../components/ProofComponents';
import { cn } from '../lib/tokens';

const GenericPanel: React.FC<{
  host: 'gmail' | 'outlook';
  title?: string;
}> = ({ host, title = "Verification Details" }) => {
  return (
    <div className={cn(
      "w-[360px] h-full bg-white flex flex-col shadow-2xl border-l border-gray-100",
      host === 'outlook' ? "font-sans" : "font-sans"
    )}>
      {/* Panel Header */}
      <div className={cn(
        "px-5 py-4 flex items-center justify-between border-b border-gray-100",
        host === 'outlook' ? "bg-white" : "bg-gray-50"
      )}>
         <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-gray-900 flex items-center justify-center">
               <div className="w-3 h-3 bg-white rotate-45" />
            </div>
            <span className={cn(
              "text-xs font-bold uppercase tracking-widest",
              host === 'outlook' ? "text-[#0078d4]" : "text-navy-900"
            )}>{title}</span>
         </div>
         <X className="w-4 h-4 text-gray-400 hover:text-gray-900 cursor-pointer" />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
         {/* Status Badge */}
         <div className="flex flex-col gap-2">
            <VerifyBadge state="bilateral" className="w-fit" />
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest pl-1">ID: SEQ_4182_94</p>
         </div>

         {/* Payload Summary */}
         <div className="space-y-3">
            <h3 className="text-xs font-bold text-gray-900 flex items-center gap-2">
               <FileText className="w-4 h-4 text-gray-400" /> Instructional Payload
            </h3>
            <div className="scale-90 origin-top -mt-2 -mb-8">
               <WirePayloadCard 
                 amount={400000}
                 recipient="First National Bank"
                 account="••••5678"
                 routing="201029182"
                 purpose="Closing 123 Main St · escrow #82194"
               />
            </div>
            <PayloadHashCaption hash="4a8b...2e91" />
         </div>

         {/* Signers */}
         <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-900 flex items-center gap-2">
               <Users className="w-4 h-4 text-gray-400" /> Authorized Signers
            </h3>
            <div className="space-y-2">
               <SignerChip 
                 name="Sarah Chen"
                 role="Issuer (Acme Title)"
                 deviceId="Sarah's MacBook · Touch ID"
                 verified={true}
               />
               <SignerChip 
                 name="Mark Lim"
                 role="Counterparty (Verifier)"
                 deviceId="Mark's iPhone · Face ID"
                 verified={true}
               />
            </div>
         </div>

         {/* Anchor Receipt */}
         <div className="space-y-3">
            <h3 className="text-xs font-bold text-gray-900 flex items-center gap-2">
               <ShieldCheck className="w-4 h-4 text-gray-400" /> Cryptographic Proof
            </h3>
            <AnchorReceipt 
               network="Base Sepolia"
               block="12,345,678"
               txHash="0xab8e...e6d5"
            />
         </div>

         {/* Audit Actions */}
         <div className="space-y-2 pt-4">
            <button className="w-full flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-all group">
               <div className="flex items-center gap-3">
                  <div className="p-1.5 bg-gray-100 rounded text-gray-500">
                     <FileCode className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold text-gray-900">View raw signature JSON</span>
               </div>
               <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-900" />
            </button>
            <button className="w-full flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-all group">
               <div className="flex items-center gap-3">
                  <div className="p-1.5 bg-gray-100 rounded text-gray-500">
                     <HistoryIcon className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold text-gray-900">Full audit trail</span>
               </div>
               <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-900" />
            </button>
         </div>
      </div>

      {/* Footer Footer */}
      <div className="p-5 border-t border-gray-100 bg-gray-50">
         <button className="w-full py-3 bg-navy-900 text-white rounded-xl font-bold text-sm hover:bg-navy-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-navy-900/10">
            Open Web Verification <ExternalLink className="w-3.5 h-3.5" />
         </button>
         <div className="mt-4 flex flex-col items-center gap-1 opacity-40">
            <div className="text-[9px] font-bold uppercase tracking-widest text-navy-900">Secured via Passkeys</div>
            <div className="flex items-center gap-2">
               <Fingerprint className="w-3 h-3" />
               <Smartphone className="w-3 h-3" />
               <ShieldCheck className="w-3 h-3" />
            </div>
         </div>
      </div>
    </div>
  );
};

export const ExtensionVerificationPanel: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-12 gap-20 overflow-x-auto selection:bg-navy-700 selection:text-white">
      <div className="flex flex-col items-center gap-6">
         <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Variant A: Gmail Sidebar</div>
         <div className="h-[720px] shadow-2xl rounded-sm overflow-hidden">
            <GenericPanel host="gmail" title="ProofLine Details" />
         </div>
      </div>

      <div className="flex flex-col items-center gap-6">
         <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-[#0078d4]">Variant B: Outlook Task Pane</div>
         <div className="h-[720px] shadow-2xl rounded-sm overflow-hidden border border-gray-200">
            <GenericPanel host="outlook" title="ProofLine Verification" />
         </div>
      </div>
      
      <div className="max-w-xs space-y-6">
         <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
               <Info className="w-4 h-4 text-proof-blue-600" /> Detail Density
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed italic">
               Verification panels must provide the "Trust but Verify" evidence—canonical hashes, signer device IDs, and direct links to the cryptographic anchor on the ledger.
            </p>
         </div>
         <div className="p-6 bg-navy-900 text-white rounded-2xl shadow-xl">
            <p className="text-xs font-medium leading-relaxed">
               Users clicking "Details" from an inbound email expect the same level of confidence as a physical document inspection.
            </p>
         </div>
      </div>
    </div>
  );
};
