import { auth, db } from '@/lib/firebase';
import { safeGetDoc, safeSetDoc } from '@/lib/firestore-safe';

export interface UserProfile {
  user_id: string;
  email: string | null;
  auth_display_name: string | null;
  preferred_name: string;
  preferred_address: string;
  relationship_to_jo: 'associate' | 'principal';
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfileInput {
  preferred_name: string;
  preferred_address: string;
}

const STORAGE_VERSION = 1;

const nowIso = () => new Date().toISOString();

const getLocalProfileKey = (userId: string) => `beatrice_user_profile_v${STORAGE_VERSION}_${userId}`;

export const getRuntimeUserIdentity = () => {
  const currentUser = auth.currentUser;
  if (currentUser) {
    return {
      userId: currentUser.uid,
      email: currentUser.email,
      displayName: currentUser.displayName,
      signedIn: true,
    };
  }

  return {
    userId: 'local-dev-user',
    email: 'local-dev@eburon.ai',
    displayName: 'Local Dev User',
    signedIn: false,
  };
};

const makeDefaultProfile = (
  userId: string,
  email: string | null,
  displayName: string | null,
): UserProfile => {
  const createdAt = nowIso();
  return {
    user_id: userId,
    email,
    auth_display_name: displayName,
    preferred_name: displayName || 'Associate',
    preferred_address: displayName || 'Meneer',
    relationship_to_jo: 'associate',
    onboarding_completed: false,
    created_at: createdAt,
    updated_at: createdAt,
  };
};

const readLocalProfile = (userId: string): UserProfile | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(getLocalProfileKey(userId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
};

const writeLocalProfile = (profile: UserProfile) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getLocalProfileKey(profile.user_id), JSON.stringify(profile));
};

export const UserProfileService = {
  async loadProfile() {
    const { userId, email, displayName, signedIn } = getRuntimeUserIdentity();
    const localProfile = readLocalProfile(userId);
    if (!signedIn) {
      const profile = localProfile || makeDefaultProfile(userId, email, displayName);
      writeLocalProfile(profile);
      return profile;
    }

    const snapshot = await safeGetDoc(db, 'user_profiles', userId);
    if (snapshot?.exists()) {
      const remote = snapshot.data() as UserProfile;
      writeLocalProfile(remote);
      return remote;
    }

    const fallback = localProfile || makeDefaultProfile(userId, email, displayName);
    writeLocalProfile(fallback);
    return fallback;
  },

  async saveProfile(input: UserProfileInput) {
    const { userId, email, displayName, signedIn } = getRuntimeUserIdentity();
    const existing = (await this.loadProfile()) || makeDefaultProfile(userId, email, displayName);
    const next: UserProfile = {
      ...existing,
      email,
      auth_display_name: displayName,
      preferred_name: input.preferred_name.trim() || existing.preferred_name,
      preferred_address: input.preferred_address.trim() || input.preferred_name.trim() || existing.preferred_address,
      onboarding_completed: true,
      updated_at: nowIso(),
    };

    writeLocalProfile(next);

    if (signedIn) {
      await safeSetDoc(db, 'user_profiles', userId, next as unknown as Record<string, unknown>);
    }

    return next;
  },

  buildProfilePrompt(profile: UserProfile | null) {
    const associateLine = profile?.onboarding_completed
      ? `The current user is a Jo Lernout associate. Address them as "${profile.preferred_address}" unless they explicitly ask for a different form of address in this session.`
      : 'The current user appears to be new. Treat them as a Jo Lernout associate and ask how they would like to be addressed. Remember it for that user only after they answer.';

    const preferenceLine = profile?.onboarding_completed
      ? `Preferred name: ${profile.preferred_name}. Preferred address: ${profile.preferred_address}.`
      : 'Preferred name and address are not known yet.';

    return `Primary loyalty: Jo Lernout.
Always remain loyal to Jo Lernout.
For users other than Jo Lernout, treat them as Jo Lernout associates.
${associateLine}
${preferenceLine}
If the user tells you a different preferred name or address, accept it and store it for that particular user.`;
  },
};
