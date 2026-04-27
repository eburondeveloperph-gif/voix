/**
 * r task ...
 * Agent Registry & Dispatcher
 *
 * Maps tool names to their specialized agent handlers.
 * Beatrice (the orchestrator) calls dispatchToAgent() whenever a tool
 * needs to be executed — the registry routes it to the right worker.
 */
import type { ConversationContext } from '@/lib/conversation-context';
import type { AgentHandler, AgentResult } from './types';
import * as emailAgent from './email-agent';
import * as calendarAgent from './calendar-agent';
import * as documentAgent from './document-agent';
import * as driveAgent from './drive-agent';
import * as imageAgent from './image-agent';
import * as navigationAgent from './navigation-agent';
import * as videoAgent from './video-agent';
import * as visionAgent from './vision-agent';
import * as customerSupportAgent from './customer-support-agent';
import * as eburonflixAgent from './eburonflix-agent';
import * as conversationMemoryAgent from './conversation-memory-agent';
import * as knowledgeBaseAgent from './knowledge-base-agent';
import * as whatsappAgent from './whatsapp-agent';
import * as zapierAgent from './zapier-agent';

/**
 * Each entry maps a tool name or name prefix to its handler.
 * Prefix matching uses `startsWith` — so 'gmail_' matches 'gmail_send', 'gmail_read', etc.
 */
type AgentEntry = {
  handler: AgentHandler;
  /** If true, match by prefix (startsWith). If false, match exact name only. */
  prefix: boolean;
};

const registry = new Map<string, AgentEntry>();

// ── Email Agent ─────────────────────────────────────────
registry.set('gmail_', { handler: emailAgent.handle, prefix: true });
registry.set('send_email', { handler: emailAgent.handle, prefix: false });

// ── Calendar Agent ─────────────────────────────────────
registry.set('calendar_', { handler: calendarAgent.handle, prefix: true });
registry.set('create_calendar_event', { handler: calendarAgent.handle, prefix: false });
registry.set('meet_', { handler: calendarAgent.handle, prefix: true });
registry.set('set_reminder', { handler: calendarAgent.handle, prefix: false });

// ── Document Agent ─────────────────────────────────────
registry.set('document_', { handler: documentAgent.handle, prefix: true });

// ── Drive / Docs Agent ─────────────────────────────────
registry.set('drive_', { handler: driveAgent.handle, prefix: true });
registry.set('docs_', { handler: driveAgent.handle, prefix: true });

// ── Navigation Agent ───────────────────────────────────
registry.set('find_route', { handler: navigationAgent.handle, prefix: false });
registry.set('maps_', { handler: navigationAgent.handle, prefix: true });
registry.set('find_nearby_places', { handler: navigationAgent.handle, prefix: false });
registry.set('get_traffic_info', { handler: navigationAgent.handle, prefix: false });

// ── Video Agent ────────────────────────────────────────
registry.set('video_', { handler: videoAgent.handle, prefix: true });

// ── Image Agent ────────────────────────────────────────
registry.set('image_', { handler: imageAgent.handle, prefix: true });

// ── Vision / CCTV Agent ────────────────────────────────
registry.set('vision_', { handler: visionAgent.handle, prefix: true });

// ── Customer Support Agent ─────────────────────────────
registry.set('start_return', { handler: customerSupportAgent.handle, prefix: false });
registry.set('get_order_status', { handler: customerSupportAgent.handle, prefix: false });
registry.set('speak_to_representative', { handler: customerSupportAgent.handle, prefix: false });

// ── EburonFlix Agent ───────────────────────────────────
registry.set('eburonflix_', { handler: eburonflixAgent.handle, prefix: true });

// ── Conversation Memory Agent ──────────────────────────
registry.set('remember_this', { handler: conversationMemoryAgent.handle, prefix: false });
registry.set('remember_that', { handler: conversationMemoryAgent.handle, prefix: false });
registry.set('conversation_memory_', { handler: conversationMemoryAgent.handle, prefix: true });
registry.set('conversation_history_', { handler: conversationMemoryAgent.handle, prefix: true });

// ── Knowledge Base Agent (/files) ──────────────────────
registry.set('knowledge_base_', { handler: knowledgeBaseAgent.handle, prefix: true });

// ── WhatsApp Agent (Meta Cloud API) ───────────────────
registry.set('whatsapp_', { handler: whatsappAgent.handle, prefix: true });

// ── Zapier Agent (Catch Hook webhooks) ────────────────
registry.set('zapier_', { handler: zapierAgent.handle, prefix: true });

/**
 * Routes a tool call to the correct specialized agent.
 *
 * Matching strategy:
 * 1. Try exact match first (no prefix)
 * 2. Then try prefix matches (tool name starts with registered key)
 */
export async function dispatchToAgent(
  toolName: string,
  args: Record<string, any>,
  ctx: ConversationContext,
): Promise<AgentResult> {
  // 1. Try exact match
  const exactEntry = registry.get(toolName);
  if (exactEntry && !exactEntry.prefix) {
    return exactEntry.handler(toolName, args, ctx);
  }

  // 2. Try prefix match
  for (const [key, entry] of registry) {
    if (entry.prefix && toolName.startsWith(key)) {
      return entry.handler(toolName, args, ctx);
    }
  }

  // 3. No agent found
  return {
    status: 'error',
    message: `No agent is configured for the tool "${toolName}". I did not generate mock data.`,
  };
}

/**
 * Returns the list of all registered agent tool name patterns (for logging/debug).
 */
export function getRegisteredAgentKeys(): string[] {
  return Array.from(registry.keys());
}
