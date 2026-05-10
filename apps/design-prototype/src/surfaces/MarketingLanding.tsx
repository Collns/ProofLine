import * as React from 'react';
import { motion } from 'motion/react';
import { Shield, Lock, FileCheck, Globe, ArrowRight } from 'lucide-react';

export const MarketingLanding: React.FC = () => {
  return (
    <div className="min-h-screen bg-ink-900 text-white overflow-hidden selection:bg-proof-blue-500 selection:text-white">
      {/* Grid Background */}
      <div className="fixed inset-0 grid-background pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-white flex items-center justify-center">
              <div className="w-4 h-4 bg-ink-900 rotate-45" />
            </div>
            <span className="text-xl font-bold tracking-tight">ProofLine</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-white/60">
            <a href="#" className="hover:text-white transition-colors">Infrastructure</a>
            <a href="#" className="hover:text-white transition-colors">Documentation</a>
            <a href="#" className="hover:text-white transition-colors">Network</a>
            <a href="#" className="hover:text-white transition-colors">Pricing</a>
        </div>
        <button className="px-4 py-2 bg-white text-ink-900 rounded-md text-sm font-semibold hover:bg-white/90 transition-all">
          Get Started
        </button>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-8 pt-24 pb-32">
        <div className="grid md:grid-cols-2 gap-24 items-center">
           <div>
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <h1 className="text-8xl font-serif font-medium tracking-tighter leading-[0.9] mb-8">
                  Provable, not <span className="italic">trusted</span>.
                </h1>
                <p className="text-xl text-white/50 font-sans leading-relaxed max-w-lg mb-10">
                  ProofLine is the cryptographic identity layer for B2B wire transfers and counterparty changes. Hardware-signed, on-chain anchored, verified in one click — without trusting us.
                </p>
                <div className="flex items-center gap-4">
                   <button className="px-6 py-3 bg-proof-blue-600 rounded-lg font-semibold flex items-center gap-2 hover:bg-proof-blue-500 transition-all group">
                     Deploy Now <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                   </button>
                   <button className="px-6 py-3 bg-white/5 border border-white/10 rounded-lg font-semibold hover:bg-white/10 transition-all">
                     View Demo
                   </button>
                </div>
              </motion.div>
           </div>

           <div className="relative">
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 1 }}
                className="relative z-20 aspect-square rounded-3xl border border-white/10 bg-white/5 backdrop-blur-3xl overflow-hidden flex items-center justify-center"
              >
                {/* Cryptographic Visual Motif (Merkle Tree / Graph) */}
                <svg width="400" height="400" viewBox="0 0 400 400" className="text-proof-blue-500 opacity-80">
                   <circle cx="200" cy="80" r="4" fill="currentColor" />
                   <path d="M200 85 L120 180 M200 85 L280 180" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
                   <circle cx="120" cy="180" r="4" fill="currentColor" />
                   <circle cx="280" cy="180" r="4" fill="currentColor" />
                   <path d="M120 185 L60 280 M120 185 L180 280" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
                   <path d="M280 185 L220 280 M280 185 L340 280" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
                   <circle cx="60" cy="280" r="4" fill="white" />
                   <circle cx="180" cy="280" r="4" fill="white" />
                   <circle cx="220" cy="280" r="4" fill="white" />
                   <circle cx="340" cy="280" r="4" fill="white" />
                   <motion.path 
                     d="M60 280 L200 360 L340 280" 
                     stroke="currentColor" 
                     strokeWidth="2" 
                     fill="none" 
                     initial={{ pathLength: 0 }}
                     animate={{ pathLength: 1 }}
                     transition={{ duration: 2, repeat: Infinity }}
                   />
                </svg>
                {/* Floaties */}
                <div className="absolute top-1/4 left-1/4 px-3 py-1.5 rounded-full bg-proof-green-600/20 border border-proof-green-600/30 text-proof-green-600 text-[10px] font-mono backdrop-blur-md">
                   SIGNATURE_VALID
                </div>
                <div className="absolute bottom-1/4 right-1/4 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white text-[10px] font-mono backdrop-blur-md">
                   BASE_ANCHOR_#4182
                </div>
              </motion.div>
              {/* Background Glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-proof-blue-600/20 blur-[120px] rounded-full" />
           </div>
        </div>

        <section className="mt-48 grid md:grid-cols-3 gap-8">
           {[
             { title: 'Hardware Security', desc: 'Private keys never leave your secure enclave. Passkey and HSM backed.', icon: Lock },
             { title: 'Public Auditability', desc: 'Every transaction is anchored to Base for verifiable history.', icon: Globe },
             { title: 'Bilateral Trust', desc: 'Multi-party signing for sensitive counterparty changes and wires.', icon: FileCheck },
           ].map((item, idx) => (
             <div key={item.title} className="p-8 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all">
                <item.icon className="w-8 h-8 text-proof-blue-500 mb-6" />
                <h3 className="text-lg font-semibold mb-3">{item.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{item.desc}</p>
             </div>
           ))}
        </section>

        <section className="mt-48 py-24 border-t border-white/5">
           <blockquote className="max-w-4xl">
              <p className="text-5xl font-serif italic text-white/80 leading-tight mb-8">
                “Phone callbacks die under deepfakes. We’re built for what’s next.”
              </p>
              <footer className="text-white/40 font-medium">
                 — Security Leadership at Acme Title LLC
              </footer>
           </blockquote>
        </section>
      </main>
    </div>
  );
};
