/**on
 * Conversation Memory Agent
 *
 * Handles the remember_this and conversation_memory_* tool calls.
 * Saves and retrieves personalized conversation memories (facts, preferences,
 * important events) per user.
 *
 * This is DIFFERENT from document memory — this captures what the user says
 * about themselves in conversation, not what's extracted from scanned documents.
 */

import type { AgentHandler, AgentResult } from './types';
import { ConversationMemory } from '@/lib/conversation-memory';

export const handle: AgentHandler = async (
  toolName: string,
  args: Record<string, any>,
  ctx,
): Promise<AgentResult> => {
  switch (toolName) {
    // ── Remember This ──────────────────────────────────
    case 'remember_this': {
      const fact = args.fact as string;
      if (!fact || !fact.trim()) {
        return {
          status: 'error',
          message: 'Cannot save an empty memory. Please provide a fact to remember.',
        };
      }

      const category = (args.category as string) || 'general';
      const importance = (args.importance as string) || 'medium';
      const tags = args.tags as string[] | undefined;

      // Validate importance
      const validImportances = ['low', 'medium', 'high', 'critical'];
      const safeImportance = validImportances.includes(importance)
        ? (importance as 'low' | 'medium' | 'high' | 'critical')
        : 'medium';

      const memory = await ConversationMemory.save(fact, {
        category,
        importance: safeImportance,
        tags,
        userId: ctx.userId,
      });

      return {
        status: 'success',
        message: `Saved to memory: ${memory.fact}`,
        data: {
          id: memory.id,
          fact: memory.fact,
          category: memory.category,
          importance: memory.importance,
        },
      };
    }

    // ── Remember That (Shorthand for "remember this about user") ──
    case 'remember_that': {
      const fact = args.fact as string;
      if (!fact || !fact.trim()) {
        return {
          status: 'error',
          message: 'Cannot save an empty memory. Please provide a fact to remember.',
        };
      }

      const category = (args.category as string) || 'personal';
      const importance = (args.importance as string) || 'medium';
      const tags = args.tags as string[] | undefined;

      const validImportances = ['low', 'medium', 'high', 'critical'];
      const safeImportance = validImportances.includes(importance)
        ? (importance as 'low' | 'medium' | 'high' | 'critical')
        : 'medium';

      const memory = await ConversationMemory.save(fact, {
        category,
        importance: safeImportance,
        tags,
        userId: ctx.userId,
      });

      return {
        status: 'success',
        message: `I'll remember that: ${memory.fact}`,
        data: {
          id: memory.id,
          fact: memory.fact,
          category: memory.category,
          importance: memory.importance,
        },
      };
    }

    // ── Search Conversation Memories ───────────────────
    case 'conversation_memory_search': {
      const query = args.query as string;
      if (!query || !query.trim()) {
        return {
          status: 'error',
          message: 'Please provide a search query to find relevant memories.',
        };
      }

      const limitCount = (args.limit as number) || 5;
      const results = ConversationMemory.search(query, {
        limit: limitCount,
        userId: ctx.userId,
      });

      if (results.length === 0) {
        return {
          status: 'success',
          message: 'I searched my memories but couldn\'t find anything matching that query.',
          data: { memories: [] },
        };
      }

      const memoryList = results.map(r => ({
        id: r.memory.id,
        fact: r.memory.fact,
        category: r.memory.category,
        importance: r.memory.importance,
        createdAt: r.memory.createdAt,
        score: r.score,
      }));

      return {
        status: 'success',
        message: `Found ${results.length} relevant memory/memories.`,
        data: { memories: memoryList },
      };
    }

    // ── Get Recent Memories ────────────────────────────
    case 'conversation_memory_recent': {
      const limitCount = (args.limit as number) || 10;
      const memories = ConversationMemory.getRecentMemories({
        limit: limitCount,
        userId: ctx.userId,
      });

      if (memories.length === 0) {
        return {
          status: 'success',
          message: 'You don\'t have any saved memories yet. Just tell me to remember something important!',
          data: { memories: [] },
        };
      }

      return {
        status: 'success',
        message: `Here are your ${memories.length} most important memories.`,
        data: {
          memories: memories.map(m => ({
            id: m.id,
            fact: m.fact,
            category: m.category,
            importance: m.importance,
          })),
        },
      };
    }

    // ── Forget a Memory ────────────────────────────────
    case 'conversation_memory_forget': {
      const fact = args.fact as string;
      const memoryId = args.memoryId as string;

      if (memoryId) {
        const deleted = await ConversationMemory.delete(memoryId, { userId: ctx.userId });
        if (!deleted) {
          return {
            status: 'error',
            message: 'I couldn\'t find a memory with that id to forget.',
          };
        }
        return {
          status: 'success',
          message: 'I\'ve forgotten that memory.',
          data: { deleted: true },
        };
      }

      if (fact) {
        const count = await ConversationMemory.deleteByFact(fact, { userId: ctx.userId });
        if (count === 0) {
          return {
            status: 'error',
            message: 'I couldn\'t find any memories matching that to forget.',
          };
        }
        return {
          status: 'success',
          message: count > 1
            ? `I've forgotten ${count} memories matching that.`
            : 'I\'ve forgotten that memory.',
          data: { deleted: count },
        };
      }

      return {
        status: 'error',
        message: 'Please specify which memory to forget — either by id or by describing the fact.',
      };
    }

    // ── Load User Memory Context (for session init) ────
    case 'conversation_memory_load_context': {
      const limitCount = (args.limit as number) || 15;
      const contextString = await ConversationMemory.loadUserContext({
        userId: ctx.userId,
        limit: limitCount,
      });

      return {
        status: 'success',
        message: contextString || 'No saved memories for this user yet.',
        data: { context: contextString },
      };
    }

    default:
      return {
        status: 'error',
        message: `Unknown conversation memory tool: "${toolName}".`,
      };
  }
};
