/**
 * Knowledge Base — `/files` documents made fetchable by Beatrice
 *
 * The repository's `/files` folder is seeded into MemoryService as
 * `permanent_knowledge` records (see lib/document/permanent-knowledge-data.ts
 * and PermanentKnowledgeService.syncFilesKnowledgeToMemory). This module is
 * the read surface that Beatrice uses to:
 *
 *   • Receive a high-level "table of contents" of the knowledge base at the
 *     start of every Live session, so she can reference documents by name
 *     without being asked first.
 *   • Run keyword + vector search across the documents on demand
 *     (knowledge_base_search tool).
 *   • Pull a specific document by id/title (knowledge_base_get tool).
 *
 * The knowledge base is per-user only because MemoryService is keyed by user,
 * but the seed data is identical for everyone — every signed-in user gets
 * the same baseline `/files` knowledge.
 */

import { MemoryService } from './document/memory-service';
import { getEffectiveUserId } from './document/utils';
import {
  PERMANENT_KNOWLEDGE_DOCUMENTS,
  type PermanentKnowledgeDocument,
} from './document/permanent-knowledge-data';
import type { ScannedDocumentRecord } from './document/types';

// ─── Types ─────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  title: string;
  sourcePath: string;
  mimeType: string;
  shortSummary: string;
  excerpt: string;
  /** When backed by a saved scan record, the full record id */
  documentId?: string;
  /** Whether this came from a live MemoryService record (true) or the static seed (false) */
  fromMemory: boolean;
}

export interface KnowledgeSearchResult extends KnowledgeEntry {
  score: number;
}

// ─── Helpers ──────────────────────────────────────────

const truncate = (text: string, n: number) => {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  return cleaned.length > n ? `${cleaned.slice(0, n)}…` : cleaned;
};

function recordToEntry(rec: ScannedDocumentRecord): KnowledgeEntry {
  return {
    id: rec.document_id,
    title: rec.title,
    sourcePath: (rec.image_metadata?.source_path as string) || rec.source_name || rec.title,
    mimeType: (rec.image_metadata?.mime_type as string) || 'application/octet-stream',
    shortSummary: rec.analysis?.short_summary || '',
    excerpt: truncate(rec.ocr?.cleaned_text || '', 600),
    documentId: rec.document_id,
    fromMemory: true,
  };
}

function staticToEntry(doc: PermanentKnowledgeDocument): KnowledgeEntry {
  return {
    id: doc.id,
    title: doc.title,
    sourcePath: doc.sourcePath,
    mimeType: doc.mimeType,
    shortSummary: '', // no summary on the seed data
    excerpt: truncate(doc.text, 600),
    fromMemory: false,
  };
}

function listMemoryEntries(userId: string): KnowledgeEntry[] {
  try {
    const state = MemoryService.getPersistedState(userId);
    const filtered = state.documents.filter(rec => {
      const meta = (rec as any).image_metadata || {};
      return meta?.permanent_knowledge === true;
    });
    return filtered.map(recordToEntry);
  } catch {
    return [];
  }
}

// ─── Public API ───────────────────────────────────────

export const KnowledgeBase = {
  /**
   * Returns the list of knowledge-base entries for the current user.
   * Falls back to the static seed when MemoryService hasn't synced yet
   * (e.g. brand new login or local-dev mode), so Beatrice always sees
   * something useful.
   */
  list(userId: string = getEffectiveUserId()): KnowledgeEntry[] {
    const memEntries = listMemoryEntries(userId);
    if (memEntries.length > 0) return memEntries;
    return PERMANENT_KNOWLEDGE_DOCUMENTS.map(staticToEntry);
  },

  /**
   * Builds the compact "knowledge base contents" block injected at session
   * start. Empty string if no entries (shouldn't happen — seed covers it).
   */
  buildContextBlock(userId?: string): string {
    const entries = this.list(userId);
    if (entries.length === 0) return '';

    const lines = entries.map((e, idx) => {
      const summaryFragment = e.shortSummary
        ? ` — ${truncate(e.shortSummary, 220)}`
        : '';
      return `${idx + 1}. "${e.title}" [${e.sourcePath.replace(/^\/files\//, '')}]${summaryFragment}`;
    });

    return [
      `[KNOWLEDGE BASE — ${entries.length} document${entries.length === 1 ? '' : 's'} on file from /files]`,
      'These are reference documents you can cite by name and search via knowledge_base_search:',
      ...lines,
    ].join('\n');
  },

  /**
   * Search the knowledge base for relevant documents.
   * Uses MemoryService.searchMemory (vector + heuristic) when entries are in
   * memory; otherwise falls back to a keyword scan over the seed data.
   */
  async search(
    queryText: string,
    options: { limit?: number; userId?: string } = {},
  ): Promise<KnowledgeSearchResult[]> {
    const limit = options.limit ?? 5;
    const userId = options.userId || getEffectiveUserId();
    const memEntries = listMemoryEntries(userId);

    // Prefer in-memory vector search
    if (memEntries.length > 0) {
      try {
        const results = await MemoryService.searchMemory(queryText, { limit });
        // Filter to only permanent-knowledge documents
        const filtered = results.filter(r => {
          const meta = (r.document as any).image_metadata || {};
          return meta?.permanent_knowledge === true;
        });
        return filtered.map(r => ({
          ...recordToEntry(r.document),
          score: r.score,
        }));
      } catch (e) {
        console.warn('Knowledge base vector search failed, falling back to keyword:', e);
      }
    }

    // Keyword scan fallback
    const q = queryText.toLowerCase();
    const tokens = q.split(/\s+/).filter(t => t.length >= 3);
    const seedHits: KnowledgeSearchResult[] = PERMANENT_KNOWLEDGE_DOCUMENTS.map(doc => {
      const haystack = `${doc.title}\n${doc.text}`.toLowerCase();
      let score = 0;
      if (haystack.includes(q)) score += 1;
      for (const tok of tokens) {
        if (haystack.includes(tok)) score += 0.25;
      }
      return { ...staticToEntry(doc), score };
    })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return seedHits;
  },

  /**
   * Fetch a single document by id (memory-backed) or by title-substring.
   * Returns the full text excerpt up to `maxChars`.
   */
  get(
    idOrTitle: string,
    options: { maxChars?: number; userId?: string } = {},
  ): (KnowledgeEntry & { fullText: string }) | null {
    const userId = options.userId || getEffectiveUserId();
    const maxChars = options.maxChars ?? 4000;
    const needle = idOrTitle.toLowerCase().trim();
    if (!needle) return null;

    // Try in-memory record first
    try {
      const state = MemoryService.getPersistedState(userId);
      const rec = state.documents.find(d => {
        const meta = (d as any).image_metadata || {};
        if (meta?.permanent_knowledge !== true) return false;
        return (
          d.document_id.toLowerCase() === needle ||
          d.title.toLowerCase().includes(needle)
        );
      });
      if (rec) {
        return {
          ...recordToEntry(rec),
          fullText: truncate(rec.ocr?.cleaned_text || '', maxChars),
        };
      }
    } catch {
      // ignore
    }

    // Fallback to seed
    const seed = PERMANENT_KNOWLEDGE_DOCUMENTS.find(
      d => d.id.toLowerCase() === needle || d.title.toLowerCase().includes(needle),
    );
    if (seed) {
      return {
        ...staticToEntry(seed),
        fullText: truncate(seed.text, maxChars),
      };
    }

    return null;
  },
};
