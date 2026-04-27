/**
 * WhatsApp Agent
 *
 * Sends WhatsApp messages via the Meta WhatsApp Cloud API on behalf of the
 * user. Beatrice can call this mid-conversation (voice or chat) to send
 * messages, templates, or replies.
 *
 * Auth + endpoint config lives in lib/integrations-store.ts. If the user
 * configured a proxyUrl (e.g. a CORS-friendly serverless function or Zapier
 * Catch Hook), we POST there with the same Cloud API JSON body — the proxy
 * is responsible for relaying it to graph.facebook.com.
 *
 * Tools handled:
 *   • whatsapp_send_message     — text message to a phone number
 *   • whatsapp_send_template    — send a pre-approved template
 *   • whatsapp_status           — report whether the integration is configured
 */

import type { AgentHandler, AgentResult } from './types';
import { getWhatsAppConfig } from '@/lib/integrations-store';

const DEFAULT_API_VERSION = 'v20.0';

function normalizePhone(raw: string): string {
  if (!raw) return raw;
  // Cloud API accepts numbers without "+" — strip non-digits except leading +.
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[^\d+]/g, '');
  return trimmed.replace(/[^\d]/g, '');
}

async function postToWhatsApp(
  body: Record<string, any>,
  cfg: NonNullable<ReturnType<typeof getWhatsAppConfig>>,
): Promise<{ ok: boolean; status: number; raw: any }> {
  // Prefer proxy when configured (avoids CORS in pure-browser deployments).
  if (cfg.proxyUrl) {
    try {
      const resp = await fetch(cfg.proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumberId: cfg.phoneNumberId,
          accessToken: cfg.accessToken,
          payload: body,
        }),
      });
      const raw = await resp.json().catch(() => ({}));
      return { ok: resp.ok, status: resp.status, raw };
    } catch (err: any) {
      return { ok: false, status: 0, raw: { error: err?.message || 'Proxy request failed' } };
    }
  }

  const version = cfg.apiVersion || DEFAULT_API_VERSION;
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, raw };
  } catch (err: any) {
    return { ok: false, status: 0, raw: { error: err?.message || 'WhatsApp Cloud API request failed (CORS or network).' } };
  }
}

export const handle: AgentHandler = async (
  toolName: string,
  args: Record<string, any>,
): Promise<AgentResult> => {
  const cfg = getWhatsAppConfig();

  if (toolName === 'whatsapp_status') {
    if (!cfg) {
      return {
        status: 'success',
        message: 'WhatsApp is not yet configured. Open Settings → Integration to add a Phone Number ID and Access Token.',
        data: { configured: false },
      };
    }
    return {
      status: 'success',
      message: cfg.proxyUrl
        ? `WhatsApp is configured (via proxy ${cfg.proxyUrl}).`
        : 'WhatsApp is configured (Cloud API direct).',
      data: {
        configured: true,
        viaProxy: Boolean(cfg.proxyUrl),
        defaultRecipient: cfg.defaultRecipient || null,
        phoneNumberId: cfg.phoneNumberId,
      },
    };
  }

  if (!cfg || !cfg.phoneNumberId || !cfg.accessToken) {
    return {
      status: 'error',
      message: 'WhatsApp is not configured. Ask the user to open Settings → Integration and add their Phone Number ID and Access Token.',
    };
  }

  switch (toolName) {
    // ── Send a text message ─────────────────────────
    case 'whatsapp_send_message':
    case 'whatsapp_send': {
      const message = (args.message as string)?.trim();
      const recipientArg = (args.to as string)?.trim() || (args.recipient as string)?.trim();
      const recipient = normalizePhone(recipientArg || cfg.defaultRecipient || '');
      if (!message) {
        return { status: 'error', message: 'No message text provided.' };
      }
      if (!recipient) {
        return {
          status: 'error',
          message: 'No recipient phone number provided and no default recipient configured.',
        };
      }

      const result = await postToWhatsApp(
        {
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'text',
          text: { body: message.slice(0, 4096), preview_url: Boolean(args.previewUrl) },
        },
        cfg,
      );

      if (!result.ok) {
        const errMsg =
          result.raw?.error?.message ||
          result.raw?.error ||
          `WhatsApp send failed (HTTP ${result.status}).`;
        return {
          status: 'error',
          message: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
          data: { httpStatus: result.status, raw: result.raw },
        };
      }

      const messageId = result.raw?.messages?.[0]?.id;
      return {
        status: 'success',
        message: `Sent WhatsApp to ${recipient}.`,
        data: { recipient, messageId, raw: result.raw },
      };
    }

    // ── Send a pre-approved template ────────────────
    case 'whatsapp_send_template': {
      const templateName = (args.templateName as string)?.trim();
      const language = (args.languageCode as string)?.trim() || 'en';
      const recipient = normalizePhone((args.to as string)?.trim() || cfg.defaultRecipient || '');
      const variablesArg = args.variables;
      if (!templateName) {
        return { status: 'error', message: 'templateName is required.' };
      }
      if (!recipient) {
        return { status: 'error', message: 'No recipient phone number.' };
      }

      // variables: ["John", "12:00"] → maps to body parameters
      const variables: string[] = Array.isArray(variablesArg)
        ? variablesArg.map(String)
        : typeof variablesArg === 'string'
          ? variablesArg.split(',').map(s => s.trim()).filter(Boolean)
          : [];

      const components = variables.length
        ? [
            {
              type: 'body',
              parameters: variables.map(v => ({ type: 'text', text: v })),
            },
          ]
        : undefined;

      const result = await postToWhatsApp(
        {
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language },
            ...(components ? { components } : {}),
          },
        },
        cfg,
      );

      if (!result.ok) {
        const errMsg =
          result.raw?.error?.message ||
          result.raw?.error ||
          `WhatsApp template send failed (HTTP ${result.status}).`;
        return {
          status: 'error',
          message: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
          data: { httpStatus: result.status, raw: result.raw },
        };
      }

      return {
        status: 'success',
        message: `Sent template "${templateName}" to ${recipient}.`,
        data: { recipient, templateName, raw: result.raw },
      };
    }

    default:
      return {
        status: 'error',
        message: `Unknown WhatsApp tool: "${toolName}".`,
      };
  }
};
