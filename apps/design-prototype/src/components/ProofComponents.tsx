import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Check, 
  CheckCheck, 
  Clock, 
  X, 
  Fingerprint, 
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Smartphone,
  Monitor,
  Key as KeyIcon,
  QrCode,
  ScanFace,
  Lock,
  ChevronRight as ChevronRightIcon
} from 'lucide-react';
import { cn } from '../lib/tokens';

// --- Types ---

export type VerificationState = 'verified' | 'bilateral' | 'pending' | 'rejected' | 'tampered';

interface VerifyBadgeProps {
  state: VerificationState;
  className?: string;
}

interface SignerChipProps {
  name: string;
  role: string;
  deviceId: string;
  verified?: boolean;
}

interface WirePayloadCardProps {
  amount: number;
  recipient: string;
  account: string;
  routing: string;
  purpose: string;
  isTampered?: boolean;
}

// --- Components ---

export const VerifyBadge: React.FC<VerifyBadgeProps> = ({ state, className }) => {
  const configs = {
    verified: { 
      icon: Check, 
      label: 'Verified', 
      color: 'text-proof-green-600', 
      bg: 'bg-proof-green-600/10' 
    },
    bilateral: { 
      icon: CheckCheck, 
      label: 'Bilateral', 
      color: 'text-proof-emerald-700', 
      bg: 'bg-proof-emerald-400/10' 
    },
    pending: { 
      icon: Clock, 
      label: 'Pending', 
      color: 'text-proof-amber-700', 
      bg: 'bg-proof-amber-500/10' 
    },
    rejected: { 
      icon: X, 
      label: 'Rejected', 
      color: 'text-proof-red-600', 
      bg: 'bg-proof-red-600/10' 
    },
    tampered: { 
      icon: AlertCircle, 
      label: 'Tampered', 
      color: 'text-proof-red-600', 
      bg: 'bg-proof-red-600/10' 
    }
  };

  const config = configs[state];
  const Icon = config.icon;

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill text-xs font-medium border border-transparent transition-colors',
      config.bg,
      config.color,
      className
    )}>
      <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
      <span>{config.label}</span>
      <div className={cn('w-1.5 h-1.5 rounded-full bg-current opacity-80')} />
    </div>
  );
};

export const SignerChip: React.FC<SignerChipProps> = ({ name, role, deviceId, verified }) => (
  <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
    <div className="w-10 h-10 rounded-full bg-navy-700 flex items-center justify-center text-white font-medium text-sm overflow-hidden">
       {name.charAt(0)}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-gray-900 truncate">{name}</span>
        {verified && <Check className="w-3 h-3 text-proof-green-600" strokeWidth={3} />}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-gray-500">
        <span className="font-medium">{role}</span>
        <span className="w-1 h-1 rounded-full bg-gray-300" />
        <span className="font-mono">{deviceId}</span>
      </div>
    </div>
  </div>
);

export const WirePayloadCard: React.FC<WirePayloadCardProps> = ({ 
  amount, recipient, account, routing, purpose, isTampered 
}) => (
  <div className={cn(
    "p-6 rounded-lg border bg-white shadow-sm",
    isTampered ? "border-proof-red-600 bg-proof-red-600/5" : "border-gray-200"
  )}>
    <div className="flex flex-col gap-1 mb-6">
      <span className="text-sm font-medium text-gray-500 font-sans">Payment Amount</span>
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-serif text-gray-900">
          ${amount.toLocaleString()}
        </span>
        <span className="text-lg font-sans text-gray-400 font-medium tracking-tight">USD</span>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-y-6 gap-x-4">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Recipient Bank</span>
        <span className="text-sm font-medium text-gray-900">{recipient}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 text-right">Routing Number</span>
        <span className="text-sm font-mono text-gray-900 text-right">{routing}</span>
      </div>
      <div className="flex flex-col gap-1 col-span-2 pt-4 border-t border-gray-50">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Account Number</span>
        <div className="flex items-center justify-between">
            <span className={cn(
              "text-sm font-mono",
              isTampered ? "text-proof-red-600 font-bold" : "text-gray-900"
            )}>{account}</span>
            {isTampered && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-proof-red-600 text-white text-[10px] font-bold">
                 <AlertCircle className="w-3 h-3" />
                 TAMPERED
              </div>
            )}
        </div>
      </div>
      <div className="flex flex-col gap-1 col-span-2 pt-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 font-mono">Reference</span>
        <span className="text-xs text-gray-600 italic font-serif leading-relaxed line-clamp-2">
           “{purpose}”
        </span>
      </div>
    </div>
  </div>
);

export const AuthorityMeter: React.FC<{ value: number; limit: number }> = ({ value, limit }) => {
  const percentage = Math.min((value / limit) * 100, 100);
  const isOver = value > limit;

  return (
    <div className="p-4 rounded-lg bg-proof-amber-500/5 border border-proof-amber-500/20">
      <div className="flex justify-between items-center mb-2">
         <span className="text-xs font-semibold text-proof-amber-700">Authority Meter</span>
         <span className="text-[10px] font-mono font-medium text-proof-amber-700">
           {value > limit ? "LIMIT EXCEEDED" : `${percentage.toFixed(0)}% Utilized`}
         </span>
      </div>
      <div className="h-1.5 w-full bg-proof-amber-500/10 rounded-full overflow-hidden">
        <motion.div 
           initial={{ width: 0 }}
           animate={{ width: `${percentage}%` }}
           transition={{ duration: 0.8, ease: "easeOut" }}
           className={cn("h-full", isOver ? "bg-proof-red-500" : "bg-proof-amber-500")}
        />
      </div>
      <div className="mt-2 text-[10px] text-proof-amber-700 flex justify-between">
         <span>Signer limit: ${limit.toLocaleString()}</span>
         <span>Request: ${value.toLocaleString()}</span>
      </div>
    </div>
  );
};

export const AnchorReceipt: React.FC<{ network: string; block: string; txHash: string }> = ({ network, block, txHash }) => (
  <div className="p-4 rounded-lg bg-gray-900 border border-white/5 text-white/50 font-mono text-[10px]">
    <div className="flex items-center gap-2 mb-2">
       <ShieldCheck className="w-3 h-3 text-proof-green-600" />
       <span className="text-white font-medium">On-chain Anchor</span>
    </div>
    <div className="space-y-1">
      <div className="flex justify-between">
        <span>Network</span>
        <span className="text-white">{network}</span>
      </div>
      <div className="flex justify-between">
        <span>Block</span>
        <span className="text-white">{block}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span>Hash</span>
        <span className="text-white truncate max-w-[200px]">{txHash}</span>
        <ExternalLink className="w-3 h-3" />
      </div>
    </div>
  </div>
);

export const BiometricPrompt: React.FC<{ 
  isOpen: boolean; 
  onComplete: () => void;
  variant?: 'mac' | 'windows' | 'ios' | 'android' | 'cross-device';
  state?: 'idle' | 'pending' | 'success';
}> = ({ isOpen, onComplete, variant = 'mac', state = 'idle' }) => {
  const getIcon = () => {
    switch (variant) {
      case 'mac': return Fingerprint;
      case 'windows': return ScanFace;
      case 'ios': return ScanFace;
      case 'android': return Fingerprint;
      case 'cross-device': return QrCode;
      default: return KeyIcon;
    }
  };

  const Icon = getIcon();
  const label = {
    mac: 'Touch ID to sign',
    windows: 'Windows Hello to sign',
    ios: 'Face ID to sign',
    android: 'Fingerprint to sign',
    'cross-device': 'Scan to sign'
  }[variant] || 'Authenticate to sign';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-ink-900/80 backdrop-blur-sm">
          <motion.div 
             initial={{ scale: 0.9, opacity: 0 }}
             animate={{ scale: 1, opacity: 1 }}
             exit={{ scale: 0.9, opacity: 0 }}
             className="w-full max-w-sm bg-white rounded-xl p-8 text-center shadow-2xl"
          >
            <div className="relative inline-block mb-6">
              <motion.div 
                animate={{ 
                  scale: state === 'pending' ? [1, 1.2, 1] : [1, 1.1, 1],
                  opacity: state === 'pending' ? [0.4, 0.7, 0.4] : [0.2, 0.4, 0.2]
                }}
                transition={{ 
                  repeat: Infinity, 
                  duration: state === 'pending' ? 1.5 : 2,
                  ease: "easeInOut"
                }}
                className={cn(
                  "absolute inset-0 rounded-full blur-xl",
                  state === 'success' ? "bg-proof-green-600/20" : "bg-proof-blue-500/20"
                )}
              />
              <div className="relative bg-gray-50 p-6 rounded-full border border-gray-100">
                 {state === 'success' ? (
                   <motion.div
                     initial={{ scale: 0 }}
                     animate={{ scale: 1 }}
                     transition={{ type: "spring", stiffness: 200, damping: 15 }}
                   >
                     <Check className="w-12 h-12 text-proof-green-600" strokeWidth={3} />
                   </motion.div>
                 ) : (
                   <Icon className={cn(
                     "w-12 h-12 transition-colors",
                     state === 'pending' ? "text-proof-blue-600" : "text-gray-400"
                   )} />
                 )}
              </div>
            </div>
            
            {variant === 'cross-device' && state === 'idle' ? (
              <div className="mb-8 p-4 bg-gray-50 rounded-lg flex items-center justify-center">
                 <QrCode className="w-40 h-40 text-navy-900 opacity-80" strokeWidth={1} />
              </div>
            ) : null}

            <h3 className="text-xl font-semibold mb-2 font-sans">
              {state === 'success' ? "Signed Successfully" : "Verify Identity"}
            </h3>
            <p className="text-gray-500 text-sm mb-8">
              {state === 'success' 
                ? "Your cryptographic signature is being anchored to the ledger."
                : variant === 'cross-device' 
                  ? "Scan with the phone where your ProofLine passkey is stored."
                  : "Touch ID or use Passkey to authorize the cryptographic signature."
              }
            </p>
            
            {state !== 'success' && (
              <button 
                onClick={onComplete}
                className="w-full py-4 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-all active:scale-[0.98]"
              >
                {state === 'pending' ? "Waiting for device..." : label}
              </button>
            )}
            
            <div className="mt-6 text-[10px] text-gray-400 font-medium tracking-wide flex items-center justify-center gap-2">
              <ShieldCheck className="w-3 h-3" />
              PROTECTED BY SECURE ENCLAVE
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export const PayloadHashCaption: React.FC<{ hash: string }> = ({ hash }) => (
  <div className="flex flex-col items-center gap-1">
    <div className="text-[10px] font-mono text-gray-400 uppercase tracking-widest font-bold">
      Payload Integrity Hash
    </div>
    <div className="text-[11px] font-mono text-gray-900 bg-gray-50 px-3 py-1.5 rounded border border-gray-100 uppercase shadow-sm">
      sha256: {hash} · canonicalized via RFC 8785
    </div>
  </div>
);

export const ExpiryCountdown: React.FC<{ expiryMinutes: number }> = ({ expiryMinutes }) => {
  const [seconds, setSeconds] = React.useState(expiryMinutes * 60);
  
  React.useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => setSeconds(s => s - 1), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const minutesLeft = Math.floor(seconds / 60);
  const secondsLeft = seconds % 60;

  return (
    <span className="font-mono text-gray-900 font-bold tabular-nums">
      {minutesLeft}:{secondsLeft.toString().padStart(2, '0')}
    </span>
  );
};

export type SessionChipState = 'active' | 'expiring' | 'expired' | 'none';

export const SessionChip: React.FC<{
  state: SessionChipState;
  ttlSeconds?: number;
  recipient?: string;
}> = ({ state, ttlSeconds = 900, recipient }) => {
  const minutes = Math.floor(ttlSeconds / 60);
  const seconds = ttlSeconds % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const configs = {
    active: {
      bg: 'bg-proof-amber-500/10',
      border: 'border-proof-amber-500/20',
      dot: 'bg-proof-amber-500',
      text: 'text-proof-amber-900',
      label: `Session active · ${timeStr}`,
      pulse: true
    },
    expiring: {
      bg: 'bg-proof-amber-700/10',
      border: 'border-proof-amber-700/30',
      dot: 'bg-proof-amber-700',
      text: 'text-proof-amber-950',
      label: `Expiring · ${timeStr}`,
      pulse: 'faster'
    },
    expired: {
      bg: 'bg-gray-100',
      border: 'border-gray-200',
      dot: 'bg-gray-400',
      text: 'text-gray-500',
      label: 'Re-auth needed',
      pulse: false
    },
    none: {
      bg: 'bg-navy-900',
      border: 'border-navy-900',
      dot: 'bg-white/40',
      text: 'text-white',
      label: 'Will sign on send',
      pulse: false
    }
  };

  const config = configs[state];

  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-bold tracking-tight transition-all",
      config.bg,
      config.border,
      config.text
    )}>
      <div className="relative">
        <div className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
        {config.pulse && (
          <motion.div 
            animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ 
              repeat: Infinity, 
              duration: config.pulse === 'faster' ? 1 : 2, 
              ease: "easeInOut" 
            }}
            className={cn("absolute inset-0 rounded-full", config.dot)}
          />
        )}
      </div>
      <span>{config.label}</span>
      {recipient && (
        <span className="opacity-40 font-medium">to {recipient}</span>
      )}
    </div>
  );
};

export const ExtensionToolbarButton: React.FC<{
  state: 'idle' | 'navy' | 'amber' | 'high-value';
  label?: string;
  countdown?: string;
}> = ({ state, label, countdown }) => {
  const configs = {
    idle: { bg: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-500', icon: ShieldCheck },
    navy: { bg: 'bg-navy-900', border: 'border-navy-900', text: 'text-white', icon: ShieldCheck },
    amber: { bg: 'bg-proof-amber-500', border: 'border-proof-amber-600', text: 'text-white', icon: Lock },
    'high-value': { bg: 'bg-navy-900', border: 'border-navy-900', text: 'text-white', icon: ShieldCheck }
  };

  const config = configs[state];
  const Icon = config.icon;

  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-3 h-8 rounded-full border shadow-sm transition-all cursor-pointer hover:brightness-95 active:scale-95",
      config.bg,
      config.border,
      config.text
    )}>
      <div className="relative">
        <Icon className="w-3.5 h-3.5" />
        {state === 'high-value' && (
           <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-proof-red-600 border border-navy-900" />
        )}
        {state === 'amber' && (
           <motion.div 
             animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
             transition={{ repeat: Infinity, duration: 1.5 }}
             className="absolute inset-0 bg-white rounded-full blur-[2px]"
           />
        )}
      </div>
      <span className="text-[11px] font-bold uppercase tracking-wide">
        {label || (state === 'amber' ? `Session · ${countdown}` : 'ProofLine')}
      </span>
      <ChevronRightIcon className="w-3 h-3 opacity-40" />
    </div>
  );
};

export const OnboardingStepper: React.FC<{ currentStep: number; steps: string[] }> = ({ currentStep, steps }) => (
  <div className="space-y-8">
    {steps.map((step, idx) => {
      const isComplete = idx < currentStep;
      const isCurrent = idx === currentStep;
      
      return (
        <div key={step} className="flex gap-4 group">
          <div className="flex flex-col items-center">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300",
              isComplete ? "bg-proof-green-600 border-proof-green-600 text-white" : 
              isCurrent ? "border-proof-blue-600 text-proof-blue-600" : "border-gray-200 text-gray-300"
            )}>
              {isComplete ? <Check className="w-4 h-4" /> : <span className="text-xs font-bold">{idx + 1}</span>}
            </div>
            {idx < steps.length - 1 && (
               <div className={cn(
                 "w-0.5 grow mt-2 rounded-full",
                 isComplete ? "bg-proof-green-600" : "bg-gray-100"
               )} />
            )}
          </div>
          <div className="pb-8">
            <h4 className={cn(
               "text-sm font-semibold transition-colors duration-300",
               isComplete ? "text-gray-900" : isCurrent ? "text-proof-blue-600" : "text-gray-300"
            )}>
              {step}
            </h4>
            {isCurrent && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2 text-xs text-gray-500 font-sans"
              >
                {idx === 2 && (
                   <div className="flex items-center gap-2 italic font-serif">
                     Looking up <span className="text-gray-900 font-semibold italic">Acme Title LLC</span> in public records.
                   </div>
                )}
                {idx === 0 && "Propagating DNS records for domain verification..."}
                {idx === 5 && "Assembling cryptographic key fragments..."}
              </motion.div>
            )}
          </div>
        </div>
      );
    })}
  </div>
);
