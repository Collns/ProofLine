import * as React from 'react';
import { 
  ShieldCheck, 
  ExternalLink, 
  MoreVertical, 
  Reply, 
  Trash2, 
  Archive,
  Star as StarIcon,
  Printer,
  ChevronDown,
  Info,
  AlertCircle,
  ShieldAlert,
  ArrowRight,
  MoreHorizontal,
  Flag,
  Share2
} from 'lucide-react';
import { cn } from '../lib/tokens';

const OutlookInboundBadge: React.FC<{
  state: 'verified' | 'bilateral' | 'unverified' | 'tampered';
}> = ({ state }) => {
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
      "inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border text-[11px] font-bold transition-all shadow-sm",
      config.bg,
      config.border,
      config.color
    )}>
       <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
       <span>{config.text}</span>
       <button className="ml-2 pl-2 border-l border-current/20 font-bold hover:underline flex items-center gap-1 uppercase">
          Open details <ExternalLink className="w-2.5 h-2.5" />
       </button>
    </div>
  );
};

const OutlookReadingPaneChrome: React.FC<{
  state: 'verified' | 'bilateral' | 'unverified' | 'tampered';
  sender: string;
  senderEmail: string;
  subject: string;
  body: React.ReactNode;
}> = ({ state, sender, senderEmail, subject, body }) => {
  return (
    <div className="bg-white rounded-md border border-gray-200 shadow-xl overflow-hidden w-full max-w-5xl mx-auto font-sans flex flex-col h-[720px]">
      {/* Outlook Task Pane Integration */}
      <div className="h-10 bg-[#f3f2f1] border-b border-gray-200 px-4 flex items-center justify-between">
         <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded bg-gray-900 flex items-center justify-center">
               <div className="w-2.5 h-2.5 bg-white rotate-45" />
            </div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Extension Injection</span>
            <div className="h-4 w-px bg-gray-300 mx-1" />
            <OutlookInboundBadge state={state} />
         </div>
         <div className="flex items-center gap-2">
            <X className="w-4 h-4 text-gray-500 hover:text-gray-900 cursor-pointer" />
         </div>
      </div>

      <div className="flex-1 flex flex-col overflow-y-auto">
         {/* Outlook Message Controls */}
         <div className="px-6 py-4 flex items-center justify-between border-b border-gray-50 bg-[#faf9f8]">
            <div className="flex items-center gap-4">
               <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded text-xs font-semibold hover:bg-gray-50">
                  <Reply className="w-3.5 h-3.5 text-[#0078d4]" /> Reply
               </button>
               <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded text-xs font-semibold hover:bg-gray-50">
                  <Share2 className="w-3.5 h-3.5 text-[#0078d4]" /> Forward
               </button>
               <div className="h-4 w-px bg-gray-200 mx-1" />
               <button className="p-2 hover:bg-gray-100 rounded text-gray-500"><Archive className="w-4 h-4" /></button>
               <button className="p-2 hover:bg-gray-100 rounded text-gray-500"><Trash2 className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-2 text-gray-400">
               <Flag className="w-4 h-4" />
               <MoreHorizontal className="w-4 h-4" />
            </div>
         </div>

         <div className="p-10 max-w-4xl">
            <h1 className="text-2xl font-bold text-[#0078d4] mb-8">{subject}</h1>
            
            <div className="flex items-center gap-4 mb-10">
               <div className="w-12 h-12 rounded-full bg-[#f3f2f1] flex items-center justify-center text-gray-500 text-lg font-semibold border border-gray-200">
                  {sender.split(' ').map(n => n[0]).join('')}
               </div>
               <div className="flex-1">
                  <div className="flex items-center justify-between">
                     <span className="text-sm font-bold text-gray-900">{sender}</span>
                     <span className="text-xs text-gray-400">Sun 5/10/2026 12:04 PM</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                     To: <span className="text-gray-900">me@contracting-firm.com</span>
                  </div>
               </div>
            </div>

            <div className="relative font-serif text-sm text-gray-800 leading-relaxed space-y-6">
                {/* Inline Banner with Outlook Styling (Fluent influence) */}
                <div className={cn(
                  "p-3 rounded border-l-[6px] shadow-sm flex items-center justify-between transition-all",
                  state === 'verified' ? "bg-proof-green-600/5 border-proof-green-600" :
                  state === 'bilateral' ? "bg-proof-emerald-500/5 border-proof-emerald-500" :
                  state === 'tampered' ? "bg-proof-red-600/5 border-proof-red-600" :
                  "bg-gray-50 border-gray-200"
                )}>
                   <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border",
                        state === 'verified' ? "bg-proof-green-600 text-white border-proof-green-600" :
                        state === 'bilateral' ? "bg-proof-emerald-500 text-white border-proof-emerald-500" :
                        state === 'tampered' ? "bg-proof-red-600 text-white border-proof-red-600" :
                        "bg-gray-200 text-gray-400 border-gray-300"
                      )}>
                         {state === 'tampered' ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      </div>
                      <div className="flex flex-col">
                         <h4 className={cn(
                           "text-[10px] font-bold uppercase tracking-widest leading-none mb-1",
                           state === 'verified' ? "text-proof-green-600" :
                           state === 'bilateral' ? "text-proof-emerald-600" :
                           state === 'tampered' ? "text-proof-red-600" :
                           "text-gray-500"
                         )}>
                            {state === 'tampered' ? "Security Warning: Tamper Alert" : "Verified by ProofLine · Acme Title"}
                         </h4>
                         <div className="text-xs font-semibold text-gray-900 leading-none">
                           {state === 'verified' ? "Signed by Sarah Chen · 4 min ago" :
                            state === 'bilateral' ? "Signed by Sarah Chen · Mark Lim · 12 min ago" :
                            state === 'tampered' ? "Payload does not match signature" :
                            "Unsigned content"}
                         </div>
                      </div>
                   </div>
                   <button className="text-[11px] font-bold text-proof-blue-600 hover:underline px-2">Verify ↗</button>
                </div>

                <div className="space-y-4">
                  {body}
                </div>
            </div>
         </div>
      </div>
    </div>
  );
};

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const X = CloseIcon;

export const ExtensionOutlookInbound: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#faf9f8] py-12 px-6 selection:bg-[#cde6f7]">
      <div className="max-w-4xl mx-auto space-y-4 mb-20 text-center">
         <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Inbound Perspective · Outlook Extension</div>
         <h2 className="text-3xl font-serif text-gray-900">Microsoft Outlook Web Verification</h2>
         <p className="text-sm text-gray-500 italic max-w-lg mx-auto">Outlook's reading pane has a wider, more structured layout. Extension badges inject into the Reading Pane header area.</p>
      </div>

      <div className="space-y-32">
         {/* State: Verified */}
         <div className="space-y-6">
            <div className="flex items-center justify-center gap-4 text-xs font-bold text-gray-400 uppercase tracking-widest">
               <div className="h-px w-20 bg-gray-200" /> State A: Verified <div className="h-px w-20 bg-gray-200" />
            </div>
            <OutlookReadingPaneChrome 
              state="verified"
              sender="Sarah Chen"
              senderEmail="sarah@acme-title.com"
              subject="Payment Amendment for Closing #82194"
              body={(
                <>
                  <p>Hi guys,</p>
                  <p>Sending through the signed payment details for the closing scheduled tomorrow. We're using ProofLine for these now so you can verify the instructions haven't been swapped in transit.</p>
                  <div className="p-6 bg-[#f3f2f1] border border-gray-200 rounded flex flex-col items-center gap-3 max-w-sm mx-auto shadow-sm">
                     <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Wire Instruction Payload</span>
                     <div className="text-2xl font-bold bg-white px-4 py-2 rounded text-navy-900 tracking-tight">$400,000.00 USD</div>
                     <div className="text-xs text-gray-500 font-mono text-center">
                        First National · Acc: ••••5678<br/>
                        RT: 201029182
                     </div>
                  </div>
                  <p>Let me know if you have any questions.</p>
                </>
              )}
            />
         </div>

         {/* State: Tamered */}
         <div className="space-y-6">
            <div className="flex items-center justify-center gap-4 text-xs font-bold text-gray-400 uppercase tracking-widest">
               <div className="h-px w-20 bg-gray-200" /> State B: Tampered Warning <div className="h-px w-20 bg-gray-200" />
            </div>
            <OutlookReadingPaneChrome 
              state="tampered"
              sender="Sarah Chen"
              senderEmail="sarah@acme-title.com"
              subject="URGENT: Change in Payment Details"
              body={(
                <>
                   <p>IGNORE MY PREVIOUS EMAIL. The bank accounts were updated. Use these:</p>
                   <div className="p-6 bg-red-50 border border-proof-red-600 rounded flex flex-col items-center gap-3 max-w-sm mx-auto shadow-lg shadow-proof-red-600/10">
                      <span className="text-[10px] font-bold text-proof-red-600 uppercase tracking-widest">Instruction Payload</span>
                      <div className="text-2xl font-bold bg-white px-4 py-2 rounded text-proof-red-600 tracking-tight">$400,000.00 USD</div>
                      <div className="text-xs text-proof-red-600 font-bold bg-navy-900 text-white px-3 py-1 rounded">
                         TAMPER ALERT: ACCOUNT CHANGED
                      </div>
                      <div className="text-xs text-gray-400 font-mono text-center line-through decoration-proof-red-600">
                        First National · Acc: ••••5678
                      </div>
                      <div className="text-sm text-navy-900 font-bold font-mono">
                        Global Seychelles Bank · Acc: ••••9999
                      </div>
                   </div>
                   <p>Confirm once done.</p>
                </>
              )}
            />
         </div>
      </div>
    </div>
  );
};
