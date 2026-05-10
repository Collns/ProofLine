import * as React from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, X, Mail, User, Lock } from 'lucide-react';
import { 
  BiometricPrompt, 
  PayloadHashCaption
} from '../components/ProofComponents';
import { cn } from '../lib/tokens';

type SignState = 'idle' | 'pending' | 'success';

export const PopupSessionStart: React.FC<{ 
  onCancel?: () => void;
  onSuccess?: () => void;
}> = ({ onCancel, onSuccess }) => {
  const [state, setState] = React.useState<SignState>('idle');
  const [variant, setVariant] = React.useState<'mac' | 'windows' | 'ios' | 'android' | 'cross-device'>('mac');

  const handleSign = () => {
    setState('pending');
    setTimeout(() => {
      setState('success');
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 1200);
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center overflow-y-auto selection:bg-proof-blue-500 selection:text-white">
      {/* Simulation of a popup window container */}
      <div className="w-full max-w-[480px] min-h-[640px] bg-white flex flex-col border-x border-gray-100 shadow-2xl my-auto">
        {/* Top Nav */}
        <div className="w-full px-6 py-4 flex items-center justify-between border-b border-gray-50 bg-[#f8f9fa]">
           <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-gray-900 flex items-center justify-center">
                <div className="w-3 h-3 bg-white rotate-45" />
              </div>
              <span className="text-sm font-bold tracking-tight">ProofLine</span>
           </div>
           <div className="flex flex-col items-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Pop-up Action</span>
              <span className="text-xs font-semibold text-gray-900">Start signing session</span>
           </div>
           <button 
             onClick={onCancel}
             className="p-1 hover:bg-gray-200 rounded-full transition-colors text-gray-400 hover:text-gray-900"
           >
             <X className="w-4 h-4" />
           </button>
        </div>

        <main className="flex-1 px-8 py-10 flex flex-col items-center">
           {/* Recipient Block */}
           <div className="w-full text-center space-y-4 mb-10">
              <div className="relative inline-block">
                 <div className="w-16 h-16 rounded-full bg-gray-900 flex items-center justify-center text-white text-xl font-bold mx-auto ring-4 ring-white shadow-xl">
                    ML
                 </div>
                 <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-proof-green-600 border-2 border-white flex items-center justify-center">
                    <ShieldCheck className="w-3.5 h-3.5 text-white" />
                 </div>
              </div>
              <div>
                 <h2 className="text-xl font-serif text-gray-900">Mark Lim</h2>
                 <p className="text-xs text-gray-500 font-mono mt-0.5">mark@scotiabank-vendor.com</p>
                 <div className="mt-2 flex items-center justify-center gap-1.5 text-proof-green-600 text-[10px] font-bold uppercase tracking-wider">
                    <ShieldCheck className="w-3 h-3" />
                    Verified Counterparty
                 </div>
              </div>
           </div>

           {/* Email Preview */}
           <div className="w-full p-5 rounded-xl border border-gray-100 bg-gray-50/50 mb-8 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-2">
                 <Mail className="w-3.5 h-3.5" /> Context Preview
              </div>
              <div className="space-y-1">
                 <div className="text-sm font-semibold text-gray-900">RE: Q3 Infrastructure Invoice · INV-9021</div>
                 <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                    Hi Mark, attached is the revised invoice with the corrected routing number for the First National account...
                 </p>
              </div>
           </div>

           {/* Session Terms */}
           <div className="w-full p-4 rounded-xl bg-navy-50 border border-navy-100 mb-10 flex items-start gap-3">
              <Lock className="w-4 h-4 text-navy-900 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-navy-900 font-medium leading-relaxed">
                 This session lasts 15 minutes for emails to <span className="font-bold">Mark only</span>. Different recipient = new session.
              </p>
           </div>

           {/* Biometric Trigger */}
           <div className="w-full mt-auto">
             <BiometricPrompt 
                isOpen={true} 
                onComplete={handleSign} 
                variant={variant}
                state={state}
             />
           </div>

           {/* Platform Switcher (For Demo Only) */}
           <div className="mt-8 flex flex-wrap justify-center gap-2">
              {(['mac', 'windows', 'ios', 'android', 'cross-device'] as const).map(v => (
                <button 
                  key={v}
                  onClick={() => setVariant(v)}
                  className={cn(
                    "px-2 py-1 rounded-full text-[9px] font-bold uppercase transition-all",
                    variant === v ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                  )}
                >
                  {v}
                </button>
              ))}
           </div>
        </main>

        <footer className="px-8 py-6 bg-gray-50 border-t border-gray-100 mt-auto">
           <p className="text-center text-[10px] text-gray-400 font-medium leading-relaxed italic">
              Your device will refuse if any byte changed since you reviewed. 
              The private key never leaves your local Secure Enclave.
           </p>
        </footer>
      </div>
    </div>
  );
};
