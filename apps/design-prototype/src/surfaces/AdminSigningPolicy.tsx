import * as React from 'react';
import { 
  Shield, 
  Clock, 
  ChevronRight, 
  ChevronDown, 
  AlertCircle,
  FileText,
  Trash2,
  Plus
} from 'lucide-react';
import { cn } from '../lib/tokens';

export const AdminSigningPolicy: React.FC = () => {
  const [sessionTtl, setSessionTtl] = React.useState('15m');
  const [highValueThreshold, setHighValueThreshold] = React.useState('50k');
  const [internalExpiry, setInternalExpiry] = React.useState('30m');
  const [bilateralWindow, setBilateralWindow] = React.useState('14d');
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 selection:bg-navy-700 selection:text-white">
      <div className="max-w-4xl mx-auto px-8 py-12">
         {/* Breadcrumbs */}
         <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest mb-6">
            <span>Settings</span>
            <ChevronRight className="w-3 h-3" />
            <span>Security</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-navy-900">Signing Policy</span>
         </div>

         <div className="mb-12">
            <h1 className="text-3xl font-serif text-gray-900 mb-2">Signing Policy</h1>
            <p className="text-gray-500 font-medium">Define timeouts and approval thresholds for cryptographic signatures.</p>
         </div>

         <div className="space-y-10">
            {/* Section 1: Session TTL */}
            <div className="p-8 rounded-2xl border border-gray-100 bg-white shadow-sm space-y-8 transition-all hover:shadow-md">
               <div>
                  <h3 className="text-lg font-semibold mb-2">Session TTL policy</h3>
                  <p className="text-sm text-gray-500 max-w-lg">How long does a signing session remain valid for a specific recipient?</p>
               </div>

               <div className="grid grid-cols-2 gap-4">
                  {[
                    { id: '5m', label: '5 minutes', sub: '' },
                    { id: '15m', label: '15 minutes', sub: '(default)' },
                    { id: '30m', label: '30 minutes', sub: '' },
                    { id: 'disabled', label: 'Always Biometric', sub: '' },
                  ].map((opt) => (
                    <label 
                      key={opt.id}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all",
                        sessionTtl === opt.id ? "border-proof-blue-500 bg-proof-blue-500/5 ring-1 ring-proof-blue-500" : "border-gray-100 hover:bg-gray-50"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                          sessionTtl === opt.id ? "border-proof-blue-500" : "border-gray-200"
                        )}>
                           {sessionTtl === opt.id && <div className="w-2.5 h-2.5 rounded-full bg-proof-blue-500" />}
                        </div>
                        <div>
                          <span className={cn("text-sm font-semibold", sessionTtl === opt.id ? "text-gray-900" : "text-gray-600")}>{opt.label}</span>
                          {opt.sub && <span className="ml-2 text-xs text-gray-400 font-medium">{opt.sub}</span>}
                        </div>
                      </div>
                      <input 
                        type="radio" 
                        className="hidden" 
                        name="sessionTtl" 
                        value={opt.id} 
                        onChange={(e) => setSessionTtl(e.target.value)}
                      />
                    </label>
                  ))}
               </div>

               <div className="flex items-center justify-between px-4">
                  <span className="text-[10px] font-mono text-gray-400 uppercase font-bold tracking-widest">Boundary Controls</span>
                  <span className="text-[11px] font-mono text-gray-900 bg-gray-50 px-2 py-1 rounded">Min: 5 min · Max: 60 min hard cap</span>
               </div>

               <div className="p-4 rounded-xl bg-navy-50 text-navy-900 border border-navy-100 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                  <p className="text-sm font-medium leading-relaxed italic">
                    Shorter is safer; users will biometric-verify more often.
                  </p>
               </div>
            </div>

            {/* Section 2: High-Value Override */}
            <div className="p-8 rounded-2xl border border-gray-100 bg-white shadow-sm space-y-8 transition-all hover:shadow-md">
               <div>
                  <h3 className="text-lg font-semibold mb-2">High-value override threshold</h3>
                  <p className="text-sm text-gray-500 max-w-lg">Instruction amounts above this threshold ALWAYS require fresh biometric.</p>
               </div>

               <div className="grid grid-cols-2 gap-4">
                  {[
                    { id: '10k', label: '$10,000', sub: '' },
                    { id: '50k', label: '$50,000', sub: '(default)' },
                    { id: '100k', label: '$100,000', sub: '' },
                    { id: '500k', label: '$500,000', sub: '' },
                  ].map((opt) => (
                    <label 
                      key={opt.id}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all",
                        highValueThreshold === opt.id ? "border-proof-blue-500 bg-proof-blue-500/5 ring-1 ring-proof-blue-500" : "border-gray-100 hover:bg-gray-50"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                          highValueThreshold === opt.id ? "border-proof-blue-500" : "border-gray-200"
                        )}>
                           {highValueThreshold === opt.id && <div className="w-2.5 h-2.5 rounded-full bg-proof-blue-500" />}
                        </div>
                        <span className={cn("text-sm font-semibold", highValueThreshold === opt.id ? "text-gray-900" : "text-gray-600")}>{opt.label}</span>
                      </div>
                      <input 
                        type="radio" 
                        className="hidden" 
                        name="threshold" 
                        value={opt.id} 
                        onChange={(e) => setHighValueThreshold(e.target.value)}
                      />
                    </label>
                  ))}
               </div>

               <div className="p-4 rounded-xl bg-gray-50 text-gray-500 border border-gray-100 flex items-start gap-3">
                  <Shield className="w-4 h-4 mt-0.5 shrink-0" />
                  <p className="text-xs font-medium leading-relaxed">
                    Emails marked as wire instructions above this threshold ALWAYS require fresh biometric, regardless of session state.
                  </p>
               </div>
            </div>

            {/* Section 3: Internal Cosign */}
            <div className="p-8 rounded-2xl border border-gray-100 bg-white shadow-sm space-y-8 transition-all hover:shadow-md">
               <div>
                  <h3 className="text-lg font-semibold mb-2">Internal cosign link expiry</h3>
                  <p className="text-sm text-gray-500 max-w-lg">How long does an email cosign link stay valid for managers in your company?</p>
               </div>

               <div className="space-y-3">
                  {[
                    { id: '15m', label: '15 minutes', sub: '(recommended)', icon: Clock },
                    { id: '30m', label: '30 minutes', sub: '(default)', icon: Clock },
                    { id: '1h', label: '1 hour', sub: '', icon: Clock },
                    { id: '4h', label: '4 hours', sub: '', icon: Clock },
                  ].map((opt) => (
                    <label 
                      key={opt.id}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all",
                        internalExpiry === opt.id ? "border-proof-blue-500 bg-proof-blue-500/5 ring-1 ring-proof-blue-500" : "border-gray-100 hover:bg-gray-50"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                          internalExpiry === opt.id ? "border-proof-blue-500" : "border-gray-200"
                        )}>
                           {internalExpiry === opt.id && <div className="w-2.5 h-2.5 rounded-full bg-proof-blue-500" />}
                        </div>
                        <div>
                          <span className={cn("text-sm font-semibold", internalExpiry === opt.id ? "text-gray-900" : "text-gray-600")}>{opt.label}</span>
                          {opt.sub && <span className="ml-2 text-xs text-gray-400 font-medium">{opt.sub}</span>}
                        </div>
                      </div>
                      <input 
                        type="radio" 
                        className="hidden" 
                        name="expiry" 
                        value={opt.id} 
                        onChange={(e) => setInternalExpiry(e.target.value)}
                      />
                    </label>
                  ))}
               </div>

               <div className="flex items-center justify-between px-4">
                  <span className="text-[10px] font-mono text-gray-400 uppercase font-bold tracking-widest">Boundary Controls</span>
                  <span className="text-[11px] font-mono text-gray-900 bg-gray-50 px-2 py-1 rounded">Min: 5 min · Max: 24 h (hard cap)</span>
               </div>

               <div className="p-4 rounded-xl bg-navy-50 text-navy-900 border border-navy-100 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                  <p className="text-sm font-medium leading-relaxed italic">
                    Shorter is safer. If a manager misses the window, they can request a fresh link in one tap.
                  </p>
               </div>
            </div>

            {/* Section 2: Bilateral Window */}
            <div className="p-8 rounded-2xl border border-gray-100 bg-white shadow-sm space-y-8 transition-all hover:shadow-md">
               <div>
                  <h3 className="text-lg font-semibold mb-2">Bilateral signing window</h3>
                  <p className="text-sm text-gray-500 max-w-lg">How long do counterparties have to sign documents you send them?</p>
               </div>

               <div className="grid grid-cols-2 gap-4">
                  {[
                    { id: '24h', label: '24 hours', sub: '(rush)' },
                    { id: '7d', label: '7 days', sub: '' },
                    { id: '14d', label: '14 days', sub: '(default)' },
                    { id: '30d', label: '30 days', sub: '' },
                  ].map((opt) => (
                    <label 
                      key={opt.id}
                      className={cn(
                        "flex flex-col p-4 rounded-xl border cursor-pointer transition-all",
                        bilateralWindow === opt.id ? "border-proof-blue-500 bg-proof-blue-500/5 ring-1 ring-proof-blue-500" : "border-gray-100 hover:bg-gray-50"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn("text-sm font-bold", bilateralWindow === opt.id ? "text-navy-900" : "text-gray-600")}>{opt.label}</span>
                        <div className={cn(
                          "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                          bilateralWindow === opt.id ? "border-proof-blue-500" : "border-gray-200"
                        )}>
                           {bilateralWindow === opt.id && <div className="w-2 h-2 rounded-full bg-proof-blue-500" />}
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-400 font-bold uppercase">{opt.sub || 'standard'}</span>
                      <input 
                        type="radio" 
                        className="hidden" 
                        name="bilateral" 
                        value={opt.id} 
                        onChange={(e) => setBilateralWindow(e.target.value)}
                      />
                    </label>
                  ))}
               </div>

               <div className="p-4 rounded-xl bg-gray-50 text-gray-500 border border-gray-100 flex items-start gap-3">
                  <Shield className="w-4 h-4 mt-0.5 shrink-0" />
                  <p className="text-xs font-medium leading-relaxed">
                    This is per-document configurable too — drafters can override at compose time.
                  </p>
               </div>
            </div>

            {/* Section 3: Advanced Overrides */}
            <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm transition-all">
               <button 
                 onClick={() => setAdvancedOpen(!advancedOpen)}
                 className="w-full flex items-center justify-between px-8 py-6 bg-white hover:bg-gray-50 transition-colors"
               >
                  <div className="flex items-center gap-4">
                     <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
                        <ChevronDown className={cn("w-5 h-5 transition-transform", advancedOpen && "rotate-180")} />
                     </div>
                     <span className="font-semibold">Per-wire-amount overrides (advanced)</span>
                  </div>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{advancedOpen ? 'Close' : 'Configure'}</span>
               </button>
               {advancedOpen && (
                  <div className="px-8 pb-8 bg-white space-y-6">
                     <table className="w-full text-left">
                        <thead>
                           <tr className="border-b border-gray-100">
                              <th className="py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Threshold</th>
                              <th className="py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cosign expiry</th>
                              <th className="py-4 text-[10px] font-bold text-gray-400 uppercase text-right">Action</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                           <tr className="hover:bg-gray-50">
                              <td className="py-4 py-4 text-sm font-mono text-gray-900">$500,000+</td>
                              <td className="py-4">
                                 <span className="px-2 py-1 rounded bg-navy-900 text-white text-[10px] font-bold uppercase tracking-wider">15 min</span>
                              </td>
                              <td className="py-4 text-right">
                                 <button className="p-1.5 hover:bg-red-50 text-gray-300 hover:text-red-600 rounded transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                 </button>
                              </td>
                           </tr>
                        </tbody>
                     </table>
                     <button className="w-full py-3 bg-gray-50 border border-dashed border-gray-200 rounded-xl text-xs font-bold text-gray-400 hover:bg-white hover:border-gray-300 transition-all flex items-center justify-center gap-2 group">
                        <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" /> Add Tier
                     </button>
                  </div>
               )}
            </div>
         </div>

         {/* Footer Actions */}
         <div className="mt-16 pt-12 border-t border-gray-100 flex flex-col items-center gap-6">
            <div className="flex items-center gap-4">
               <button className="px-10 py-4 bg-navy-900 text-white rounded-xl font-bold shadow-2xl shadow-navy-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
                  Save Changes
               </button>
            </div>
            <p className="text-xs text-gray-400 font-medium flex items-center justify-center gap-2">
               Changes apply to <span className="text-gray-900 font-bold uppercase underline decoration-navy-900/30">new</span> wires only.
            </p>
            <a href="#" className="flex items-center gap-2 text-xs font-bold text-proof-blue-600 hover:underline">
               All policy changes are recorded as signed audit events. View audit log <FileText className="w-3.5 h-3.5" />
            </a>
         </div>
      </div>
    </div>
  );
};
