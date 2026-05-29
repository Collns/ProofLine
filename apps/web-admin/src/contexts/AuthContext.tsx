// PFL-121: Firebase Auth context for the admin app. Tracks the signed-in
// user, resolves their companyId from users/{uid}, and exposes sign-in /
// sign-out. Every protected route reads this via useAuth().
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getFirebaseAuth, getDb } from '../lib/firebase';

const ID_TOKEN_KEY = 'firebase-id-token';
const OWNER_UID_KEY = 'proofline-owner-uid';
const COMPANY_ID_KEY = 'proofline-company-id';
const EMAIL_FOR_SIGNIN_KEY = 'proofline-email-for-signin';

interface AuthContextValue {
  user: FirebaseUser | null;
  /** Auth state still resolving (initial onAuthStateChanged pending). */
  loading: boolean;
  /** The signed-in user's companyId, resolved from users/{uid}. */
  companyId: string | null;
  /** True once we've finished attempting to resolve companyId. */
  companyResolved: boolean;
  signInWithGoogle: () => Promise<void>;
  /** Secondary path — sends a sign-in link to the email (no password). */
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyResolved, setCompanyResolved] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setCompanyResolved(false);
      setCompanyId(null);

      if (!u) {
        try {
          window.localStorage.removeItem(ID_TOKEN_KEY);
        } catch { /* ignore */ }
        setCompanyResolved(true);
        setLoading(false);
        return;
      }

      // Cache the ID token + uid so the API clients (and the onboarding
      // owner-uid resolver) can read them even outside React.
      try {
        const token = await u.getIdToken();
        window.localStorage.setItem(ID_TOKEN_KEY, token);
        window.localStorage.setItem(OWNER_UID_KEY, u.uid);
      } catch { /* ignore token cache failure */ }

      // Resolve companyId from users/{uid}. Missing doc → new user who
      // hasn't onboarded → companyId stays null (ProtectedRoute sends them
      // to /onboarding).
      try {
        const snap = await getDoc(doc(getDb(), 'users', u.uid));
        const cid = snap.exists()
          ? ((snap.data() as { companyId?: string }).companyId ?? null)
          : null;
        if (cid && cid.length > 0) {
          setCompanyId(cid);
          try { window.localStorage.setItem(COMPANY_ID_KEY, cid); } catch { /* ignore */ }
        }
      } catch {
        // Closed rules / missing config / offline — treat as unresolved.
        setCompanyId(null);
      }

      setCompanyResolved(true);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
  }, []);

  const signInWithEmail = useCallback(async (email: string) => {
    const actionCodeSettings = {
      url: `${window.location.origin}/login`,
      handleCodeInApp: true,
    };
    await sendSignInLinkToEmail(getFirebaseAuth(), email, actionCodeSettings);
    try { window.localStorage.setItem(EMAIL_FOR_SIGNIN_KEY, email); } catch { /* ignore */ }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
    try {
      window.localStorage.removeItem(ID_TOKEN_KEY);
      window.localStorage.removeItem(OWNER_UID_KEY);
      window.localStorage.removeItem(COMPANY_ID_KEY);
    } catch { /* ignore */ }
    setCompanyId(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        companyId,
        companyResolved,
        signInWithGoogle,
        signInWithEmail,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
