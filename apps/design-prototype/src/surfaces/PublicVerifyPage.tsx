import * as React from 'react';
import { motion } from 'motion/react';
import { Shield, Info, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import { 
  VerifyBadge, 
  WirePayloadCard, 
  SignerChip, 
  AnchorReceipt,
  VerificationState 
} from '../components/ProofComponents';
import { demoData } from '../lib/demo-data';
import { cn } from '../lib/tokens';

export const PublicVerifyPage: React.FC<{ forceState?: VerificationState }> = ({ forceState = 'verified' }) => {
  const [state, setState] = React.useState<VerificationState>(forceState);

  return (
    <div className="min-h-screen bg-ink-900 text-white selection:bg-proof-blue-500 selection:text-white font-sans">
      <div className="fixed inset-0 grid-background pointer-events-none opacity-50" />
      
      {/* Mini Nav */}
      <nav className="relative z-10 px-8 py-6 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-proof-blue-500" />
            <span className="font-semibold tracking-tight text-sm">ProofLine Verification</span>
        </div>
        <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
           System Status: Operational
        </div>
      </nav>

      {/* State Switcher for Demo */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-ink-800/80 backdrop-blur-md border border-white/10 p-1.5 rounded-full flex gap-1">
         {['verified', 'bilateral', 'tampered'].map((s) => (
           <button 
             key={s}
             onClick={() => setState(s as any)}
             className={cn(
               "px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-all",
               state === s ? "bg-white text-ink-900" : "text-white/50 hover:text-white"
             )}
           >
             {s}
           </button>
         ))}
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-20">
        <motion.div 
          key={state}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-white/5 border border-white/10 mb-6">
             {state === 'verified' && <CheckCircle2 className="w-10 h-10 text-proof-green-600" />}
             {state === 'bilateral' && <Shield className="w-10 h-10 text-proof-emerald-400" />}
             {state === 'tampered' && <AlertTriangle className="w-10 h-10 text-proof-red-600" />}
          </div>
          <h1 className="text-5xl font-serif mb-4 leading-tight">
            {state === 'verified' && "Verified wire instruction"}
            {state === 'bilateral' && "Bilateral verification complete"}
            {state === 'tampered' && "Verification failed: TAMPERED"}
          </h1>
          <p className="text-white/50 text-base max-w-lg mx-auto">
            {state === 'verified' && <>Signed by 2 people at <span className="text-white font-medium">Acme Title LLC</span> · acme-title.com</>}
            {state === 'bilateral' && <>Cryptographically confirmed by both <span className="text-white font-medium">Acme Title</span> and <span className="text-white font-medium">Scotiabank</span></>}
            {state === 'tampered' && <span className="text-proof-red-500 font-semibold uppercase tracking-wider">DO NOT SEND FUNDS — This instruction does not match its signature.</span>}
          </p>
        </motion.div>

        <div className="grid md:grid-cols-5 gap-8">
           <div className="md:col-span-3 space-y-6">
              <WirePayloadCard 
                 amount={demoData.wire.amount}
                 recipient={demoData.wire.recipient}
                 account={state === 'tampered' ? demoData.wire.tamperedAccount : demoData.wire.account}
                 routing={demoData.wire.routing}
                 purpose={demoData.wire.purpose}
                 isTampered={state === 'tampered'}
              />
              
              {state === 'tampered' && (
                <div className="p-5 rounded-lg border border-proof-red-600/50 bg-proof-red-600/10 text-proof-red-500 space-y-3">
                   <div className="flex items-center gap-2 font-bold text-sm">
                      <AlertTriangle className="w-4 h-4" />
                      SIGNATURE MISMATCH
                   </div>
                   <div className="grid grid-cols-2 gap-4 text-xs">
                      <div className="space-y-1">
                         <div className="text-white/40 uppercase text-[9px] font-bold">Signed Account</div>
                         <div className="font-mono text-white/80">{demoData.wire.account}</div>
                      </div>
                      <div className="space-y-1">
                         <div className="text-white/40 uppercase text-[9px] font-bold">Instruction Account</div>
                         <div className="font-mono">{demoData.wire.tamperedAccount} ⚠</div>
                      </div>
                   </div>
                </div>
              )}
           </div>

           <div className="md:col-span-2 space-y-6">
              <div className="space-y-4">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-white/30">Authoritative Signers</h3>
                <div className="space-y-3">
                   <SignerChip 
                     name="Alice Park" 
                     role="Owner" 
                     deviceId="Alice's MacBook · Touch ID" 
                     verified={state !== 'tampered'} 
                   />
                   <SignerChip 
                     name="Bob Rivera" 
                     role="Manager" 
                     deviceId="Bob's YubiKey 5C" 
                     verified={state !== 'tampered'} 
                   />
                   {state === 'bilateral' && (
                     <SignerChip 
                       name="Scotiabank Infra" 
                       role="System Anchor" 
                       deviceId="Scotiabank Cloud · KMS" 
                       verified={true} 
                     />
                   )}
                </div>
              </div>

              <AnchorReceipt 
                network={demoData.anchor.network}
                block={demoData.anchor.block}
                txHash={demoData.anchor.txHash}
              />

              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                 <div className="flex items-center gap-2 mb-2">
                    <Info className="w-3 h-3 text-white/40" />
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Verification Source</span>
                 </div>
                 <p className="text-[11px] text-white/60 leading-relaxed">
                   This instruction was signed via WebAuthn hardware keys. Total integrity matches the immutable record anchored at {demoData.anchor.sequence}.
                 </p>
                 <a href="#" className="inline-flex items-center gap-1 mt-4 text-[10px] font-semibold text-proof-blue-500 hover:underline">
                    Technical Proof Audit <ChevronRight className="w-3 h-3" />
                 </a>
              </div>
           </div>
        </div>
      </main>
    </div>
  );
};
