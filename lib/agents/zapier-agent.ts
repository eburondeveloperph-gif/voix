/**
 * Zapier Agent
 *
 * Triggers Zapier Catch Hooks the user has registered in Settings ›
 * Integration. Each registered "zap" has a name and a webhook URL.
 *
 * Beatrice can call these tools:
 *   • zapier_list_zaps     — list available zaps so she knows what's wired up
 *   • zapier_trigger       — fire a named zap with arbitrary JSON payload
 *   • zapier_status        — quick health/configured check
 *
 * Because Zapier Catch Hooks accept any JSON body, this is a flexible bridge
 * to virtually anything Zapier integrates with (Slack, Gmail, WhatsApp via
 * Zapier, Notion, Sheets, AirTable, HTTP webhooks, …).
 */

import type { AgentHandler, AgentResult } from './types';
import { getZapByName, listZaps } from '@/lib/integrations-store';

async function postToZap(
  webhookUrl: string,
  payload: Record<string, any>,
): Promise<{ ok: boolean; status: number; raw: any }> {
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let raw: any = null;
    try {
      raw = await resp.json();
    } catch {
      try {
        raw = await resp.text();
      } catch {
        raw = null;
      }
    }
    return { ok: resp.ok, status: resp.status, raw };
  } catch (err: any) {
    return { ok: false, status: 0, raw: { error: err?.message || 'Zapier webhook request failed.' } };
  }
}

export const handle: AgentHandler = async (
  toolName: string,
  args: Record<string, any>,
): Promise<AgentResult> => {
  switch (toolName) {
    case 'zapier_status': {
      const zaps = listZaps();
      return {
        status: 'success',
        message: zaps.length
          ? `Zapier is configured with ${zaps.length} zap${zaps.length === 1 ? '' : 's'}.`
          : 'No Zapier zaps configured. Open Settings → Integration to add one.',
        data: { count: zaps.length, zaps: zaps.map(z => ({ id: z.id, name: z.name })) },
      };
    }

    case 'zapier_list_zaps': {
      const zaps = listZaps();
      if (zaps.length === 0) {
        return {
          status: 'success',
          message: 'No Zapier zaps are registered yet.',
          data: { zaps: [] },
        };
      }
      return {
        status: 'success',
        message: `${zaps.length} Zapier zap${zaps.length === 1 ? '' : 's'} available.`,
        data: {
          zaps: zaps.map(z => ({
            id: z.id,
            name: z.name,
            description: z.description || '',
            expectedParams: z.expectedParams || [],
          })),
        },
      };
    }

    case 'zapier_trigger': {
      const nameOrId = (args.zap as string)?.trim() || (args.name as string)?.trim() || (args.id as string)?.trim();
      if (!nameOrId) {
        return {
          status: 'error',
          message: 'Provide a zap name or id (zapier_list_zaps shows what is available).',
        };
      }
      const zap = getZapByName(nameOrId);
      if (!zap) {
        return {
          status: 'error',
          message: `No zap matched "${nameOrId}". Call zapier_list_zaps to see what's wired up.`,
        };
      }

      // Accept payload either as a structured object (args.payload) or a flat
      // map merged from the rest of args (minus the routing keys).
      const explicitPayload =
        args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)
          ? args.payload
          : null;

      const flatPayload: Record<string, any> = {};
      if (!explicitPayload) {
        for (const [k, v] of Object.entries(args)) {
          if (k === 'zap' || k === 'name' || k === 'id') continue;
          flatPayload[k] = v;
        }
      }

      const finalPayload = explicitPayload ?? flatPayload;
      const result = await postToZap(zap.webhookUrl, {
        ...finalPayload,
        _beatrice_meta: {
          zapName: zap.name,
          zapId: zap.id,
          firedAt: new Date().toISOString(),
        },
      });

      if (!result.ok) {
        return {
          status: 'error',
          message: `Zap "${zap.name}" failed (HTTP ${result.status}).`,
          data: { raw: result.raw },
        };
      }
      return {
        status: 'success',
        message: `Triggered "${zap.name}".`,
        data: {
          zapName: zap.name,
          zapId: zap.id,
          httpStatus: result.status,
          raw: result.raw,
        },
      };
    }

    default:
      return {
        status: 'error',
        message: `Unknown Zapier tool: "${toolName}".`,
      };
  }
};
