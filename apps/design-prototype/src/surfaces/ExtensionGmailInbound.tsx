import * as React from 'react';
import { motion } from 'motion/react';
import { 
  ShieldCheck, 
  ExternalLink, 
  MoreVertical, 
  Reply, 
  Trash2, 
  Archive,
  Star,
  Printer,
  ChevronDown,
  Info,
  AlertCircle,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';
import { cn } from '../lib/tokens';
import { VerifyBadge } from '../components/ProofComponents';

const GmailInboundVerifyBadge: React.FC<{
  state: 'verified' | 'bilateral' | 'unverified' | 'tampered';
  onDetailsClick?: () => void;
}> = ({ state, onDetailsClick }) => {
  const configs = {
    verified: { icon: ShieldCheck, text: 'Verified', color: 'text-proof-green-600', bg: 'bg-proof-green-600/5', border: 'border-proof-green-600/10' },
    bilateral: { icon: ShieldCheck, text: 'Bilateral Signatures', color: 'text-proof-emerald-600', bg: 'bg-proof-emerald-500/5', border: 'border-proof-emerald-500/10' },
    unverified: { icon: Info, text: 'Unverified sender', color: 'text-gray-400', bg: 'bg-gray-100', border: 'border-transparent' },
    tampered: { icon: AlertCircle, text: 'TAMPERED PAYLOAD', color: 'text-proof-red-600', bg: 'bg-proof-red-600/5', border: 'border-proof-red-600/20' }
  };

  const config = configs[state];
  const Icon = config.icon;

  return (
    <div className={cn(
      "inline-flex items-center gap-2.5 pl-2.5 pr-1.5 py-1 rounded-lg border text-xs font-bold transition-all",
      config.bg,
      config.border,
      config.color
    )}>
       <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
       <span>{config.text}</span>
       {state === 'bilateral' && <span className="opacity-50 font-medium tracking-tight">· 2 signers</span>}
       <button 
         onClick={onDetailsClick}
         className="ml-1 px-2 py-0.5 rounded bg-white border border-gray-100 text-[10px] text-gray-500 hover:text-navy-900 transition-colors shadow-sm font-bold flex items-center gap-1 uppercase"
       >
          Details <ArrowRight className="w-3 h-3" />
       </button>
    </div>
  );
};

const GmailMessageChrome: React.FC<{
  state: 'verified' | 'bilateral' | 'unverified' | 'tampered';
  sender: string;
  senderEmail: string;
  subject: string;
  body: React.ReactNode;
}> = ({ state, sender, senderEmail, subject, body }) => {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden w-full max-w-4xl mx-auto font-sans">
      {/* Extension Injection Area */}
      <div className="px-6 py-3 border-b border-gray-50 flex items-center justify-between">
         <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
               <div className="w-5 h-5 rounded bg-gray-900 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 bg-white rotate-45" />
               </div>
               <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">ProofLine Protection Active</span>
            </div>
            <GmailInboundVerifyBadge state={state} />
         </div>
         <div className="flex items-center gap-4 text-gray-400">
            <Printer className="w-4 h-4 cursor-pointer hover:text-gray-900" />
            <ExternalLink className="w-4 h-4 cursor-pointer hover:text-gray-900" />
         </div>
      </div>

      <div className="p-8">
         <h1 className="text-xl font-medium text-gray-900 mb-8">{subject}</h1>
         <div className="flex items-start justify-between mb-8">
            <div className="flex gap-3">
               <div className="w-10 h-10 rounded-full bg-navy-900 flex items-center justify-center text-white text-sm font-bold">
                  {sender.charAt(0)}
               </div>
               <div>
                  <div className="flex items-center gap-2 mb-0.5">
                     <span className="text-sm font-bold text-gray-900">{sender}</span>
                     <span className="text-xs text-gray-400 font-medium">‹{senderEmail}›</span>
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-1.5 focus:outline-none cursor-pointer">
                     to me <ChevronDown className="w-3 h-3" />
                  </div>
               </div>
            </div>
            <div className="flex items-center gap-4 text-gray-400">
               <span className="text-xs font-medium">May 10, 2026, 12:04 PM</span>
               <div className="flex items-center gap-1">
                  <Star className="w-4 h-4" />
                  <Reply className="w-4 h-4" />
                  <MoreVertical className="w-4 h-4" />
               </div>
            </div>
         </div>

         <div className="relative">
            {/* Inline Banner Injected by Sender */}
            <div className={cn(
              "mb-6 rounded-lg border-l-4 p-3 flex items-center justify-between transition-all shadow-sm",
              state === 'verified' ? "bg-proof-green-600/5 border-proof-green-600" :
              state === 'bilateral' ? "bg-proof-emerald-500/5 border-proof-emerald-500" :
              state === 'tampered' ? "bg-proof-red-600/5 border-proof-red-600 animate-pulse" :
              "bg-gray-100 border-gray-300"
            )}>
               <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-1.5 rounded flex-shrink-0",
                    state === 'verified' ? "bg-proof-green-600 text-white" :
                    state === 'bilateral' ? "bg-proof-emerald-500 text-white" :
                    state === 'tampered' ? "bg-proof-red-600 text-white" :
                    "bg-gray-400 text-white"
                  )}>
                     {state === 'tampered' ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  </div>
                  <div className="flex flex-col">
                     <div className={cn(
                       "text-[10px] font-bold uppercase tracking-widest",
                       state === 'verified' ? "text-proof-green-600" :
                       state === 'bilateral' ? "text-proof-emerald-600" :
                       state === 'tampered' ? "text-proof-red-600" :
                       "text-gray-500"
                     )}>
                        {state === 'tampered' ? "Warning: Tamper Detected" : "Verified by ProofLine · Acme Title"}
                     </div>
                     <div className="text-xs font-semibold text-gray-900 leading-none mt-0.5">
                       {state === 'verified' ? "Signed by Sarah Chen · 4 min ago" :
                        state === 'bilateral' ? "Signed by Sarah Chen · Mark Lim · 12 min ago" :
                        state === 'tampered' ? "Payload does not match signature" :
                        "Unsigned content"}
                     </div>
                  </div>
               </div>
               <button className="text-[11px] font-bold text-proof-blue-600 hover:underline px-2">Verify ↗</button>
            </div>

            <div className="text-sm text-gray-900 leading-relaxed space-y-4 font-serif">
               {body}
            </div>
         </div>
      </div>
    </div>
  );
};

export const ExtensionGmailInbound: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-6 selection:bg-[#c2e7ff]">
      <div className="max-w-4xl mx-auto space-y-4 mb-20 text-center">
         <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Inbound Perspective · Gmail Extension</div>
         <h2 className="text-3xl font-serif text-gray-900">Email Verification In-Situ</h2>
         <p className="text-sm text-gray-500 italic max-w-lg mx-auto">The extension injects a badge at the header LEVEL, while the sender's HTML embed provides the inline verification banner. Both must sync to the same hash.</p>
      </div>

      <div className="space-y-32">
         {/* State: Verified */}
         <div className="space-y-6">
            <div className="flex items-center justify-center gap-4 text-xs font-bold text-gray-400 uppercase tracking-widest">
               <div className="h-px w-20 bg-gray-200" /> State A: Standard Verified <div className="h-px w-20 bg-gray-200" />
            </div>
            <GmailMessageChrome 
              state="verified"
              sender="Sarah Chen"
              senderEmail="sarah@acme-title.com"
              subject="Q3 Infrastructure Invoice · INV-9021"
              body={(
                <>
                  <p>Hi Mark,</p>
                  <p>As discussed, here are the updated wire instructions for the Q3 infrastructure payment. This instruction is signed via my hardware security key to prevent business email compromise (BEC).</p>
                  <div className="p-6 rounded-xl border border-gray-100 bg-gray-50/50 flex flex-col items-center gap-2">
                     <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Instruction Payload</span>
                     <div className="text-xl font-serif text-gray-900 tracking-tight">$400,000.00 USD</div>
                     <div className="text-xs text-gray-500 font-medium">First National Bank · ••••5678</div>
                  </div>
                  <p>Regards,<br />Sarah</p>
                </>
              )}
            />
         </div>

         {/* State: Bilateral */}
         <div className="space-y-6">
            <div className="flex items-center justify-center gap-4 text-xs font-bold text-gray-400 uppercase tracking-widest">
               <div className="h-px w-20 bg-gray-200" /> State B: Bilateral Signature <div className="h-px w-20 bg-gray-200" />
            </div>
            <GmailMessageChrome 
              state="bilateral"
              sender="Mark Lim"
              senderEmail="mark@scotiabank-vendor.com"
              subject="Re: Q3 Infrastructure Invoice · INV-9021"
              body={(
                <>
                  <p>Sarah,</p>
                  <p>I have reviewed and counter-signed the instructions on my end via ProofLine. Both our signatures are now registered. Ready for disbursement.</p>
                  <div className="flex items-center justify-center gap-2">
                     <div className="w-8 h-8 rounded-full border-2 border-proof-emerald-500 bg-proof-emerald-500/10 flex items-center justify-center text-proof-emerald-600">
                        <ShieldCheck className="w-4 h-4" />
                     </div>
                     <div className="h-px w-8 bg-proof-emerald-200" />
                     <div className="w-8 h-8 rounded-full border-2 border-proof-emerald-500 bg-proof-emerald-500/10 flex items-center justify-center text-proof-emerald-600">
                        <ShieldCheck className="w-4 h-4" />
                     </div>
                  </div>
                  <p>Best,<br />Mark</p>
                </>
              )}
            />
         </div>

         {/* State: Tampered */}
         <div className="space-y-6">
            <div className="flex items-center justify-center gap-4 text-xs font-bold text-gray-400 uppercase tracking-widest">
               <div className="h-px w-20 bg-gray-200" /> State C: Tampered Payload <div className="h-px w-20 bg-gray-200" />
            </div>
            <GmailMessageChrome 
              state="tampered"
              sender="Sarah Chen"
              senderEmail="sarah@acme-title.com"
              subject="CRITICAL: Transaction Amendment"
              body={(
                <>
                  <p>Wait, we had a change in the routing details at the last minute. Please use these instead:</p>
                  <div className="p-6 rounded-xl border border-proof-red-600 bg-proof-red-600/5 flex flex-col items-center gap-2">
                     <span className="text-[10px] font-bold text-proof-red-600 uppercase tracking-widest">Instruction Payload</span>
                     <div className="text-xl font-serif text-gray-900 tracking-tight">$400,000.00 USD</div>
                     <div className="text-xs text-proof-red-600 font-bold bg-proof-red-600 text-white px-2 py-0.5 rounded">TAMPERED: BANK INFO CHANGED</div>
                     <div className="text-xs text-gray-500 font-medium line-through">First National Bank · ••••5678</div>
                     <div className="text-xs text-navy-900 font-bold font-mono">Offshore Tech Bank · ••••9999</div>
                  </div>
                  <p className="opacity-40 italic">Sent from my iPhone</p>
                </>
              )}
            />
         </div>
      </div>
    </div>
  );
};
