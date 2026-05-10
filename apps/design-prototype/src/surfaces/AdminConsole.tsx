import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart3, 
  History as HistoryIcon, 
  Users, 
  Search, 
  Bell, 
  ArrowUpRight,
  TrendingUp,
  FileText,
  Globe,
  Shield,
  Clock,
  Activity,
  Settings,
  ShieldCheck,
  ChevronRight,
  Download,
  AlertCircle
} from 'lucide-react';
import { 
  VerifyBadge, 
  SignerChip 
} from '../components/ProofComponents';
import { demoData } from '../lib/demo-data';
import { cn } from '../lib/tokens';
import { AdminSessionsTab } from './AdminSessionsTab';

export const AdminConsole: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState('activity');

  const tabs = [
    { id: 'activity', label: 'Activity' },
    { id: 'users', label: 'Users & devices' },
    { id: 'counterparties', label: 'Counterparties' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'policy', label: 'Signing policy' },
    { id: 'audit', label: 'Audit log' },
  ];

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-navy-700 selection:text-white">
      {/* Extension Banner */}
      <div className="bg-navy-900 text-white px-8 py-3 flex items-center justify-between text-sm">
         <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-white flex items-center justify-center">
               <div className="w-3 h-3 bg-navy-900 rotate-45" />
            </div>
            <p className="font-medium">
               Compose signed emails from Gmail or Outlook — install the extension if you haven't already.
            </p>
         </div>
         <a href="#" className="flex items-center gap-1.5 font-bold hover:underline transition-all">
            Get extension <ChevronRight className="w-4 h-4" />
         </a>
      </div>

      {/* Top Header */}
      <header className="px-8 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-md z-30">
         <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-gray-900 flex items-center justify-center">
                  <div className="w-3.5 h-3.5 bg-white rotate-45" />
                </div>
                <span className="text-lg font-bold tracking-tight">ProofLine</span>
            </div>
         </div>
         <div className="flex items-center gap-6">
            <a href="#" className="text-xs font-bold text-proof-blue-600 hover:underline flex items-center gap-1.5">
               ProofLine Help <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
            <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
               <input 
                 type="text" 
                 placeholder="Search activity, users..." 
                 className="pl-10 pr-4 py-2 bg-gray-50 border border-transparent focus:border-gray-200 focus:bg-white rounded-lg text-sm w-64 outline-none transition-all"
               />
            </div>
            <button className="p-2 text-gray-400 hover:text-gray-900 transition-colors relative">
               <Bell className="w-5 h-5" />
               <span className="absolute top-2 right-2 w-2 h-2 bg-proof-red-500 rounded-full border-2 border-white" />
            </button>
            <div className="w-8 h-8 rounded-full bg-navy-900 flex items-center justify-center text-white text-xs font-bold ring-2 ring-gray-100 cursor-pointer">
               AC
            </div>
         </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-10">
         <div className="flex items-center justify-between mb-12">
            <div>
               <h1 className="text-3xl font-serif text-gray-900 mb-2">Admin Console</h1>
               <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-gray-50 border border-gray-100 text-[10px] font-bold text-gray-400">
                    Acme Title LLC · 0x4182...49a
                  </div>
                  <VerifyBadge state="verified" className="scale-90" />
               </div>
            </div>
            <div className="flex gap-3">
               <button className="px-5 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-all flex items-center gap-2">
                  <Download className="w-4 h-4 text-gray-400" /> Export Audit Log
               </button>
               <button className="px-5 py-2.5 bg-navy-900 text-white rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-navy-800 transition-all">
                  <Settings className="w-4 h-4" /> Global Settings
               </button>
            </div>
         </div>

         {/* Tabs */}
         <div className="flex items-center gap-8 border-b border-gray-100 mb-10 overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => (
               <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id)}
                 className={cn(
                    "pb-4 text-sm font-semibold transition-all relative",
                    activeTab === tab.id ? "text-navy-900" : "text-gray-400 hover:text-gray-600"
                 )}
               >
                  {tab.label}
                  {activeTab === tab.id && (
                     <motion.div 
                        layoutId="activeTab"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-navy-900"
                     />
                  )}
               </button>
            ))}
         </div>

         <div className="space-y-12">
            {activeTab === 'activity' && (
              <div className="space-y-12">
                 {/* Stats */}
                 <div className="grid grid-cols-5 gap-6">
                    {[
                      { label: 'Wires This Month', value: '142', trend: '+12%', icon: FileText },
                      { label: 'Bilateral Signed', value: '19', trend: '+2', icon: Shield },
                      { label: 'Pending Cosigns', value: '3', trend: '-1', icon: Clock },
                      { label: 'Verifications Served', value: '1,280', trend: '+24%', icon: ShieldCheck },
                      { label: 'Active Sessions', value: '7', trend: 'Live', icon: Activity, pulse: true },
                    ].map((stat, i) => (
                      <div key={i} className="p-6 rounded-xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow">
                         <div className="flex justify-between items-start mb-4">
                            <div className="p-2 rounded-lg bg-gray-50">
                               <stat.icon className={cn("w-5 h-5 text-gray-500", stat.pulse && "animate-pulse text-proof-amber-600")} />
                            </div>
                            <div className="flex items-center gap-1 text-[11px] font-bold text-proof-green-600">
                               {stat.trend !== 'Live' && <TrendingUp className="w-3 h-3" />} {stat.trend}
                            </div>
                         </div>
                         <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1 leading-tight">{stat.label}</div>
                         <div className="text-2xl font-serif text-gray-900">{stat.value}</div>
                      </div>
                    ))}
                 </div>

                 <div className="grid grid-cols-3 gap-8">
                    {/* Recent Activity Table */}
                    <div className="col-span-2">
                       <div className="flex items-center justify-between mb-6">
                          <h2 className="text-lg font-semibold flex items-center gap-2">
                             <HistoryIcon className="w-5 h-5 text-gray-400" /> Recent Verification Activity
                          </h2>
                          <button className="text-sm font-medium text-proof-blue-600 hover:underline">View All</button>
                       </div>
                       <div className="border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm">
                          <table className="w-full text-left">
                             <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                   <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Transaction</th>
                                   <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Counterparty</th>
                                   <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Amount</th>
                                   <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</th>
                                   <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Action</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-gray-50">
                                {[
                                  { title: 'Closing 123 Main St', party: 'Sarah & John Smith', amount: '$400,000.00', state: 'verified' },
                                  { title: 'Escrow #82194', party: 'Scotiabank', amount: '$1.2M', state: 'bilateral' },
                                  { title: 'Vendor Payout', party: 'Acme Supplies LLC', amount: '$15,400.00', state: 'pending' },
                                  { title: 'Fraudulent Entry', party: 'Unknown', amount: '$99,000.00', state: 'rejected' },
                                  { title: 'Office Lease', party: 'Metro Realty', amount: '$8,000.00', state: 'verified' },
                                ].map((tx, idx) => (
                                   <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                      <td className="px-6 py-4">
                                         <div className="text-sm font-semibold text-gray-900">{tx.title}</div>
                                         <div className="text-[10px] font-mono text-gray-400 mt-0.5">SEQ_9428_0{idx}</div>
                                      </td>
                                      <td className="px-6 py-4 text-sm font-medium text-gray-500">{tx.party}</td>
                                      <td className="px-6 py-4 text-sm font-mono text-gray-900">{tx.amount}</td>
                                      <td className="px-6 py-4">
                                         <VerifyBadge state={tx.state as any} className="scale-75 origin-left" />
                                      </td>
                                      <td className="px-6 py-4 text-right">
                                         <button className="p-1.5 hover:bg-gray-100 rounded transition-colors">
                                            <ArrowUpRight className="w-4 h-4 text-gray-400 hover:text-gray-900" />
                                         </button>
                                      </td>
                                   </tr>
                                ))}
                             </tbody>
                          </table>
                       </div>
                    </div>

                    {/* Side Column */}
                    <div className="space-y-8">
                       <div>
                          <div className="flex items-center justify-between mb-4">
                             <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400 flex items-center gap-2">
                                <Users className="w-4 h-4" /> Key Signers
                             </h2>
                          </div>
                          <div className="space-y-2">
                             {demoData.officers.slice(0, 3).map((o) => (
                                <SignerChip 
                                  key={o.id} 
                                  name={o.name} 
                                  role={o.role} 
                                  deviceId={o.name === 'Alice Park' ? "Alice's MacBook · Touch ID" : o.name === 'Bob Rivera' ? "Bob's YubiKey 5C" : "Diane's iPhone · Face ID"} 
                                  verified={true} 
                                />
                             ))}
                          </div>
                       </div>
                       <div className="p-6 rounded-xl bg-gray-50 border border-gray-100">
                          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                             <Shield className="w-4 h-4" /> System Health
                          </h3>
                          <div className="space-y-4">
                             <div className="flex justify-between items-center text-xs">
                                <span className="text-gray-500">Extensions Active</span>
                                <span className="text-proof-green-600 font-bold">12/12</span>
                             </div>
                             <div className="flex justify-between items-center text-xs">
                                <span className="text-gray-500">Registry Latency</span>
                                <span className="text-gray-900 font-bold font-mono">14ms</span>
                             </div>
                          </div>
                       </div>
                    </div>
                 </div>
              </div>
            )}

            {activeTab === 'sessions' && <AdminSessionsTab />}

            {activeTab !== 'activity' && activeTab !== 'sessions' && (
              <div className="py-20 flex flex-col items-center text-center max-w-md mx-auto">
                 <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 mb-6 font-serif text-2xl italic">
                    {activeTab.charAt(0).toUpperCase()}
                 </div>
                 <h2 className="text-xl font-serif text-gray-900 mb-2">Coming soon</h2>
                 <p className="text-sm text-gray-500 italic">
                    This tab is currently being built in the ProofLine core. Check back shortly.
                 </p>
              </div>
            )}
         </div>
      </main>
    </div>
  );
};
