import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Clock, 
  ShieldAlert, 
  CheckCircle2, 
  X, 
  ArrowRight,
  ShieldCheck,
  FileText
} from 'lucide-react';
import { 
  ExpiryCountdown, 
  SignerChip, 
  BiometricPrompt,
  WirePayloadCard,
  PayloadHashCaption
} from '../components/ProofComponents';
import { demoData } from '../lib/demo-data';
import { cn } from '../lib/tokens';

export const PopupCosign: React.FC<{ variant?: 'active' | 'expired' }> = ({ variant = 'active' }) => {
  const [showSign, setShowSign] = React.useState(false);
  const [complete, setComplete] = React.useState(false);

  if (variant === 'expired') {
    return (
      <div className="fixed inset-0 bg-black/5 flex items-center justify-center selection:bg-proof-blue-500">
        <div className="w-[480px] min-h-[640px] bg-white rounded-none border-x border-gray-100 shadow-2xl flex flex-col items-center p-12 text-center my-auto overflow-hidden">
           <div className="w-20 h-20 rounded-full bg-proof-red-600/10 flex items-center justify-center text-proof-red-600 mx-auto mb-10">
              <Clock className="w-10 h-10" />
           </div>
           <div>
              <h1 className="text-2xl font-serif text-gray-900 mb-4">This cosign link expired 8 minutes ago</h1>
              <p className="text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">
                 For security, links expire 30 minutes after Sarah drafts. Tap below to request a fresh one — Sarah will be notified.
              </p>
           </div>
           <button className="w-full py-5 bg-gray-900 text-white rounded-xl font-bold mt-12 hover:bg-gray-800 transition-all active:scale-[0.98] shadow-lg shadow-gray-900/10">
              Request a fresh link
           </button>
           <p className="mt-8 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              The original wire is still pending in the registry.
           </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center selection:bg-proof-blue-500">
      <div className="w-[480px] min-h-[640px] bg-white flex flex-col border-x border-gray-100 shadow-2xl my-auto relative overflow-hidden">
        {/* Header */}
        <div className="w-full px-6 py-4 flex items-center justify-between border-b border-gray-50 bg-[#f8f9fa] z-10">
           <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-gray-900 flex items-center justify-center">
                <div className="w-2.5 h-2.5 bg-white rotate-45" />
              </div>
              <span className="text-xs font-bold tracking-tight">ProofLine</span>
           </div>
           <div className="text-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-0.5">Cosign Action</span>
              <span className="text-xs font-bold text-gray-900">Approve instruction</span>
           </div>
           <button className="p-1 hover:bg-gray-200 rounded-full text-gray-300">
             <X className="w-4 h-4" />
           </button>
        </div>

        <main className="flex-1 overflow-y-auto px-8 py-10 flex flex-col items-center">
           <div className="text-center mb-10">
              <h1 className="text-2xl font-serif text-gray-900 leading-tight mb-2">
                 Sarah Chen needs your <span className="italic">cosign</span>
              </h1>
              <div className="flex items-center justify-center gap-2 text-[10px] uppercase font-bold tracking-wide">
                 <span className="text-gray-400">Expires in</span>
                 <span className="text-proof-red-600 bg-proof-red-600/5 px-2 py-0.5 rounded flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    <ExpiryCountdown expiryMinutes={26} />
                 </span>
              </div>
           </div>

           {/* Security Banner */}
           <div className="w-full p-4 rounded-xl bg-navy-50 border border-navy-100 mb-8 flex items-start gap-3">
              <ShieldAlert className="w-4 h-4 text-navy-900 mt-0.5 shrink-0" />
              <p className="text-[11px] text-navy-900 font-medium leading-relaxed italic">
                 Hash re-verified with registry. Your device will refuse if any bit changed in transit.
              </p>
           </div>

           {/* Payload Card */}
           <div className="w-full space-y-4 mb-10">
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1 flex items-center justify-between">
                 Review Instruction Details
                 <FileText className="w-3 h-3" />
              </h3>
              <div className="scale-90 origin-top -mt-4 -mb-10">
                  <WirePayloadCard 
                    amount={400000}
                    recipient="First National Bank"
                    account="••••5678"
                    routing="201029182"
                    purpose="Closing 123 Main St · escrow #82194"
                  />
              </div>
           </div>

           <PayloadHashCaption hash="4a8b...2e91" />

           {/* Authored By */}
           <div className="w-full mt-12 space-y-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold text-center">Authored By</p>
              <SignerChip 
                 name="Sarah Chen" 
                 role="Employee" 
                deviceId="Sarah's MacBook · Touch ID" 
                 verified={true}
              />
           </div>

           {/* Primary Action */}
           <div className="w-full mt-12 pb-10">
              <button 
                onClick={() => setShowSign(true)}
                className="w-full py-5 bg-navy-900 text-white rounded-2xl font-bold text-lg hover:bg-navy-800 transition-all active:scale-[0.98] shadow-xl shadow-navy-900/10 flex items-center justify-center gap-3"
              >
                Continue to Sign
                <ArrowRight className="w-5 h-5" />
              </button>
           </div>
        </main>

        <footer className="px-8 py-5 bg-gray-50 border-t border-gray-100 flex items-center justify-center">
           <div className="flex items-center gap-2 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
              <ShieldCheck className="w-3.5 h-3.5 text-proof-green-600" />
              Hardened Registry Connection Active
           </div>
        </footer>

        <AnimatePresence>
          {showSign && (
            <div className="absolute inset-0 z-50">
               <BiometricPrompt 
                  isOpen={true} 
                  onComplete={() => {
                    setComplete(true);
                    setTimeout(() => setShowSign(false), 1500);
                  }}
                  variant="mac"
                  state={complete ? 'success' : 'idle'}
               />
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
