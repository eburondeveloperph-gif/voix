import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDjmcE7CiKrNpSnu20gFB2cG620HU36Zqg",
  authDomain: "gen-lang-client-0836251512.firebaseapp.com",
  databaseURL: "https://gen-lang-client-0836251512-default-rtdb.firebaseio.com",
  projectId: "gen-lang-client-0836251512",
  storageBucket: "gen-lang-client-0836251512.firebasestorage.app",
  messagingSenderId: "811711024905",
  appId: "1:811711024905:web:65c6d67b963f9fec1b8dd8",
  measurementId: "G-Z597RGXF9K"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

const FIRESTORE_DISABLED_STORAGE_KEY = 'beatrice_firestore_remote_disabled_v1';

const envFlag = (name: string) => {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return value === '1' || value === 'true';
};

export const isFirestoreRemoteEnabled = () => {
  if (!envFlag('VITE_ENABLE_FIRESTORE_REMOTE')) return false;
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(FIRESTORE_DISABLED_STORAGE_KEY) !== '1';
};

export const disableFirestoreRemote = (reason?: unknown) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FIRESTORE_DISABLED_STORAGE_KEY, '1');
  }

  if (reason && envFlag('VITE_DEBUG_FIRESTORE')) {
    console.info('Firestore remote persistence disabled for this session:', reason);
  }
};

const GOOGLE_OAUTH_TOKEN_STORAGE_KEY = 'beatrice_google_oauth_token_v1';
const GOOGLE_OAUTH_TOKEN_TTL_MS = 55 * 60 * 1000;

type StoredGoogleOAuthToken = {
  accessToken: string;
  acquiredAt: number;
};

const canUseStorage = () => typeof window !== 'undefined' && !!window.localStorage;

export const storeGoogleAccessToken = (accessToken?: string | null) => {
  if (!accessToken || !canUseStorage()) return;
  const payload: StoredGoogleOAuthToken = {
    accessToken,
    acquiredAt: Date.now(),
  };
  window.localStorage.setItem(GOOGLE_OAUTH_TOKEN_STORAGE_KEY, JSON.stringify(payload));
};

export const getStoredGoogleAccessToken = () => {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(GOOGLE_OAUTH_TOKEN_STORAGE_KEY);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as StoredGoogleOAuthToken;
    if (!payload.accessToken || Date.now() - payload.acquiredAt > GOOGLE_OAUTH_TOKEN_TTL_MS) {
      window.localStorage.removeItem(GOOGLE_OAUTH_TOKEN_STORAGE_KEY);
      return null;
    }
    return payload.accessToken;
  } catch {
    window.localStorage.removeItem(GOOGLE_OAUTH_TOKEN_STORAGE_KEY);
    return null;
  }
};

export const clearStoredGoogleAccessToken = () => {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(GOOGLE_OAUTH_TOKEN_STORAGE_KEY);
};

const GOOGLE_SERVICE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.messages.create',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/youtube',
];

GOOGLE_SERVICE_SCOPES.forEach(scope => googleProvider.addScope(scope));

googleProvider.setCustomParameters({
  prompt: 'consent select_account',
  include_granted_scopes: 'true',
});

const GOOGLE_SIGN_IN_CANCEL_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
]);

export const isGoogleSignInCancelled = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return GOOGLE_SIGN_IN_CANCEL_CODES.has(String((error as { code?: unknown }).code));
};

export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    storeGoogleAccessToken(credential?.accessToken);
    return result.user;
  } catch (error) {
    if (isGoogleSignInCancelled(error)) return null;
    console.error('Error signing in with Google', error);
    throw error;
  }
};

export const logout = async () => {
  try {
    clearStoredGoogleAccessToken();
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
  }
};

export const updateUserPhotoURL = async (user: User, photoURL: string) => {
  await updateProfile(user, { photoURL });
};

/**
 * Upload an image file to Firebase Storage and return the download URL.
 * Organises under chat-images/{userId}/ for easy management.
 */
export async function uploadImageToStorage(
  userId: string,
  file: File,
  conversationId?: string,
): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = conversationId
    ? `chat-images/${userId}/${conversationId}/img_${Date.now()}.${ext}`
    : `chat-images/${userId}/img_${Date.now()}.${ext}`;
  const ref = storageRef(storage, path);
  const snapshot = await uploadBytes(ref, file);
  return getDownloadURL(snapshot.ref);
}

export async function uploadAvatarToStorage(userId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const ref = storageRef(storage, `avatars/${userId}/avatar_${Date.now()}.${ext}`);
  const snapshot = await uploadBytes(ref, file);
  return getDownloadURL(snapshot.ref);
}
