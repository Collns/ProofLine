/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { MarketingLanding } from './surfaces/MarketingLanding';
import { PublicVerifyPage } from './surfaces/PublicVerifyPage';
import { OnboardingWizard } from './surfaces/OnboardingWizard';
import { AdminConsole } from './surfaces/AdminConsole';
import { PopupSessionStart } from './surfaces/PopupSessionStart';
import { PopupSignSilent } from './surfaces/PopupSignSilent';
import { PopupCosign } from './surfaces/PopupCosign';
import { ExtensionGmailCompose } from './surfaces/ExtensionGmailCompose';
import { ExtensionOutlookCompose } from './surfaces/ExtensionOutlookCompose';
import { ExtensionGmailInbound } from './surfaces/ExtensionGmailInbound';
import { ExtensionOutlookInbound } from './surfaces/ExtensionOutlookInbound';
import { ExtensionVerificationPanel } from './surfaces/ExtensionVerificationPanel';
import { TransactionalEmail } from './surfaces/EmailSurfaces';
import { AdminApp } from './surfaces/AdminApp';
import { EmailGmailContext } from './surfaces/EmailGmailContext';
import { EmailOutlookContext } from './surfaces/EmailOutlookContext';
import { EmailGmailAddon } from './surfaces/EmailGmailAddon';
import { AdminSigningPolicy } from './surfaces/AdminSigningPolicy';
import { cn } from './lib/tokens';
import { 
  LayoutGrid, 
  Globe, 
  Shield, 
  Terminal, 
  Mail, 
  Settings, 
  Plus, 
  Key, 
  Link as LinkIcon, 
  Command, 
  Cpu, 
  Fingerprint, 
  Zap, 
  Layers,
  Inbox,
  Box
} from 'lucide-react';

type SurfaceType = 
  | 'marketing' 
  | 'verify' 
  | 'onboarding' 
  | 'admin-console'
  | 'admin-policy'
  | 'popup-session'
  | 'popup-silent'
  | 'popup-cosign'
  | 'ext-gmail-compose'
  | 'ext-outlook-compose'
  | 'ext-gmail-inbound'
  | 'ext-outlook-inbound'
  | 'ext-panel'
  | 'email-gmail'
  | 'email-outlook'
  | 'email-addon'
  | 'admin'
  | 'email';

export default function App() {
  const [activeSurface, setActiveSurface] = React.useState<SurfaceType>('marketing');
  const [menuOpen, setMenuOpen] = React.useState(false);

  const surfaces = [
    { id: 'marketing', label: 'Landing', icon: Globe, desc: 'Public Dark Surface' },
    { id: 'verify', label: 'Verify', icon: Shield, desc: 'Public Verification' },
    { id: 'onboarding', label: 'Onboarding', icon: Terminal, desc: 'Setup Wizard' },
    { id: 'admin-console', label: 'Admin Console', icon: LayoutGrid, desc: 'Control Center' },
    { id: 'admin-policy', label: 'Policy Settings', icon: Cpu, desc: 'Signing Policy' },
    { id: 'popup-session', label: 'Start Session', icon: Key, desc: 'Biometric Popup' },
    { id: 'popup-silent', label: 'Silent Sign', icon: Zap, desc: 'Quick re-verify' },
    { id: 'popup-cosign', label: 'Popup Cosign', icon: LinkIcon, desc: 'Compact Ceremony' },
    { id: 'ext-gmail-compose', label: 'Gmail Compose', icon: Mail, desc: 'Extension Mock' },
    { id: 'ext-outlook-compose', label: 'Outlook Compose', icon: Mail, desc: 'Extension Mock' },
    { id: 'ext-gmail-inbound', label: 'Gmail Inbound', icon: Inbox, desc: 'Security Badges' },
    { id: 'ext-outlook-inbound', label: 'Outlook Inbound', icon: Inbox, desc: 'Security Badges' },
    { id: 'ext-panel', label: 'Verify Panel', icon: Layers, desc: 'Extension Sidebar' },
    { id: 'admin', label: 'Users & devices', icon: Settings, desc: 'Credential Mgt' },
    { id: 'email-gmail', label: 'Gmail Banner', icon: Box, desc: 'Context View' },
    { id: 'email-outlook', label: 'Outlook Pane', icon: Box, desc: 'Context View' },
  ];

  return (
    <div className="relative min-h-screen bg-gray-50">
      {/* Floating Demo Hub Toggle */}
      <div className="fixed bottom-8 right-8 z-[100]">
        <button 
          onClick={() => setMenuOpen(!menuOpen)}
          className={cn(
            "p-4 rounded-full shadow-2xl transition-all duration-300 ring-4",
            menuOpen 
              ? "bg-white text-gray-900 ring-gray-900/5 rotate-45" 
              : "bg-gray-900 text-white ring-white/10 hover:scale-110 active:scale-95"
          )}
        >
          <Plus className="w-6 h-6" />
        </button>

        {menuOpen && (
          <div className="absolute bottom-20 right-0 w-80 bg-white rounded-3xl shadow-2xl border border-gray-100 p-4 animate-in fade-in slide-in-from-bottom-5 duration-300">
             <div className="px-3 pt-2 pb-4 border-b border-gray-50 mb-3">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                   <LayoutGrid className="w-4 h-4 text-proof-blue-500" />
                   ProofLine Proto Hub
                </h3>
             </div>
             <div className="space-y-1">
                {surfaces.map((s) => (
                  <button 
                    key={s.id}
                    onClick={() => {
                      setActiveSurface(s.id as SurfaceType);
                      setMenuOpen(false);
                      window.scrollTo(0, 0);
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all",
                      activeSurface === s.id 
                        ? "bg-gray-900 text-white shadow-lg" 
                        : "hover:bg-gray-50 text-gray-500 hover:text-gray-900"
                    )}
                  >
                    <s.icon className={cn("w-5 h-5", activeSurface === s.id ? "" : "text-gray-400")} />
                    <div>
                       <div className="text-xs font-bold leading-none mb-1">{s.label}</div>
                       <div className={cn("text-[10px]", activeSurface === s.id ? "text-white/60" : "text-gray-400")}>{s.desc}</div>
                    </div>
                  </button>
                ))}
             </div>
          </div>
        )}
      </div>

      <div className="relative">
         {activeSurface === 'marketing' && <MarketingLanding />}
         {activeSurface === 'verify' && <PublicVerifyPage />}
         {activeSurface === 'onboarding' && <OnboardingWizard />}
         {activeSurface === 'admin-console' && <AdminConsole />}
         {activeSurface === 'admin-policy' && <AdminSigningPolicy />}
         {activeSurface === 'popup-session' && <PopupSessionStart onCancel={() => setActiveSurface('ext-gmail-compose')} onSuccess={() => setActiveSurface('ext-gmail-compose')} />}
         {activeSurface === 'popup-silent' && <PopupSignSilent onComplete={() => setActiveSurface('ext-gmail-compose')} />}
         {activeSurface === 'popup-cosign' && <PopupCosign />}
         {activeSurface === 'ext-gmail-compose' && <ExtensionGmailCompose />}
         {activeSurface === 'ext-outlook-compose' && <ExtensionOutlookCompose />}
         {activeSurface === 'ext-gmail-inbound' && <ExtensionGmailInbound />}
         {activeSurface === 'ext-outlook-inbound' && <ExtensionOutlookInbound />}
         {activeSurface === 'ext-panel' && <ExtensionVerificationPanel />}
         {activeSurface === 'email-gmail' && <EmailGmailContext />}
         {activeSurface === 'email-outlook' && <EmailOutlookContext />}
         {activeSurface === 'email-addon' && <EmailGmailAddon />}
         {activeSurface === 'admin' && <AdminApp />}
         {activeSurface === 'email' && <TransactionalEmail />}
      </div>
    </div>
  );
}

