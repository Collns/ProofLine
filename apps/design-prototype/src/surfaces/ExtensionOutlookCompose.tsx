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
  Star as StarIcon,
  Clock,
  Send as SendIcon,
  File as FileIcon,
  Plus,
  ShieldCheck,
  ChevronDown,
  Trash2,
  Lock,
  Flag,
  Share2,
  Mail,
  Users
} from 'lucide-react';
import { cn } from '../lib/tokens';
import { ExtensionToolbarButton } from '../components/ProofComponents';

const OutlookComposeWindow: React.FC<{
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
    <div className="w-[640px] h-[520px] bg-white shadow-2xl border border-gray-200 flex flex-col font-sans overflow-hidden">
      {/* Outlook Ribbon Top Bar */}
      <div className="bg-[#f3f3f3] px-4 py-2 flex items-center gap-6 border-b border-gray-200">
         <div className="flex items-center gap-1">
            <button className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-all",
              state === 'high-value' ? "bg-proof-red-600 text-white" : "bg-[#0078d4] text-white hover:bg-[#005a9e]"
            )}>
               <SendIcon className="w-3.5 h-3.5" /> {state === 'high-value' ? 'Sign & Send' : 'Send'}
            </button>
            <button className="p-1 text-gray-500 hover:bg-gray-200 rounded">
               <ChevronDown className="w-4 h-4 cursor-pointer" />
            </button>
         </div>
         <div className="flex items-center gap-4 text-xs font-medium text-gray-700">
            <span className="flex items-center gap-1.5 hover:bg-gray-200 px-2 py-1.5 rounded cursor-pointer"><Trash2 className="w-4 h-4" /> Discard</span>
            <span className="flex items-center gap-1.5 hover:bg-gray-200 px-2 py-1.5 rounded cursor-pointer border border-transparent hover:border-gray-200"><Paperclip className="w-4 h-4" /> Attach</span>
            <span className="flex items-center gap-1.5 hover:bg-gray-200 px-2 py-1.5 rounded cursor-pointer border border-transparent hover:border-gray-200">Insert</span>
            <span className="flex items-center gap-1.5 hover:bg-gray-200 px-2 py-1.5 rounded cursor-pointer border border-transparent hover:border-gray-200">Options</span>
         </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
         <div className="flex items-center gap-4 border-b border-gray-100 pb-3">
            <span className="text-sm text-gray-500 font-medium w-12 shrink-0">To</span>
            <div className="flex-1 flex gap-2 overflow-x-auto py-1">
               {recipient ? (
                 <div className="flex items-center gap-2 bg-[#f3f2f1] pl-2 pr-1 py-1 rounded border border-gray-200 text-sm whitespace-nowrap">
                    Mark Lim <X className="w-3 h-3 text-gray-400 hover:text-gray-900 cursor-pointer" />
                 </div>
               ) : (
                 <input type="text" className="w-full outline-none text-sm" placeholder="Add recipients" />
               )}
            </div>
         </div>
         <div className="flex items-center gap-4 border-b border-gray-100 pb-3">
            <span className="text-sm text-gray-500 font-medium w-12 shrink-0">Cc</span>
            <input type="text" className="w-full outline-none text-sm" />
         </div>
         <div className="flex items-center gap-4 border-b border-gray-100 pb-3">
            <span className="text-sm text-gray-500 font-medium w-12 shrink-0">Add a subject</span>
            <div className="flex-1 text-sm font-semibold text-gray-900">
               RE: Q3 Infrastructure Invoice · INV-9021
            </div>
         </div>

         {/* Outlook Toolbar (Floating / Inline) */}
         <div className="flex items-center gap-3 py-1 bg-gray-50 px-3 rounded-lg border border-gray-100 w-fit">
            <div className="flex items-center gap-2 border-r border-gray-200 pr-3">
               <ExtensionToolbarButton 
                 state={getPillState()} 
                 label={getPillLabel()}
                 countdown={countdown}
               />
            </div>
            <div className="flex items-center gap-2 text-gray-400">
               <Smile className="w-4 h-4 cursor-pointer hover:text-gray-900" />
               <ImageIcon className="w-4 h-4 cursor-pointer hover:text-gray-900" />
               <LinkIcon className="w-4 h-4 cursor-pointer hover:text-gray-900" />
            </div>
         </div>

         <div className="flex-1 text-sm text-gray-900 pt-4 leading-relaxed min-h-[160px]">
            Hi Mark,<br/><br/>
            Attached is the revised invoice with the corrected routing number for the First National account.<br/><br/>
            Best,<br/>
            Sarah
         </div>

         {/* ProofLine Indicator Footer (Inside Body) */}
         <div className="py-4 border-t border-gray-50 flex items-center justify-between text-[11px] font-bold text-gray-400 uppercase tracking-tight">
            {state === 'session' ? (
               <div className="flex items-center gap-1.5 text-proof-amber-600">
                 <ShieldCheck className="w-3.5 h-3.5" />
                 ✓ Will sign with Windows Hello on send · session active {countdown}
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
            <div className="flex items-center gap-1.5 opacity-40">
               <Lock className="w-3 h-3" /> Encrypted Payload Active
            </div>
         </div>
      </div>
    </div>
  );
};

export const ExtensionOutlookCompose: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#faf9f8] flex flex-col selection:bg-[#cde6f7]">
      {/* Outlook Top Ribbon Simulation */}
      <header className="h-12 bg-[#0078d4] flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-6">
             <Menu className="w-5 h-5 text-white" />
             <span className="text-white font-bold tracking-tight">Outlook</span>
             <div className="relative w-[480px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0078d4]" />
                <input type="text" placeholder="Search" className="w-full pl-10 pr-4 py-1.5 bg-white rounded text-sm placeholder:text-gray-400 outline-none" />
             </div>
          </div>
          <div className="flex items-center gap-4 text-white">
             <Settings className="w-5 h-5" />
             <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">AC</div>
          </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
         {/* Outlook Sidebar Simulation */}
         <aside className="w-12 bg-[#f3f2f1] flex flex-col items-center py-4 gap-4 border-r border-gray-200">
            <Mail className="w-5 h-5 text-[#0078d4]" />
            <Clock className="w-5 h-5 text-gray-500" />
            <Users className="w-5 h-5 text-gray-500" />
            <FileIcon className="w-5 h-5 text-gray-500" />
         </aside>

         {/* Outlook List Rail Simulation */}
         <aside className="w-80 bg-white flex flex-col border-r border-gray-200">
            <div className="p-4 flex flex-col gap-4">
               <button className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0078d4] text-white rounded text-sm font-semibold shadow hover:bg-[#005a9e] transition-all">
                  <Plus className="w-4 h-4" /> New Message
               </button>
               <nav className="flex flex-col gap-1">
                  <div className="flex items-center gap-3 px-3 py-2 bg-[#f3f2f1] text-[#0078d4] rounded text-sm font-bold">
                     <Inbox className="w-4 h-4" /> Inbox
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2 text-gray-600 rounded text-sm font-medium hover:bg-gray-50">
                     <SendIcon className="w-4 h-4" /> Sent Items
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 text-gray-600 rounded text-sm font-medium hover:bg-gray-50">
                     <div className="flex items-center gap-3"><FileIcon className="w-4 h-4" /> Drafts</div>
                     <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded font-bold">14</span>
                  </div>
               </nav>
            </div>
         </aside>

         {/* Main Reading Pane Simulation */}
         <main className="flex-1 flex flex-col bg-white overflow-y-auto">
            <div className="p-12 space-y-32 flex flex-col items-center">
               <div className="text-center space-y-4">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">ProofLine Extension Prototype · Outlook Web</div>
                  <h2 className="text-2xl font-serif text-gray-900">Outlook Web Extension Injection</h2>
                  <p className="text-sm text-gray-500 italic max-w-sm mx-auto">Outlook uses taller buttons and a ribbon-based UI. Respect the host chrome while keeping the ProofLine pill clear.</p>
               </div>

               <div className="space-y-40 pb-40">
                  <div className="space-y-4">
                     <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest pl-2">State A: Idle</span>
                     <OutlookComposeWindow state="idle" />
                  </div>

                  <div className="space-y-4">
                     <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest pl-2">State B: Will sign on send</span>
                     <OutlookComposeWindow state="recipient" recipient="mark@scotiabank-vendor.com" />
                  </div>

                  <div className="space-y-4">
                     <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest pl-2">State C: Active Session · 12:34</span>
                     <OutlookComposeWindow state="session" recipient="mark@scotiabank-vendor.com" countdown="12:34" />
                  </div>

                  <div className="space-y-4">
                     <span className="text-[10px] uppercase font-bold text-gray-400 tracking-widest pl-2">State D: High-Value override ($100k+)</span>
                     <OutlookComposeWindow state="high-value" recipient="mark@scotiabank-vendor.com" />
                  </div>
               </div>
            </div>
         </main>
      </div>
    </div>
  );
};
