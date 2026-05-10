import * as React from 'react';
import { 
  ShieldCheck, 
  UserCheck, 
  Clock, 
  ExternalLink, 
  ShieldAlert,
  ChevronRight,
  Info
} from 'lucide-react';
import { cn } from '../lib/tokens';

export const EmailGmailAddon: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#f6f8fc] flex justify-center p-12 overflow-y-auto">
      <div className="w-full max-w-[1200px] flex gap-4">
         {/* Main Content Area Placeholder */}
         <div className="flex-1 bg-white rounded-3xl p-12 shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center opacity-20">
            <div className="text-4xl font-serif text-gray-300">Gmail Message Area</div>
            <p className="text-gray-400 mt-4 max-w-md italic">The main message would be here. The ProofLine Workspace Add-on renders in the sidebar on the right.</p>
         </div>

         {/* Sidebar Add-on */}
         <div className="w-[360px] bg-white border border-gray-100 shadow-xl rounded-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-50 bg-[#f8f9fa] flex items-center justify-between">
               <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-navy-900 flex items-center justify-center">
                     <div className="w-4 h-4 bg-white rotate-45" />
                  </div>
                  <span className="font-bold text-gray-900">ProofLine</span>
               </div>
               <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-proof-green-600" />
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
               </div>
            </div>

            {/* Coming Soon Badge */}
            <div className="bg-proof-blue-600 text-white text-[10px] font-bold text-center py-1 uppercase tracking-widest">
               Post-hackathon · Gmail add-on preview
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8">
               <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-proof-green-600/10 flex items-center justify-center text-proof-green-600 mx-auto">
                     <ShieldCheck className="w-10 h-10" />
                  </div>
                  <div>
                     <h2 className="text-xl font-serif text-gray-900">Verified Payload</h2>
                     <p className="text-xs text-gray-500 mt-1">Acme Title LLC · Texas Registry</p>
                  </div>
               </div>

               {/* Verification Result Card */}
               <div className="p-5 rounded-xl border border-gray-100 bg-gray-50/50 space-y-6">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Integrity Check</span>
                    <span className="px-2 py-0.5 rounded bg-proof-green-600 text-white text-[9px] font-bold uppercase tracking-wider">Pass</span>
                  </div>
                  
                  <div className="space-y-4">
                     <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-gray-400 uppercase">Amount</span>
                        <span className="text-lg font-serif">$400,000.00 USD</span>
                     </div>
                     <div className="flex flex-col gap-1 pt-4 border-t border-gray-100">
                        <span className="text-[9px] font-bold text-gray-400 uppercase">Account Number</span>
                        <span className="text-sm font-mono tracking-tighter">••••5678</span>
                     </div>
                  </div>

                  <div className="pt-4 border-t border-gray-100 space-y-3">
                     <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-gray-900 flex items-center justify-center text-white text-[8px] font-bold">SP</div>
                        <div className="flex-1">
                           <div className="text-xs font-semibold">Sarah Chen</div>
                           <div className="text-[9px] text-gray-400">Owner · Sarah's MacBook · Touch ID</div>
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-proof-green-600" />
                     </div>
                     <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-gray-900 flex items-center justify-center text-white text-[8px] font-bold">BR</div>
                        <div className="flex-1">
                           <div className="text-xs font-semibold">Bob Rivera</div>
                           <div className="text-[9px] text-gray-400">Manager · Bob's YubiKey 5C</div>
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-proof-green-600" />
                     </div>
                  </div>
               </div>

               <div className="space-y-3">
                  <button className="w-full py-4 bg-gray-900 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-gray-800 transition-all">
                     Verify on Registry Web <ExternalLink className="w-4 h-4 text-white/40" />
                  </button>
                  <button className="w-full py-4 bg-white border border-gray-200 text-gray-600 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-gray-50 transition-all">
                     Audit Anchor History
                  </button>
               </div>

               <div className="pt-8 border-t border-gray-50 flex items-start gap-3">
                  <Info className="w-4 h-4 text-gray-300 mt-0.5" />
                  <p className="text-[10px] text-gray-400 leading-relaxed italic">
                     This sidebar re-scans the email body every 30 seconds to ensure the signature hasn't been detached or spoofed by mid-stream proxying.
                  </p>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

const CheckCircle2 = ({ className }: { className?: string }) => (
  <div className={cn("w-4 h-4 rounded-full bg-current flex items-center justify-center", className)}>
    <ShieldCheck className="w-3 h-3 text-white" strokeWidth={3} />
  </div>
);
