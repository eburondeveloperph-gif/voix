import { useEffect } from 'react';
import { useUserProfileStore } from '@/lib/user-profile-store';

export default function UserProfileOnboardingModal() {
  const {
    profile,
    isOnboardingOpen,
    draftPreferredName,
    draftPreferredAddress,
    setDraftPreferredName,
    setDraftPreferredAddress,
    submitOnboarding,
  } = useUserProfileStore();

  useEffect(() => {
    if (!isOnboardingOpen || profile?.onboarding_completed) return;
    if (!draftPreferredAddress && profile?.auth_display_name) {
      setDraftPreferredAddress(profile.auth_display_name);
    }
  }, [
    draftPreferredAddress,
    isOnboardingOpen,
    profile,
    setDraftPreferredAddress,
  ]);

  if (!isOnboardingOpen) {
    return null;
  }

  return (
    <div className="user-profile-modal-shell">
      <div className="user-profile-modal-backdrop" />
      <section className="user-profile-modal" role="dialog" aria-modal="true" aria-label="Preferred address">
        <p className="user-profile-kicker">New Associate Detected</p>
        <h2>How should Beatrice address you?</h2>
        <p className="user-profile-copy">
          Beatrice remains loyal to Jo Lernout and treats you as a Jo Lernout associate.
          Tell her how you want to be called, and she will remember it for your user profile only.
        </p>

        <label className="user-profile-field">
          <span>Your name</span>
          <input
            type="text"
            value={draftPreferredName}
            onChange={event => setDraftPreferredName(event.target.value)}
            placeholder="Your name"
          />
        </label>

        <label className="user-profile-field">
          <span>Preferred address</span>
          <input
            type="text"
            value={draftPreferredAddress}
            onChange={event => setDraftPreferredAddress(event.target.value)}
            placeholder="For example: Meneer Alex, Alex, Doctor, Ms. Claire"
          />
        </label>

        <button
          className="user-profile-submit"
          onClick={() => void submitOnboarding()}
          disabled={!draftPreferredName.trim() && !draftPreferredAddress.trim()}
        >
          Save My Address
        </button>
      </section>
    </div>
  );
}
