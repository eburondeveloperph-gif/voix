import { create } from 'zustand';
import { UserProfile, UserProfileInput, UserProfileService } from './user-profile';

interface UserProfileState {
  profile: UserProfile | null;
  isLoading: boolean;
  isOnboardingOpen: boolean;
  draftPreferredName: string;
  draftPreferredAddress: string;
  loadProfile: () => Promise<void>;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  setDraftPreferredName: (value: string) => void;
  setDraftPreferredAddress: (value: string) => void;
  submitOnboarding: (input?: Partial<UserProfileInput>) => Promise<UserProfile>;
  clearProfile: () => void;
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profile: null,
  isLoading: true,
  isOnboardingOpen: false,
  draftPreferredName: '',
  draftPreferredAddress: '',
  loadProfile: async () => {
    set({ isLoading: true });
    const profile = await UserProfileService.loadProfile();
    set({
      profile,
      isLoading: false,
      isOnboardingOpen: !profile.onboarding_completed,
      draftPreferredName: profile.preferred_name || '',
      draftPreferredAddress: profile.preferred_address || '',
    });
  },
  openOnboarding: () => set({ isOnboardingOpen: true }),
  closeOnboarding: () => set({ isOnboardingOpen: false }),
  setDraftPreferredName: draftPreferredName => set({ draftPreferredName }),
  setDraftPreferredAddress: draftPreferredAddress => set({ draftPreferredAddress }),
  submitOnboarding: async input => {
    const state = get();
    const profile = await UserProfileService.saveProfile({
      preferred_name: input?.preferred_name ?? state.draftPreferredName,
      preferred_address: input?.preferred_address ?? state.draftPreferredAddress,
    });
    set({
      profile,
      isOnboardingOpen: false,
      draftPreferredName: profile.preferred_name,
      draftPreferredAddress: profile.preferred_address,
    });
    return profile;
  },
  clearProfile: () =>
    set({
      profile: null,
      isLoading: false,
      isOnboardingOpen: false,
      draftPreferredName: '',
      draftPreferredAddress: '',
    }),
}));
