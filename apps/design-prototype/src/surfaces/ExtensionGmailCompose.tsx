import * as React from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  Maximize2, 
  Minimize2, 
  Send, 
  Paperclip, 
  Link as LinkIcon, 
  Smile, 
  Image as ImageIcon,
  MoreVertical,
  Minus,
  Search,
  Settings,
  Menu,
  Inbox,
  Star,
  Clock,
  Send as SendIcon,
  File as FileIcon,
  Plus,
  ShieldCheck
} from 'lucide-react';
import { cn } from '../lib/tokens';
import { ExtensionToolbarButton } from '../components/ProofComponents';

const GmailComposeWindow: React.FC<{
  state: 'idle' | 'recipient' | 'session' | 'high-value';
  recipient?: string;
  countdown?: string;
}> = ({ state, recipient, countdown }) => {
  const getPillState = () => {
    if (state === 'idle') return 'idle';
    if (state === 'recipient') return 'navy';
    if (state === 'session') return 'amber';
    if (state === 'high-value') return 'high-value';
    return 'idle';
  };

  const getPillLabel = () => {
    if (state === 'idle') return 'ProofLine · sign on send';
    if (state === 'recipient') return 'ProofLine · will sign on send';
    if (state === 'session') return undefined; // uses countdown
    if (state === 'high-value') return 'Wire mode · always biometric';
    return 'ProofLine';
  };

  return (
    <div className="w-[512px] bg-white rounded-t-xl shadow-2xl border border-gray-200 flex flex-col font-sans overflow-hidden">
      {/* Gmail Window Header */}
      <div className="bg-[#f2f6fc] px-4 py-3 flex items-center justify-between">
         <span className="text-xs font-bold text-gray-700">New Message</span>
         <div className="flex items-center gap-2 text-gray-500">
            <Minus className="w-4 h-4 cursor-pointer hover:text-gray-900" />
            <Maximize2 className="w-3.5 h-3.5 cursor-pointer hover:text-gray-900" />
            <X className="w-4 h-4 cursor-pointer hover:text-gray-900" />
         </div>
      </div>

      <div className="flex-1 p-0 overflow-y-auto">
         <div className="px-5 py-3 border-b border-gray-50 flex items-baseline gap-3">
            <span className="text-sm text-gray-500 font-medium">To</span>
            <div className="flex-1 outline-none text-sm font-medium">
               {recipient ? (
                 <span className="bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200">
                   {recipient}
                 </span>
               ) : null}
            </div>
         </div>
         <div className="px-5 py-3 border-b border-gray-50 flex items-baseline gap-3">
            <span className="text-sm text-gray-500 font-medium">Subject</span>
            <div className="flex-1 outline-none text-sm font-medium">
               RE: Q3 Infrastructure Invoice · INV-9021
            </div>
         </div>
         <div className="px-5 py-8 text-sm text-gray-900 min-h-[180px] leading-relaxed">
            Hi Mark,<br/><br/>
            Attached is the revised invoice with the corrected routing number for the First National account.<br/><br/>
            Best,<br/>
            Sarah
         </div>

         {/* ProofLine Indicator Footer (Inside Body) */}
         <div className="px-5 py-3 border-t border-gray-50 flex items-center gap-2 text-[11px] font-bold text-gray-400 uppercase tracking-tight">
            {state === 'session' ? (
               <div className="flex items-center gap-1.5 text-proof-amber-600">
                 <ShieldCheck className="w-3.5 h-3.5" />
                 ✓ Will sign with Touch ID on send · session active {countdown}
               </div>
            ) : state === 'high-value' ? (
               <div className="flex items-center gap-1.5 text-navy-900">
                 <ShieldCheck className="w-3.5 h-3.5 text-proof-red-600" />
                 Will biometric-prompt on send · High-value override active
               </div>
            ) : (
               <div className="flex items-center gap-1.5 opacity-60">
                 <ShieldCheck className="w-3.5 h-3.5" />
                 Will biometric-prompt on send
               </div>
            )}
         </div>
      </div>

      {/* Gmail Toolbar */}
      <div className="px-4 py-4 flex items-center justify-between border-t border-gray-100 bg-white">
         <div className="flex items-center gap-1">
            <button className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm transition-all",
               state === 'high-value' ? "bg-proof-red-600 text-white" : "bg-[#0b57d0] text-white hover:bg-[#0842a0]"
            )}>
               {state === 'high-value' ? 'Sign & send with Touch ID' : 'Send'}
            </button>
            <div className="p-2.5 text-gray-500 hover:bg-gray-100 rounded-full cursor-pointer">
               <span className="text-xs font-bold text-gray-400">A</span>
            </div>
            <div className="p-2.5 text-gray-500 hover:bg-gray-100 rounded-full cursor-pointer">
               <Paperclip className="w-4 h-4" />
            </div>
            <div className="p-2.5 text-gray-500 hover:bg-gray-100 rounded-full cursor-pointer">
               <LinkIcon className="w-4 h-4" />
            </div>
            <div className="p-2.5 text-gray-500 hover:bg-gray-100 rounded-full cursor-pointer">
               <Smile className="w-4 h-4" />
            </div>
            {/* ProofLine Extension Button */}
            <div className="mx-2 flex items-center pr-2 border-r border-gray-200">
               <ExtensionToolbarButton 
                 state={getPillState()} 
                 label={getPillLabel()}
                 countdown={countdown}
               />
            </div>
         </div>
         <div className="flex items-center gap-1 text-gray-500">
            <MoreVertical className="w-4 h-4 cursor-pointer hover:bg-gray-100 rounded-full" />
            <div className="p-2 hover:bg-gray-100 rounded-full cursor-pointer">
               <FileIcon className="w-4 h-4" />
            </div>
         </div>
      </div>
    </div>
  );
};

export const ExtensionGmailCompose: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#f6f8fc] flex selection:bg-[#c2e7ff]">
      {/* Gmail Left Rail Simulation */}
      <aside className="w-64 flex flex-col pt-4 px-3 space-y-4">
         <button className="flex items-center gap-3 px-6 py-4 bg-[#c2e7ff] text-[#001d35] rounded-2xl font-bold shadow-sm transition-all hover:shadow-md mb-4">
            <Plus className="w-5 h-5" /> Compose
         </button>
         <nav className="flex flex-col gap-0.5">
            {[
               { icon: Inbox, label: 'Inbox', count: '1,280', active: true },
               { icon: Star, label: 'Starred', count: '', active: false },
               { icon: Clock, label: 'Snoozed', count: '', active: false },
               { icon: SendIcon, label: 'Sent', count: '', active: false },
               { icon: FileIcon, label: 'Drafts', count: '14', active: false },
            ].map(item => (
               <div key={item.label} className={cn(
                  "flex items-center justify-between px-6 py-2.5 rounded-pill text-sm cursor-pointer transition-all",
                  item.active ? "bg-[#d3e3fd] text-[#001d35] font-bold" : "text-gray-600 hover:bg-gray-100"
               )}>
                  <div className="flex items-center gap-4">
                     <item.icon className="w-4 h-4" /> {item.label}
                  </div>
                  <span className="text-xs opacity-60 tabular-nums">{item.count}</span>
               </div>
            ))}
         </nav>
      </aside>

      {/* Main Mail View Simulation */}
      <main className="flex-1 flex flex-col bg-white m-4 rounded-3xl overflow-hidden shadow-sm border border-gray-100">
         <header className="px-6 py-3 border-b border-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
               <Menu className="w-5 h-5 text-gray-500" />
               <div className="relative flex-1 max-w-2xl">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" placeholder="Search mail" className="w-full pl-12 pr-4 py-2 bg-[#f1f3f4] rounded-full outline-none" />
               </div>
            </div>
            <div className="flex items-center gap-4">
               <Settings className="w-5 h-5 text-gray-500" />
               <div className="w-8 h-8 rounded-full bg-navy-900" />
            </div>
         </header>
         <div className="p-8 space-y-4">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-4">ProofLine Extension Prototype · Gmail Web</div>
            <div className="space-y-40 py-20 overflow-y-auto">
               <div className="flex flex-col items-center gap-24">
                  <div className="space-y-2 text-center max-w-sm mx-auto">
                     <h2 className="text-xl font-serif text-gray-900 leading-tight">ProofLine Extension integrated into Gmail Web</h2>
                     <p className="text-xs text-gray-500 italic">Scroll down to see the 4 compose state variants.</p>
                  </div>

                  <div className="space-y-32 pb-32">
                     <div className="space-y-4">
                        <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest pl-2">State A: Idle, no recipient</span>
                        <GmailComposeWindow state="idle" />
                     </div>

                     <div className="space-y-4">
                        <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest pl-2">State B: Recipient typed, no session</span>
                        <GmailComposeWindow state="recipient" recipient="mark@scotiabank-vendor.com" />
                     </div>

                     <div className="space-y-4">
                        <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest pl-2">State C: Active session for Mark</span>
                        <GmailComposeWindow state="session" recipient="mark@scotiabank-vendor.com" countdown="12:34" />
                     </div>

                     <div className="space-y-4">
                        <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest pl-2">State D: High-value wire mode</span>
                        <GmailComposeWindow state="high-value" recipient="mark@scotiabank-vendor.com" />
                     </div>
                  </div>
               </div>
            </div>
         </div>
      </main>
    </div>
  );
};
