import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, Fingerprint, Lock, X } from 'lucide-react';
import { BiometricPrompt } from '../components/ProofComponents';
import { cn } from '../lib/tokens';

export const PopupSignSilent: React.FC<{
  onComplete?: () => void;
  forcePrompt?: boolean;
}> = ({ onComplete, forcePrompt = false }) => {
  const [state, setState] = React.useState<'spinning' | 'biometric' | 'success'>('spinning');

  React.useEffect(() => {
    if (forcePrompt) {
      setTimeout(() => setState('biometric'), 800);
    } else {
      setTimeout(() => setState('success'), 1500);
    }
  }, [forcePrompt]);

  React.useEffect(() => {
    if (state === 'success' && onComplete) {
      setTimeout(onComplete, 1000);
    }
  }, [state, onComplete]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/5 flex items-center justify-center p-6 selection:bg-proof-blue-500 selection:text-white">
      <div className="w-full max-w-[380px] bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col">
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-50 bg-[#f8f9fa]">
           <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-gray-900 flex items-center justify-center">
                <div className="w-2.5 h-2.5 bg-white rotate-45" />
              </div>
              <span className="text-xs font-bold tracking-tight">ProofLine</span>
           </div>
           <button className="p-1 hover:bg-gray-200 rounded-full transition-colors text-gray-300">
             <X className="w-4 h-4" />
           </button>
        </div>

        <div className="flex-1 p-8 flex flex-col items-center justify-center min-h-[220px]">
          <AnimatePresence mode="wait">
            {state === 'spinning' && (
              <motion.div 
                key="spinning"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="flex flex-col items-center gap-6"
              >
                <div className="relative">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                    className="w-16 h-16 rounded-full border-4 border-gray-100 border-t-navy-900"
                  />
                  <ShieldCheck className="absolute inset-0 m-auto w-6 h-6 text-gray-400" />
                </div>
                <div className="text-center">
                  <h3 className="text-base font-semibold text-gray-900">Verifying session…</h3>
                  <p className="text-xs text-gray-400 mt-1">Silent cryptographic re-sign</p>
                </div>
              </motion.div>
            )}

            {state === 'biometric' && (
              <motion.div 
                key="biometric"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full flex flex-col items-center gap-4"
              >
                <div className="p-4 bg-navy-50 rounded-2xl mb-2 text-navy-900 text-center">
                  <Lock className="w-5 h-5 mx-auto mb-2 opacity-60" />
                  <p className="text-xs font-bold leading-tight">Quick check — your device wants to verify it's still you</p>
                </div>
                <BiometricPrompt 
                  isOpen={true} 
                  onComplete={() => setState('success')} 
                  variant="mac"
                  state="idle"
                />
              </motion.div>
            )}

            {state === 'success' && (
              <motion.div 
                key="success"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="w-16 h-16 rounded-full bg-proof-green-600 flex items-center justify-center shadow-lg shadow-proof-green-600/20">
                   <ShieldCheck className="w-8 h-8 text-white" strokeWidth={2.5} />
                </div>
                <div className="text-center font-bold text-proof-green-600 font-sans tracking-tight">
                  Session Verified
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-4 bg-gray-50 flex justify-center border-t border-gray-100">
          <div className="flex items-center gap-1.5 text-[9px] font-bold text-gray-300 uppercase tracking-widest">
            <Lock className="w-3 h-3" /> Hardware Secure Enclave Active
          </div>
        </div>
      </div>
    </div>
  );
};
