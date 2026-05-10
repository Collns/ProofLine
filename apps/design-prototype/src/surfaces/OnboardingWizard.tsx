import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, ArrowLeft, Globe, Mail, Shield, Building2, Key, Check } from 'lucide-react';
import { OnboardingStepper, VerifyBadge } from '../components/ProofComponents';
import { cn } from '../lib/tokens';

const steps = [
  'Domain Authority',
  'Identity Link',
  'Public Registry',
  'Officer Verification',
  'Key Ceremony',
  'On-chain Anchor'
];

export const OnboardingWizard: React.FC = () => {
  const [currentStep, setCurrentStep] = React.useState(0);

  return (
    <div className="min-h-screen bg-white flex">
      {/* Sidebar Stepper */}
      <div className="w-80 border-r border-gray-100 bg-gray-50/50 p-10 hidden lg:block">
        <div className="flex items-center gap-2 mb-16">
            <div className="w-6 h-6 rounded bg-gray-900 flex items-center justify-center">
              <div className="w-3 h-3 bg-white rotate-45" />
            </div>
            <span className="text-lg font-bold tracking-tight">ProofLine</span>
        </div>
        <OnboardingStepper currentStep={currentStep} steps={steps} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col pt-20 px-8 lg:px-24 max-w-5xl">
        <div className="mb-12">
           <div className="text-xs font-bold text-proof-blue-600 uppercase tracking-widest mb-4">Step {currentStep + 1} of 6</div>
           <h1 className="text-4xl font-serif text-gray-900 mb-4">{steps[currentStep]}</h1>
           <p className="text-gray-500 text-lg">
             {currentStep === 0 && "We need to verify that you own acme-title.com and have authority to sign on its behalf."}
             {currentStep === 1 && "Link your professional identity to ensure clear attribution for every signature."}
             {currentStep === 2 && "Synchronizing with TX Secretary of State records to verify legal standing."}
             {currentStep === 3 && "Adding Sarah Chen and Bob Rivera as authorized signers with WebAuthn credentials."}
             {currentStep === 4 && "Establishing hardware-backed cryptographic anchors in your local secure enclave."}
             {currentStep === 5 && "Publishing the organizational root hash to the public ledger for global verifiability."}
           </p>
        </div>

        <div className="flex-1">
           <AnimatePresence mode="wait">
             <motion.div 
               key={currentStep}
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               exit={{ opacity: 0, x: -20 }}
               transition={{ duration: 0.3 }}
               className="bg-gray-50/50 rounded-2xl border border-gray-100 p-12 min-h-[400px] flex items-center justify-center"
             >
                {currentStep === 0 && (
                  <div className="w-full max-w-md space-y-6">
                     <div className="p-4 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center gap-4">
                        <Globe className="w-6 h-6 text-gray-400" />
                        <div className="flex-1">
                           <div className="text-[10px] font-bold text-gray-400 uppercase">Domain</div>
                           <div className="font-semibold text-gray-900">acme-title.com</div>
                        </div>
                        <VerifyBadge state="verified" />
                     </div>
                     <div className="p-4 rounded-lg bg-white border border-gray-200 border-dashed text-center text-sm text-gray-400 italic font-serif">
                        DNS TXT record verified: proofline-id=0x7f...a2
                     </div>
                  </div>
                )}
                
                {currentStep === 2 && (
                   <div className="space-y-6 text-center">
                      <div className="relative inline-block">
                         <Building2 className="w-16 h-16 text-gray-200" />
                         <motion.div 
                           animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                           transition={{ repeat: Infinity, duration: 2 }}
                           className="absolute inset-0 bg-proof-blue-500 rounded-full blur-2xl"
                         />
                      </div>
                      <div className="font-mono text-xs text-gray-400">STATE_QUERY: TX_SECRETARY_OF_STATE_REGISTRY</div>
                   </div>
                )}

                {currentStep === 4 && (
                   <div className="grid grid-cols-2 gap-4 w-full">
                      <div className="p-6 rounded-xl bg-white border border-gray-200 text-center space-y-3">
                         <Key className="w-8 h-8 text-proof-blue-500 mx-auto" />
                         <div className="text-sm font-semibold">Generate RSA-4096</div>
                         <div className="text-[10px] font-mono text-gray-400">SECURE_ENCLAVE_ACTIVE</div>
                      </div>
                      <div className="p-6 rounded-xl bg-white border border-gray-200 text-center space-y-3">
                         <Shield className="w-8 h-8 text-proof-blue-500 mx-auto" />
                         <div className="text-sm font-semibold">Establish Anchor</div>
                         <div className="text-[10px] font-mono text-gray-400">HSM_HANDSHAKE_READY</div>
                      </div>
                   </div>
                )}
             </motion.div>
           </AnimatePresence>
        </div>

        <div className="py-12 border-t border-gray-100 flex items-center justify-between">
           <button 
             onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
             disabled={currentStep === 0}
             className="flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-gray-900 disabled:opacity-0 transition-all"
           >
             <ArrowLeft className="w-4 h-4" /> Back
           </button>
           <button 
             onClick={() => setCurrentStep(Math.min(steps.length - 1, currentStep + 1))}
             className="px-8 py-3 bg-gray-900 text-white rounded-lg font-semibold flex items-center gap-2 hover:bg-gray-800 transition-all group"
           >
             {currentStep === steps.length - 1 ? "Complete Setup" : "Continue"} 
             <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
           </button>
        </div>
      </div>
    </div>
  );
};
