import * as React from 'react';
import { 
  Menu, 
  Search, 
  Settings, 
  Grid,
  Mail,
  Calendar,
  Users,
  Files as FilesIcon,
  CheckSquare,
  Archive,
  Trash2,
  Reply,
  Flag,
  Share2,
  MoreHorizontal,
  ChevronDown,
  User,
  ShieldCheck,
  Star,
  Forward,
  ChevronRight
} from 'lucide-react';
import { EmailPluginBanner } from './EmailSurfaces';
import { cn } from '../lib/tokens';

export const EmailOutlookContext: React.FC = () => {
  const [state, setState] = React.useState<'verified' | 'bilateral' | 'unverified' | 'tampered'>('verified');

  return (
    <div className="min-h-screen bg-[#f3f3f3] flex flex-col font-sans text-[13px] text-[#323130] selection:bg-[#c7e0f4] selection:text-[#323130]">
      {/* Top Banner (Outlook Ribbon Area) */}
      <header className="h-12 bg-[#0078d4] text-white flex items-center justify-between pl-4 pr-3">
         <div className="flex items-center gap-6">
            <Menu className="w-5 h-5 cursor-pointer" />
            <span className="font-semibold text-lg">Outlook</span>
            <div className="flex-1 max-w-xl mx-4">
               <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0078d4]" />
                  <input 
                    type="text" 
                    placeholder="Search" 
                    className="w-full bg-white py-1.5 pl-10 pr-4 rounded text-black outline-none"
                  />
               </div>
            </div>
         </div>
         <div className="flex items-center gap-4">
            <Settings className="w-5 h-5 cursor-pointer" />
            <MoreHorizontal className="w-5 h-5 cursor-pointer" />
            <div className="w-8 h-8 rounded-full bg-navy-500 border border-white/20 flex items-center justify-center text-xs font-bold">BR</div>
         </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
         {/* Left App Rail */}
         <aside className="w-12 bg-[#f3f3f3] border-r border-[#edebe9] flex flex-col items-center pt-4 gap-6">
            <Mail className="w-6 h-6 text-[#0078d4]" strokeWidth={2.5} />
            <Calendar className="w-5 h-5 text-[#605e5c]" />
            <Users className="w-5 h-5 text-[#605e5c]" />
            <FilesIcon className="w-5 h-5 text-[#605e5c]" />
            <CheckSquare className="w-5 h-5 text-[#605e5c]" />
         </aside>

         {/* Folder List */}
         <aside className="w-56 bg-white border-r border-[#edebe9] p-4 flex flex-col">
            <button className="w-full py-2 mb-4 bg-white border border-[#0078d4] text-[#0078d4] font-semibold rounded hover:bg-[#c7e0f4] transition-colors">
               New message
            </button>
            <div className="space-y-4">
               <div className="flex items-center justify-between text-[#0078d4] font-bold">
                  <div className="flex items-center gap-3"><ChevronDown className="w-3 h-3"/> Favorites</div>
               </div>
               <div className="ml-6 space-y-2 text-[#605e5c]">
                  <div className="font-semibold text-[#0078d4] bg-[#f3f2f1] -ml-6 pl-6 py-1">Inbox</div>
                  <div>Sent Items</div>
                  <div>Drafts</div>
                  <div>Deleted Items</div>
               </div>
            </div>
         </aside>

         {/* Message List */}
         <aside className="w-72 bg-white border-r border-[#edebe9] overflow-y-auto">
            <div className="h-10 px-4 border-b border-[#edebe9] flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[#605e5c]">
               <span>Focused</span>
               <span>Other</span>
            </div>
            <div className="divide-y divide-[#edebe9]">
               {[
                 { from: 'Bob Rivera', sub: 'Co-sign request: $400,000...', active: true },
                 { from: 'Sarah Chen', sub: 'Updated account details...', active: false },
                 { from: 'Acme Support', sub: 'Onboarding completed...', active: false },
               ].map((m, i) => (
                  <div key={i} className={cn("p-4 flex gap-3 cursor-pointer", m.active ? "bg-[#f3f2f1] shadow-[inset_3px_0_0_#0078d4]" : "hover:bg-gray-50")}>
                     <div className="w-8 h-8 rounded-full bg-[#f3f2f1] border border-[#edebe9] flex items-center justify-center text-xs font-bold text-[#605e5c]">
                        {m.from.charAt(0)}
                     </div>
                     <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline">
                           <span className={cn("truncate font-semibold", m.active ? "text-black" : "text-[#323130]")}>{m.from}</span>
                           <span className="text-[10px] text-[#605e5c]">9:42 PM</span>
                        </div>
                        <div className="text-[12px] truncate text-[#605e5c]">{m.sub}</div>
                        <div className="flex gap-2 mt-1">
                           <Star className="w-3 h-3 text-[#605e5c] " />
                           <Flag className="w-3 h-3 text-[#605e5c] " />
                        </div>
                     </div>
                  </div>
               ))}
            </div>
         </aside>

         {/* Reading Pane */}
         <main className="flex-1 flex flex-col bg-white overflow-hidden">
            {/* Outlook Toolbar */}
            <div className="h-12 px-4 border-b border-[#edebe9] flex items-center justify-between text-[#605e5c]">
               <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2 cursor-pointer hover:text-[#323130]">
                     <Reply className="w-4 h-4" /> <span className="font-semibold">Reply</span>
                  </div>
                  <div className="flex items-center gap-2 cursor-pointer hover:text-[#323130]">
                     <Forward className="w-4 h-4" /> <span className="font-semibold">Forward</span>
                  </div>
                  <div className="flex items-center gap-2 cursor-pointer hover:text-[#323130]">
                     <Archive className="w-4 h-4" /> <span className="font-semibold">Archive</span>
                  </div>
                  <div className="flex items-center gap-2 cursor-pointer hover:text-[#323130]">
                     <Trash2 className="w-4 h-4" /> <span className="font-semibold">Delete</span>
                  </div>
               </div>
               <div className="flex items-center gap-4">
                  <Share2 className="w-4 h-4" />
                  <MoreHorizontal className="w-4 h-4" />
               </div>
            </div>

            {/* Email Title Area */}
            <div className="p-8">
               <h1 className="text-xl font-bold text-[#323130] mb-6">Co-sign request: $400,000 wire (escrow #82194)</h1>
               
               <div className="flex items-center gap-4 mb-8">
                  <div className="w-10 h-10 rounded-full bg-[#f3f2f1] flex items-center justify-center text-[#605e5c] font-bold border border-[#edebe9]">BR</div>
                  <div className="flex-1">
                     <div className="font-bold text-[#323130]">Bob Rivera</div>
                     <div className="text-xs text-[#605e5c]">Sat 5/9/2026 9:42 PM</div>
                     <div className="text-xs mt-0.5">To: Alice Park</div>
                  </div>
               </div>

               {/* PROOFLINE BANNER IN OUTLOOK READING PANE */}
               <div className="mb-8">
                  <EmailPluginBanner state={state} />
               </div>

               <div className="space-y-6 text-[#323130]">
                  <p>Alice,</p>
                  <p>
                     I've drafted the wire instruction for the Main St closing. It requires your second signature before we can anchor it to the ledger. 
                     Please review the details below and sign via the ProofLine mobile app or web dashboard.
                  </p>
                  
                  <div className="p-6 bg-[#f3f2f1] border border-[#edebe9] rounded space-y-4 max-w-sm">
                      <div className="flex items-center justify-between">
                         <ShieldCheck className="w-4 h-4 text-[#0078d4]" />
                         <span className="text-[10px] uppercase font-bold text-[#605e5c]">Encrypted Instruction</span>
                      </div>
                      <div>
                         <div className="text-xs text-[#605e5c]">Amount</div>
                         <div className="text-lg font-bold font-serif">$400,000.00</div>
                      </div>
                      <button className="w-full py-2 bg-[#0078d4] text-white font-bold rounded">View & Sign</button>
                  </div>

                  <p>Best,<br/>Bob</p>
               </div>
            </div>

            {/* State Switcher for Demo */}
            <div className="mt-auto p-3 bg-[#faf9f8] border-t border-[#edebe9] flex items-center gap-3 justify-center">
               <span className="text-[10px] font-bold text-[#a19f9d] uppercase">Outlook Demo Toggle:</span>
               {(['verified', 'bilateral', 'unverified', 'tampered'] as const).map(s => (
                 <button 
                   key={s}
                   onClick={() => setState(s)}
                   className={cn(
                     "px-3 py-1 rounded border text-[10px] font-bold uppercase transition-all shadow-sm",
                     state === s ? "bg-[#0078d4] text-white border-[#0078d4]" : "bg-white text-[#605e5c] border-[#edebe9]"
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
