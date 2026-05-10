import * as React from 'react';
import { 
  Users, 
  Smartphone, 
  ShieldCheck, 
  Key, 
  Trash2, 
  Plus, 
  Search,
  Activity,
  Terminal,
  ArrowUpRight
} from 'lucide-react';
import { demoData } from '../lib/demo-data';

export const AdminApp: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      {/* Header with Help */}
      <div className="px-8 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-md z-30">
         <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-gray-900 flex items-center justify-center">
               <div className="w-3.5 h-3.5 bg-white rotate-45" />
            </div>
            <span className="text-lg font-bold tracking-tight text-gray-900">ProofLine Admin</span>
         </div>
         <a href="#" className="text-xs font-bold text-proof-blue-600 hover:underline flex items-center gap-1.5">
            ProofLine Help <ArrowUpRight className="w-3.5 h-3.5" />
         </a>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-12">
        <div className="flex items-end justify-between mb-12">
            <div>
               <h1 className="text-3xl font-serif text-gray-900 mb-2">Users & Devices</h1>
               <p className="text-gray-500 font-medium">Manage authorized signers and their cryptographic credentials.</p>
            </div>
            <button className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-gray-800 transition-all">
                <Plus className="w-4 h-4" /> Add Signer
            </button>
        </div>

        <div className="grid grid-cols-3 gap-8">
           <div className="col-span-2 space-y-6">
              <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm bg-white">
                 <table className="w-full text-left">
                    <thead>
                       <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Signer</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Role</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">USD Limit</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Actions</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                       {demoData.officers.map((officer) => (
                          <tr key={officer.id} className="hover:bg-gray-50 transition-colors">
                             <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                   <div className={`w-8 h-8 rounded-full ${officer.avatarColor} flex items-center justify-center text-white text-[10px] font-bold`}>
                                      {officer.name.charAt(0)}
                                   </div>
                                   <div className="text-sm font-semibold text-gray-900">{officer.name}</div>
                                </div>
                             </td>
                             <td className="px-6 py-4">
                                <span className="px-2 py-1 rounded bg-gray-100 text-[10px] font-bold text-gray-500 uppercase">
                                   {officer.role}
                                </span>
                             </td>
                             <td className="px-6 py-4 text-sm font-mono text-gray-600">
                                {officer.limit ? `$${officer.limit.toLocaleString()}` : "∞ UNLIMITED"}
                             </td>
                             <td className="px-6 py-4 text-right">
                                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-red-500 transition-colors">
                                   <Trash2 className="w-4 h-4" />
                                </button>
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
              </div>

              <div className="space-y-4">
                 <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
                    <History className="w-4 h-4" /> Hardened Audit Log
                 </h3>
                 <div className="space-y-2">
                    {[
                      { action: 'CREDENTIAL_ROTATED', user: 'Bob Rivera', hash: '0x1c...4f', time: '2m ago' },
                      { action: 'LIMIT_INCREASED', user: 'Alice Park', hash: '0x8a...92', time: '1h ago' },
                      { action: 'SIGNER_ADDED', user: 'System', hash: '0x4f...22', time: '1d ago' },
                    ].map((log, i) => (
                       <div key={i} className="flex items-center justify-between p-4 bg-gray-50/50 rounded-lg border border-gray-100 text-[11px]">
                          <div className="flex items-center gap-3">
                             <Terminal className="w-3.5 h-3.5 text-gray-400" />
                             <span className="font-mono text-gray-900">{log.action}</span>
                             <span className="text-gray-400">by {log.user}</span>
                          </div>
                          <div className="flex items-center gap-4">
                             <span className="font-mono text-gray-300">{log.hash}</span>
                             <span className="font-medium text-gray-400">{log.time}</span>
                          </div>
                       </div>
                    ))}
                 </div>
              </div>
           </div>

           <div className="space-y-8">
              <div className="p-6 rounded-xl border border-gray-100 bg-white space-y-6 shadow-sm">
                 <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
                    <Smartphone className="w-4 h-4" /> Verified Devices
                 </h3>
                 <div className="space-y-4">
                    {[
                      { name: "Sarah's iPhone · Face ID", id: '0x4a8b...2e91', type: 'Primary' },
                      { name: "Bob's YubiKey 5C", id: '0x8b32...1f4d', type: 'Backup' },
                    ].map((dev, i) => (
                       <div key={i} className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                          <div className="flex items-center justify-between mb-1">
                             <div className="text-xs font-semibold text-gray-900">{dev.name}</div>
                             <div className="text-[9px] font-bold text-proof-blue-600 bg-proof-blue-500/10 px-1.5 py-0.5 rounded uppercase">{dev.type}</div>
                          </div>
                          <div className="font-mono text-[10px] text-gray-400">ID: {dev.id}</div>
                       </div>
                    ))}
                 </div>
                 <button className="w-full py-3 bg-gray-50 border border-gray-100 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors">
                    Register New Hardware Key
                 </button>
              </div>

              <div className="p-6 rounded-xl bg-navy-900 text-white space-y-4">
                 <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-proof-green-600" />
                    <span className="text-xs font-bold uppercase tracking-widest text-white/50">Security Health</span>
                 </div>
                 <div className="flex items-end justify-between">
                    <div className="text-3xl font-serif">100%</div>
                    <div className="text-[10px] font-mono text-proof-green-600">CERT_SIGNED</div>
                 </div>
                 <p className="text-xs text-white/40 leading-relaxed">
                    All authorized signers have valid WebAuthn credentials bound to the organizational root.
                 </p>
                 <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full w-full bg-proof-green-600" />
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

const History = Activity; // Alias for consistency with component library naming if needed
