import * as React from 'react';
import { 
  Search, 
  Menu, 
  Settings, 
  Grid, 
  CircleUser, 
  Inbox, 
  Star, 
  Clock, 
  Send, 
  File as FileIcon, 
  ChevronDown,
  Archive,
  Trash2,
  ShieldAlert,
  Mail,
  MoreVertical,
  Reply,
  Square
} from 'lucide-react';
import { EmailPluginBanner } from './EmailSurfaces';
import { cn } from '../lib/tokens';

export const EmailGmailContext: React.FC = () => {
  const [state, setState] = React.useState<'verified' | 'bilateral' | 'unverified' | 'tampered'>('verified');

  return (
    <div className="min-h-screen bg-[#f6f8fc] flex flex-col font-sans text-sm selection:bg-[#c2e7ff] selection:text-black">
      {/* Top Bar */}
      <header className="h-16 px-4 py-2 flex items-center justify-between">
         <div className="flex items-center gap-4 min-w-[240px]">
            <button className="p-2 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
               <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
               <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center p-1 shadow-sm">
                  <Mail className="w-full h-full text-[#ea4335]" />
               </div>
               <span className="text-xl text-[#5f6368]">Gmail</span>
            </div>
         </div>
         <div className="flex-1 max-w-2xl mx-12">
            <div className="relative">
               <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
               <input 
                 type="text" 
                 placeholder="Search mail" 
                 className="w-full bg-[#eaf1fb] py-3 pl-12 pr-4 rounded-full border-none focus:bg-white focus:shadow-md outline-none transition-all"
               />
               <Settings className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            </div>
         </div>
         <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
               <Grid className="w-5 h-5" />
            </button>
            <CircleUser className="w-8 h-8 text-[#5f6368] cursor-pointer" />
         </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
         {/* Left Rail */}
         <aside className="w-64 flex flex-col px-4 pt-2">
            <button className="w-fit flex items-center gap-4 px-6 py-4 bg-[#c2e7ff] hover:shadow-md transition-shadow rounded-2xl mb-8">
               <span className="text-sm font-semibold">Compose</span>
            </button>
            <div className="space-y-1">
               <div className="flex items-center gap-4 px-3 py-2 bg-[#d3e3fd] rounded-full text-gray-900 font-bold">
                  <Inbox className="w-5 h-5" /> Inbox <span className="ml-auto text-xs font-bold">12</span>
               </div>
               <div className="flex items-center gap-4 px-3 py-2 hover:bg-gray-200 rounded-full text-gray-600">
                  <Star className="w-5 h-5" /> Starred
               </div>
               <div className="flex items-center gap-4 px-3 py-2 hover:bg-gray-200 rounded-full text-gray-600">
                  <Clock className="w-5 h-5" /> Snoozed
               </div>
               <div className="flex items-center gap-4 px-3 py-2 hover:bg-gray-200 rounded-full text-gray-600">
                  <Send className="w-5 h-5" /> Sent
               </div>
               <div className="flex items-center gap-4 px-3 py-2 hover:bg-gray-200 rounded-full text-gray-600">
                  <FileIcon className="w-5 h-5" /> Drafts
               </div>
               <div className="flex items-center gap-4 px-3 py-2 hover:bg-gray-200 rounded-full text-gray-600">
                  <ChevronDown className="w-5 h-5" /> More
               </div>
            </div>
         </aside>

         {/* Main Content */}
         <main className="flex-1 flex flex-col mr-4 mb-4 bg-white rounded-2xl overflow-hidden shadow-sm">
            {/* Toolbar */}
            <div className="h-12 px-4 flex items-center gap-6 border-b border-gray-100">
               <button className="text-gray-600 hover:bg-gray-100 p-2 rounded-full"><Archive className="w-4 h-4"/></button>
               <button className="text-gray-600 hover:bg-gray-100 p-2 rounded-full"><ShieldAlert className="w-4 h-4"/></button>
               <button className="text-gray-600 hover:bg-gray-100 p-2 rounded-full"><Trash2 className="w-4 h-4"/></button>
               <div className="w-px h-6 bg-gray-200 mx-1" />
               <button className="text-gray-600 hover:bg-gray-100 p-2 rounded-full"><Reply className="w-4 h-4"/></button>
               <button className="text-gray-600 hover:bg-gray-100 p-2 rounded-full"><Square className="w-4 h-4 rotate-45"/></button>
               <button className="text-gray-600 hover:bg-gray-100 p-2 rounded-full"><MoreVertical className="w-4 h-4"/></button>
            </div>

            {/* Email Message */}
            <div className="flex-1 overflow-y-auto p-12">
               <div className="max-w-4xl">
                  <h1 className="text-2xl font-normal text-gray-900 mb-8">Co-sign request: $400,000 wire (escrow #82194)</h1>
                  
                  <div className="flex items-center gap-4 mb-8">
                     <div className="w-10 h-10 rounded-full bg-[#fcbc05] flex items-center justify-center text-white font-bold text-lg cursor-pointer">B</div>
                     <div className="flex-1">
                        <div className="flex items-center gap-2">
                           <span className="font-bold">Bob Rivera</span>
                           <span className="text-gray-500 text-xs">&lt;bob@acme-title.com&gt;</span>
                        </div>
                        <div className="text-gray-500 text-xs">to me</div>
                     </div>
                     <div className="text-gray-500 text-xs">9:42 PM (1 hour ago)</div>
                  </div>

                  {/* PROOFLINE BANNER IN CONTEXT */}
                  <div className="my-8">
                     <EmailPluginBanner state={state} />
                  </div>

                  <div className="space-y-6 text-[#202124] leading-relaxed">
                     <p>Alice,</p>
                     <p>
                        I've drafted the wire instruction for the Main St closing. It requires your second signature before we can anchor it to the ledger. 
                        Please review the details below and sign via the ProofLine mobile app or web dashboard.
                     </p>
                     <div className="py-4 font-mono text-xs text-gray-400 border-t border-gray-100">
                        ----- BEGIN SECURE PAYLOAD -----
                     </div>
                     <div className="bg-gray-50 p-6 rounded border border-gray-200 inline-block min-w-[300px]">
                        <div className="text-[10px] font-bold text-gray-400 mb-4 uppercase">Signed Wire Data</div>
                        <div className="space-y-4">
                           <div>
                              <div className="text-[9px] text-gray-400 font-bold uppercase">Amount</div>
                              <div className="text-xl font-serif">$400,000.00</div>
                           </div>
                           <div>
                              <div className="text-[9px] text-gray-400 font-bold uppercase">Account</div>
                              <div className="text-sm font-mono tracking-tighter">First Nat. ••••5678</div>
                           </div>
                        </div>
                     </div>
                     <p>Best regards,<br/>Bob</p>
                  </div>
               </div>
            </div>

            {/* State Switcher purely for Demo */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center gap-4 justify-center">
               <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Demo State:</span>
               {(['verified', 'bilateral', 'unverified', 'tampered'] as const).map(s => (
                 <button 
                   key={s}
                   onClick={() => setState(s)}
                   className={cn(
                     "px-3 py-1 rounded bg-white border border-gray-200 text-[10px] font-bold uppercase transition-all",
                     state === s ? "ring-2 ring-[#c2e7ff] text-proof-blue-500" : "text-gray-400 shadow-sm"
                   )}
                 >
                   {s}
                 </button>
               ))}
            </div>
         </main>
      </div>
    </div>
  );
};
