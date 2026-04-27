/**
 * Knowledge Base Agent
 *
 * Handles knowledge_base_list / knowledge_base_search / knowledge_base_get tools.
 * Reads from KnowledgeBase (which is backed by MemoryService + the static
 * /files seed data).
 */

import type { AgentHandler, AgentResult } from './types';
import { KnowledgeBase } from '@/lib/knowledge-base';

export const handle: AgentHandler = async (
  toolName: string,
  args: Record<string, any>,
  ctx,
): Promise<AgentResult> => {
  switch (toolName) {
    case 'knowledge_base_list': {
      const entries = KnowledgeBase.list(ctx.userId);
      if (entries.length === 0) {
        return {
          status: 'success',
          message: 'The /files knowledge base is empty for this user.',
          data: { entries: [] },
        };
      }
      return {
        status: 'success',
        message: `${entries.length} document${entries.length === 1 ? '' : 's'} on file in the /files knowledge base.`,
        data: {
          entries: entries.map(e => ({
            id: e.id,
            title: e.title,
            sourcePath: e.sourcePath,
            mimeType: e.mimeType,
            shortSummary: e.shortSummary,
          })),
        },
      };
    }

    case 'knowledge_base_search': {
      const query = (args.query as string)?.trim();
      if (!query) {
        return {
          status: 'error',
          message: 'A query is required to search the knowledge base.',
        };
      }
      const limit = Math.min(Math.max(Number(args.limit) || 3, 1), 8);
      const results = await KnowledgeBase.search(query, { limit, userId: ctx.userId });
      if (results.length === 0) {
        return {
          status: 'success',
          message: `No /files documents matched "${query}".`,
          data: { results: [] },
        };
      }
      return {
        status: 'success',
        message: `Found ${results.length} relevant document${results.length === 1 ? '' : 's'} in the knowledge base.`,
        data: {
          query,
          results: results.map(r => ({
            id: r.id,
            title: r.title,
            sourcePath: r.sourcePath,
            shortSummary: r.shortSummary,
            excerpt: r.excerpt,
            score: Number(r.score.toFixed(3)),
          })),
        },
      };
    }

    case 'knowledge_base_get': {
      const idOrTitle = (args.idOrTitle as string)?.trim();
      if (!idOrTitle) {
        return {
          status: 'error',
          message: 'Provide a document id or a title fragment.',
        };
      }
      const maxChars = Math.min(Math.max(Number(args.maxChars) || 3500, 200), 8000);
      const entry = KnowledgeBase.get(idOrTitle, { maxChars, userId: ctx.userId });
      if (!entry) {
        return {
          status: 'error',
          message: `No /files document matched "${idOrTitle}".`,
        };
      }
      return {
        status: 'success',
        message: `Loaded "${entry.title}" from the knowledge base.`,
        data: {
          id: entry.id,
          title: entry.title,
          sourcePath: entry.sourcePath,
          mimeType: entry.mimeType,
          shortSummary: entry.shortSummary,
          fullText: entry.fullText,
        },
      };
    }

    default:
      return {
        status: 'error',
        message: `Unknown knowledge-base tool: "${toolName}".`,
      };
  }
};
