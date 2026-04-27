import { create } from 'zustand';

export type VoiceChatPayload = {
  id: string;
  text: string;
  source: 'deepgram_voice';
  createdAt: number;
};

type VoiceChatBridgeState = {
  pending: VoiceChatPayload | null;
  pushTranscript: (text: string) => void;
  consume: (id: string) => void;
};

export const useVoiceChatBridge = create<VoiceChatBridgeState>(set => ({
  pending: null,
  pushTranscript: text => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set({
      pending: {
        id: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: trimmed,
        source: 'deepgram_voice',
        createdAt: Date.now(),
      },
    });
  },
  consume: id => {
    set(state => (state.pending?.id === id ? { pending: null } : state));
  },
}));
