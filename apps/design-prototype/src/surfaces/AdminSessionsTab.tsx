import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Clock, 
  Smartphone, 
  Monitor, 
  XOctagon, 
  Filter,
  CheckCircle2,
  AlertTriangle,
  History as HistoryIcon,
  Shield,
  ArrowRight
} from 'lucide-react';
import { cn } from '../lib/tokens';

interface SessionRow {
  id: string;
  user: string;
  userId: string;
  avatar: string;
  recipient: string;
  started: string;
  expires: string;
  device: 'mobile' | 'desktop';
  deviceName: string;
  state: 'active' | 'expiring' | 'expired';
}

const sessions: SessionRow[] = [
  { id: '1', user: 'Sarah Chen', userId: 'sarah', avatar: 'SC', recipient: 'Mark Lim', started: '12:04 PM', expires: '08:42', device: 'mobile', deviceName: "Sarah's iPhone · Face ID", state: 'active' },
  { id: '2', user: 'Bob Rivera', userId: 'bob', avatar: 'BR', recipient: 'Jane Cooper', started: '11:58 AM', expires: '24:15', device: 'desktop', deviceName: "Bob's MacBook · Touch ID", state: 'active' },
  { id: '3', user: 'Diane Greer', userId: 'diane', avatar: 'DG', recipient: 'Acme Vendor', started: '12:12 PM', expires: '01:42', device: 'mobile', deviceName: "Diane's iPhone · Face ID", state: 'expiring' },
  { id: '4', user: 'Alice Park', userId: 'alice', avatar: 'AP', recipient: 'Scotiabank', started: '11:30 AM', expires: '00:00', device: 'desktop', deviceName: "Alice's PC · Hello", state: 'expired' },
  { id: '5', user: 'Sarah Chen', userId: 'sarah', avatar: 'SC', recipient: 'Legal Council', started: '10:45 AM', expires: '00:00', device: 'mobile', deviceName: "Sarah's iPhone · Face ID", state: 'expired' },
  { id: '6', user: 'Mark Lim', userId: 'mark', avatar: 'ML', recipient: 'Contractor', started: '12:15 PM', expires: '14:59', device: 'desktop', deviceName: "Mark's Laptop · YubiKey", state: 'active' },
];

const getUserColor = (userId: string) => {
  const colors = [
    'bg-[#001d35]', // navy-700
    'bg-[#0d9488]', // teal-600
    'bg-[#047857]', // emerald-700
    'bg-[#b45309]', // amber-700
    'bg-[#2563eb]'  // blue-600
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

export const AdminSessionsTab: React.FC = () => {
  const [filter, setFilter] = React.useState('all');
  const [showRevoke, setShowRevoke] = React.useState<SessionRow | null>(null);

  const filteredSessions = sessions.filter(s => {
    if (filter === 'all') return true;
    return s.state === filter;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
         <div>
            <h2 className="text-xl font-serif text-gray-900 mb-1">Active Signing Sessions</h2>
            <p className="text-sm text-gray-500">Real-time status of teammate passkey sessions scoped to recipients.</p>
         </div>
         <div className="flex items-center gap-2">
            {[
              { id: 'all', label: 'All' },
              { id: 'active', label: 'Active' },
              { id: 'expiring', label: 'Expiring' },
              { id: 'expired', label: 'Expired' },
            ].map(f => (
               <button
                 key={f.id}
                 onClick={() => setFilter(f.id)}
                 className={cn(
                    "px-4 py-1.5 rounded-full text-xs font-bold transition-all border",
                    filter === f.id 
                      ? "bg-navy-900 border-navy-900 text-white shadow-md shadow-navy-900/10" 
                      : "bg-white border-gray-100 text-gray-400 hover:border-gray-200"
                 )}
               >
                  {f.label}
               </button>
            ))}
         </div>
      </div>

      <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white shadow-sm">
         <table className="w-full text-left">
            <thead>
               <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">User</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Recipient</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Started</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Expires</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Device</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Action</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
               {filteredSessions.map((session) => (
                  <tr key={session.id} className={cn(
                    "group hover:bg-gray-50/50 transition-colors",
                    session.state === 'expired' ? "text-gray-500" : "text-gray-900"
                  )}>
                     <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                           <div className={cn(
                             "w-6 h-6 rounded-full text-white flex items-center justify-center text-[8px] font-bold ring-2 ring-gray-50 shrink-0",
                             getUserColor(session.userId)
                           )}>
                               {session.avatar}
                           </div>
                           <span className={cn(
                             "text-sm font-semibold",
                             session.state === 'expired' ? "text-gray-400" : "text-gray-900"
                           )}>{session.user}</span>
                        </div>
                     </td>
                     <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                           <Users className={cn("w-3.5 h-3.5", session.state === 'expired' ? "text-gray-200" : "text-gray-300")} />
                           <span className={cn(
                             "text-sm font-medium",
                             session.state === 'expired' ? "text-gray-400" : "text-gray-500"
                           )}>{session.recipient}</span>
                        </div>
                     </td>
                     <td className="px-6 py-4 text-xs text-gray-400 font-medium">
                        {session.started}
                     </td>
                     <td className="px-6 py-4">
                        <div className={cn(
                          "flex items-center gap-2 font-mono text-xs font-bold tabular-nums",
                          session.state === 'active' ? "text-navy-900" :
                          session.state === 'expiring' ? "text-proof-amber-600 animate-pulse" :
                          "text-gray-300"
                        )}>
                           <Clock className="w-3.5 h-3.5" />
                           {session.state === 'expired' ? "—" : session.expires}
                        </div>
                     </td>
                     <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                           {session.device === 'mobile' ? (
                              <Smartphone className="w-4 h-4 shrink-0" />
                           ) : (
                              <Monitor className="w-4 h-4 shrink-0" />
                           )}
                           <span className={session.state === 'expired' ? "text-gray-300" : ""}>{session.deviceName}</span>
                        </div>
                     </td>
                     <td className="px-6 py-4 text-right">
                        {session.state !== 'expired' ? (
                          <button 
                            onClick={() => setShowRevoke(session)}
                            className="text-[10px] font-bold text-gray-400 uppercase tracking-widest hover:text-proof-red-600 transition-colors opacity-0 group-hover:opacity-100"
                          >
                             Revoke
                          </button>
                        ) : (
                           <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">Released</span>
                        )}
                     </td>
                  </tr>
               ))}

               {filteredSessions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-24 text-center">
                       <Filter className="w-12 h-12 text-gray-100 mx-auto mb-4" />
                       <h3 className="text-gray-900 font-semibold">No {filter} sessions found</h3>
                       <p className="text-sm text-gray-400">Sessions appear here when teammates compose signed emails.</p>
                    </td>
                  </tr>
               )}
            </tbody>
         </table>
      </div>

      <div className="flex items-start justify-between gap-8">
         <div className="flex-1 p-6 rounded-2xl bg-gray-50 border border-gray-100">
            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-6 flex items-center gap-2">
               <Shield className="w-4 h-4" /> Session policy
            </h3>
            <div className="grid grid-cols-3 gap-8">
               <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Default TTL</div>
                  <div className="text-lg font-mono font-bold text-gray-900 leading-none">15 min</div>
               </div>
               <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Hard cap</div>
                  <div className="text-lg font-mono font-bold text-gray-900 leading-none">60 min</div>
               </div>
               <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">High-value override</div>
                  <div className="text-xs font-semibold text-gray-900 leading-tight">
                     $50,000+ always biometric
                  </div>
               </div>
            </div>
            <div className="mt-8 pt-6 border-t border-gray-200/50">
               <button className="text-xs font-bold text-proof-blue-600 hover:underline flex items-center gap-1.5">
                  Adjust in signing policy <ArrowRight className="w-3.5 h-3.5" />
               </button>
            </div>
         </div>

         <div className="w-72 p-5 rounded-2xl bg-white border border-gray-100 flex items-start gap-4">
            <AlertTriangle className="w-5 h-5 text-gray-300 mt-0.5 shrink-0" />
            <p className="text-[11px] text-gray-500 leading-relaxed italic">
               Revoking a session is instantaneous. The ProofLine extension will force a biometric prompt on the next signed email.
            </p>
         </div>
      </div>

      {/* Revoke Modal */}
      <AnimatePresence>
        {showRevoke && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-navy-900/40 backdrop-blur-sm">
              <motion.div 
                 initial={{ scale: 0.9, opacity: 0 }}
                 animate={{ scale: 1, opacity: 1 }}
                 exit={{ scale: 0.9, opacity: 0 }}
                 className="w-full max-w-sm bg-white rounded-2xl p-8 shadow-2xl text-center"
              >
                 <div className="w-16 h-16 rounded-full bg-proof-red-600/10 flex items-center justify-center text-proof-red-600 mx-auto mb-6">
                    <XOctagon className="w-8 h-8" />
                 </div>
                 <h3 className="text-xl font-serif text-gray-900 mb-2">Revoke Session?</h3>
                 <p className="text-sm text-gray-500 mb-8 leading-relaxed">
                    Revoke <span className="text-gray-900 font-bold">{showRevoke.user}'s</span> session with <span className="text-gray-900 font-bold">{showRevoke.recipient}</span>? 
                    She'll need to biometric-confirm before her next email to him.
                 </p>
                 <div className="flex gap-3">
                    <button 
                      onClick={() => setShowRevoke(null)}
                      className="flex-1 py-3 bg-gray-50 text-gray-500 rounded-xl font-bold hover:bg-gray-100 transition-all"
                    >
                       Cancel
                    </button>
                    <button 
                      onClick={() => setShowRevoke(null)}
                      className="flex-1 py-3 bg-proof-red-600 text-white rounded-xl font-bold border border-proof-red-700 shadow-lg shadow-proof-red-600/20 hover:bg-proof-red-700 transition-all"
                    >
                       Confirm Revoke
                    </button>
                 </div>
              </motion.div>
           </div>
        )}
      </AnimatePresence>
    </div>
  );
};
