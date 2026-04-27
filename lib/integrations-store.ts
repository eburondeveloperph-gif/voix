/**
 * Integrations Store — WhatsApp + Zapier credentials
 *
 * Persists per-device (localStorage via zustand/middleware persist).
 * Per-user scoping is achieved by storing the userId alongside each credential
 * blob and only treating credentials as active when the current effective
 * user id matches.
 *
 * Used by:
 *   • lib/agents/whatsapp-agent.ts
 *   • lib/agents/zapier-agent.ts
 *   • The Integrations Settings UI in App.tsx
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Types ─────────────────────────────────────────────

export interface WhatsAppConfig {
  /**
   * Meta WhatsApp Business "Phone Number ID". Found in Meta for Developers ›
   * App › WhatsApp › API Setup.
   */
  phoneNumberId: string;
  /** Long-lived access token for the WhatsApp Cloud API. */
  accessToken: string;
  /**
   * Default recipient when Beatrice is asked to "send a WhatsApp" without a
   * destination. E.164 format e.g. "+32475123456".
   */
  defaultRecipient?: string;
  /**
   * Optional CORS-friendly proxy URL the agent can POST to instead of calling
   * graph.facebook.com directly (helpful when CORS is blocked). The proxy is
   * expected to forward the same JSON body to the WhatsApp Cloud API.
   */
  proxyUrl?: string;
  /** API version, default 'v20.0' */
  apiVersion?: string;
  /** Timestamp of last successful test send */
  lastTestedAt?: number;
  /** Owning user id (or 'local-dev-user') */
  ownerUserId: string;
}

export interface ZapierZap {
  /** Stable id used by Beatrice when calling zapier_trigger */
  id: string;
  /** Friendly name Beatrice can recognise in voice ("send to slack") */
  name: string;
  /** Catch-hook URL from Zapier */
  webhookUrl: string;
  /** Free-text description of what this zap does (Beatrice will read this) */
  description?: string;
  /** Optional list of param names the zap expects in the payload */
  expectedParams?: string[];
}

export interface ZapierConfig {
  zaps: ZapierZap[];
  ownerUserId: string;
}

interface IntegrationsState {
  whatsapp: WhatsAppConfig | null;
  zapier: ZapierConfig;
  setWhatsApp: (cfg: WhatsAppConfig | null) => void;
  patchWhatsApp: (patch: Partial<WhatsAppConfig>) => void;
  clearWhatsApp: () => void;
  upsertZap: (zap: ZapierZap) => void;
  removeZap: (id: string) => void;
  clearAllZaps: () => void;
  isWhatsAppConfigured: () => boolean;
}

// ─── Helpers ──────────────────────────────────────────

const emptyZapier = (ownerUserId: string): ZapierConfig => ({
  zaps: [],
  ownerUserId,
});

// ─── Store ────────────────────────────────────────────

export const useIntegrations = create<IntegrationsState>()(
  persist(
    (set, get) => ({
      whatsapp: null,
      zapier: emptyZapier('local-dev-user'),
      setWhatsApp: cfg => set({ whatsapp: cfg }),
      patchWhatsApp: patch =>
        set(state => ({
          whatsapp: state.whatsapp
            ? { ...state.whatsapp, ...patch }
            : (patch.phoneNumberId && patch.accessToken && patch.ownerUserId
                ? ({
                    phoneNumberId: patch.phoneNumberId,
                    accessToken: patch.accessToken,
                    ownerUserId: patch.ownerUserId,
                    ...patch,
                  } as WhatsAppConfig)
                : null),
        })),
      clearWhatsApp: () => set({ whatsapp: null }),
      upsertZap: zap =>
        set(state => {
          const existing = state.zapier.zaps.findIndex(z => z.id === zap.id);
          const nextZaps =
            existing >= 0
              ? state.zapier.zaps.map((z, i) => (i === existing ? zap : z))
              : [...state.zapier.zaps, zap];
          return { zapier: { ...state.zapier, zaps: nextZaps } };
        }),
      removeZap: id =>
        set(state => ({
          zapier: { ...state.zapier, zaps: state.zapier.zaps.filter(z => z.id !== id) },
        })),
      clearAllZaps: () =>
        set(state => ({ zapier: { ...state.zapier, zaps: [] } })),
      isWhatsAppConfigured: () => {
        const c = get().whatsapp;
        return Boolean(c && c.phoneNumberId && c.accessToken);
      },
    }),
    { name: 'beatrice-integrations-v1' },
  ),
);

// ─── Public read helpers (used by agents) ─────────────

export function getWhatsAppConfig(): WhatsAppConfig | null {
  return useIntegrations.getState().whatsapp;
}

export function getZapByName(name: string): ZapierZap | null {
  const needle = name.toLowerCase().trim();
  if (!needle) return null;
  const { zaps } = useIntegrations.getState().zapier;
  // Exact match by id first, then exact name, then substring
  return (
    zaps.find(z => z.id.toLowerCase() === needle) ||
    zaps.find(z => z.name.toLowerCase() === needle) ||
    zaps.find(z => z.name.toLowerCase().includes(needle)) ||
    null
  );
}

export function listZaps(): ZapierZap[] {
  return useIntegrations.getState().zapier.zaps.slice();
}

export function makeZapId(name: string): string {
  return `zap_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${Date.now().toString(36).slice(-4)}`;
}
