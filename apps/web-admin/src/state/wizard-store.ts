import { useEffect, useReducer } from 'react';

// ── Steps ────────────────────────────────────────────────────────────────────

export type WizardStep =
  | 'intro'
  | 'company-info'
  | 'dns-verify'
  | 'email-verify'
  | 'kyb'
  | 'kyc'
  | 'key-ceremony'
  | 'anchored'
  | 'extension';

// User-facing 1-of-6 stepper covers the core flow; key-ceremony /
// anchored / extension are post-success beats not numbered in the
// progress pill (they happen after KYC succeeds).
export const NUMBERED_STEPS: WizardStep[] = [
  'intro',
  'company-info',
  'dns-verify',
  'email-verify',
  'kyb',
  'kyc',
];

export const STEP_LABEL: Record<WizardStep, string> = {
  'intro':         'Welcome',
  'company-info':  'Company info',
  'dns-verify':    'Domain verification',
  'email-verify':  'Email verification',
  'kyb':           'Business verification',
  'kyc':           'Officer identity',
  'key-ceremony':  'Secure your account',
  'anchored':      'Anchored on-chain',
  'extension':     'Install the extension',
};

export const STEP_ORDER: WizardStep[] = [
  'intro',
  'company-info',
  'dns-verify',
  'email-verify',
  'kyb',
  'kyc',
  'key-ceremony',
  'anchored',
  'extension',
];

// ── State ────────────────────────────────────────────────────────────────────

export interface WizardState {
  step: WizardStep;
  companyId: string | null;
  dnsToken: string | null;
  txtRecord: string | null;
  txtHost: string | null;
  domain: string;
  legalName: string;
  ein: string;
  state: string;
  ownerEmail: string;
  dnsVerifiedAt: number | null;
  emailVerifiedAt: number | null;
  kybVendorRef: string | null;
  kybStatus: 'pending' | 'approved' | 'flagged' | null;
  kybOfficers: { name: string; role: string }[];
  kycVendorRef: string | null;
  kycStatus: 'pending' | 'verified' | 'failed' | null;
  officerEmail: string;
  deviceCredentialId: string | null;
  anchorTxHash: string | null;
  anchorBlockNumber: string | null;
  anchorRoot: string | null;
  verifiedAt: number | null;
  error: { code: string; message: string } | null;
  busy: boolean;
}

const INITIAL_STATE: WizardState = {
  step:               'intro',
  companyId:          null,
  dnsToken:           null,
  txtRecord:          null,
  txtHost:            null,
  domain:             '',
  legalName:          '',
  ein:                '',
  state:              '',
  ownerEmail:         '',
  dnsVerifiedAt:      null,
  emailVerifiedAt:    null,
  kybVendorRef:       null,
  kybStatus:          null,
  kybOfficers:        [],
  kycVendorRef:       null,
  kycStatus:          null,
  officerEmail:       '',
  deviceCredentialId: null,
  anchorTxHash:       null,
  anchorBlockNumber:  null,
  anchorRoot:         null,
  verifiedAt:         null,
  error:              null,
  busy:               false,
};

// ── Actions ──────────────────────────────────────────────────────────────────

export type WizardAction =
  | { type: 'GO_TO_STEP'; step: WizardStep }
  | { type: 'ADVANCE_STEP' }
  | { type: 'GO_BACK_STEP' }
  | {
      type: 'SET_COMPANY_INFO';
      payload: {
        domain: string;
        legalName: string;
        ein: string;
        state: string;
        ownerEmail: string;
      };
    }
  | {
      type: 'SET_START_RESULT';
      payload: {
        companyId: string;
        dnsToken: string;
        txtRecord: string;
        txtHost: string;
      };
    }
  | { type: 'MARK_DNS_VERIFIED'; payload: { at: number } }
  | { type: 'MARK_EMAIL_VERIFIED'; payload: { at: number } }
  | {
      type: 'SET_KYB_RESULT';
      payload: {
        vendorRef: string;
        status: 'approved' | 'flagged';
        officers: { name: string; role: string }[];
      };
    }
  | {
      type: 'SET_KYC_RESULT';
      payload: {
        vendorRef: string;
        status: 'pending' | 'verified' | 'failed';
        officerEmail: string;
      };
    }
  | { type: 'SET_DEVICE_CREDENTIAL'; payload: { credentialId: string } }
  | {
      type: 'SET_ANCHOR';
      payload: {
        txHash: string | null;
        blockNumber: string | null;
        root: string;
        verifiedAt: number;
      };
    }
  | { type: 'SET_ERROR'; payload: { code: string; message: string } }
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_BUSY'; payload: boolean }
  | { type: 'RESET' }
  | { type: 'HYDRATE'; payload: WizardState };

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'GO_TO_STEP':
      return { ...state, step: action.step, error: null };
    case 'ADVANCE_STEP': {
      const idx = STEP_ORDER.indexOf(state.step);
      const next = STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
      return { ...state, step: next, error: null };
    }
    case 'GO_BACK_STEP': {
      const idx = STEP_ORDER.indexOf(state.step);
      const prev = STEP_ORDER[Math.max(idx - 1, 0)];
      return { ...state, step: prev, error: null };
    }
    case 'SET_COMPANY_INFO':
      return { ...state, ...action.payload };
    case 'SET_START_RESULT':
      return { ...state, ...action.payload };
    case 'MARK_DNS_VERIFIED':
      return { ...state, dnsVerifiedAt: action.payload.at };
    case 'MARK_EMAIL_VERIFIED':
      return { ...state, emailVerifiedAt: action.payload.at };
    case 'SET_KYB_RESULT':
      return {
        ...state,
        kybVendorRef: action.payload.vendorRef,
        kybStatus:    action.payload.status,
        kybOfficers:  action.payload.officers,
      };
    case 'SET_KYC_RESULT':
      return {
        ...state,
        kycVendorRef: action.payload.vendorRef,
        kycStatus:    action.payload.status,
        officerEmail: action.payload.officerEmail,
      };
    case 'SET_DEVICE_CREDENTIAL':
      return { ...state, deviceCredentialId: action.payload.credentialId };
    case 'SET_ANCHOR':
      return {
        ...state,
        anchorTxHash:      action.payload.txHash,
        anchorBlockNumber: action.payload.blockNumber,
        anchorRoot:        action.payload.root,
        verifiedAt:        action.payload.verifiedAt,
      };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'SET_BUSY':
      return { ...state, busy: action.payload };
    case 'RESET':
      return INITIAL_STATE;
    case 'HYDRATE':
      return action.payload;
    default:
      return state;
  }
}

// ── sessionStorage persistence ───────────────────────────────────────────────

const STORAGE_KEY = 'proofline.web-admin.wizard.v1';

function loadFromStorage(): WizardState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WizardState;
    // Minimal shape check — if fields are missing, prefer initial.
    if (typeof parsed.step !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(state: WizardState): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota / private mode failures — wizard still works in-memory.
  }
}

export function clearWizardStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWizard(): {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
} {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Hydrate once on mount.
  useEffect(() => {
    const persisted = loadFromStorage();
    if (persisted) dispatch({ type: 'HYDRATE', payload: persisted });
  }, []);

  // Persist on every change.
  useEffect(() => {
    saveToStorage(state);
  }, [state]);

  return { state, dispatch };
}
