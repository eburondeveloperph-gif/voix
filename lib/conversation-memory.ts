/**
 * Conversation Memory
 *
 * Stores personalized conversation memories (facts, preferences, important events)
 * per user. Independent from document memory — this captures what the user says
 * about themselves, not what's extracted from scanned documents.
 *
 * Persists to localStorage per-user (like MemoryService) and syncs to Firestore
 * for cross-device availability when the user is authenticated.
 */

import { getEffectiveUserId, createId, nowIso } from './document/utils';
import { db } from './firebase';
import { doc, setDoc, getDoc, collection, query, where, getDocs, orderBy, limit, deleteDoc } from 'firebase/firestore';

// ─── Types ─────────────────────────────────────────────

export type MemoryImportance = 'low' | 'medium' | 'high' | 'critical';

export interface ConversationMemoryRecord {
  /** Unique memory id */
  id: string;
  /** User this memory belongs to */
  userId: string;
  /** The remembered fact/event/preference */
  fact: string;
  /** Category for grouping (e.g., "preference", "fact", "event", "personal", "instruction") */
  category: string;
  /** How important this memory is */
  importance: MemoryImportance;
  /** When this memory was created */
  createdAt: string;
  /** When this memory was last accessed/used */
  lastAccessedAt: string;
  /** How many times this memory has been referenced */
  accessCount: number;
  /** Optional tags for filtering */
  tags: string[];
}

export interface MemorySearchResult {
  memory: ConversationMemoryRecord;
  score: number;
}

// ─── Constants ─────────────────────────────────────────

const STORAGE_VERSION = 1;
const STORAGE_KEY_PREFIX = 'beatrice_conversation_memory_v';
const LOCAL_MEMORY_LIMIT = 200; // max memories per user in localStorage
const RECENT_MEMORY_SLOT_COUNT = 15; // how many recent/frequent memories to show in context

// ─── Local Storage Helpers ─────────────────────────────

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${STORAGE_VERSION}_${userId}`;
}

function getPersistedMemories(userId: string): ConversationMemoryRecord[] {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (raw) {
      return JSON.parse(raw) as ConversationMemoryRecord[];
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function persistMemories(userId: string, memories: ConversationMemoryRecord[]) {
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(memories));
  } catch {
    // localStorage quota exceeded — trim oldest low-importance memories
    try {
      const trimmed = memories
        .sort((a, b) => {
          const importanceOrder: Record<MemoryImportance, number> = { critical: 4, high: 3, medium: 2, low: 1 };
          return (importanceOrder[b.importance] || 0) - (importanceOrder[a.importance] || 0);
        })
        .slice(0, LOCAL_MEMORY_LIMIT);
      localStorage.setItem(getStorageKey(userId), JSON.stringify(trimmed));
    } catch {
      // give up
    }
  }
}

// ─── Simple Text Search ────────────────────────────────

function simpleTextScore(query: string, text: string): number {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  if (textLower === queryLower) return 1.0;
  if (textLower.includes(queryLower)) return 0.8;

  const queryWords = queryLower.split(/\s+/).filter(Boolean);
  const textWords = textLower.split(/\s+/).filter(Boolean);

  let matchCount = 0;
  for (const qw of queryWords) {
    if (textWords.some(tw => tw.includes(qw) || qw.includes(tw))) {
      matchCount += 1;
    }
  }

  if (queryWords.length === 0) return 0;
  return matchCount / queryWords.length * 0.7;
}

// ─── Firestore Sync ────────────────────────────────────

const FIRESTORE_COLLECTION = 'conversation_memories';

async function syncToFirestore(memory: ConversationMemoryRecord): Promise<void> {
  if (!memory.userId || memory.userId === 'local-dev-user') return;
  try {
    const docRef = doc(db, FIRESTORE_COLLECTION, memory.id);
    await setDoc(docRef, {
      ...memory,
      serverTimestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Firestore sync failed for conversation memory:', e);
  }
}

async function deleteFromFirestore(memoryId: string, userId: string): Promise<void> {
  if (userId === 'local-dev-user') return;
  try {
    await deleteDoc(doc(db, FIRESTORE_COLLECTION, memoryId));
  } catch (e) {
    console.warn('Firestore delete failed for conversation memory:', e);
  }
}

async function syncFromFirestore(userId: string): Promise<ConversationMemoryRecord[]> {
  if (userId === 'local-dev-user') return [];
  try {
    const q = query(
      collection(db, FIRESTORE_COLLECTION),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(LOCAL_MEMORY_LIMIT),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data() as ConversationMemoryRecord);
  } catch (e) {
    console.warn('Firestore sync-from failed for conversation memory:', e);
    return [];
  }
}

// ─── Public API ────────────────────────────────────────

export class ConversationMemory {
  /**
   * Save a new conversation memory.
   * Returns the created memory record.
   */
  static async save(
    fact: string,
    options?: {
      category?: string;
      importance?: MemoryImportance;
      tags?: string[];
      userId?: string;
    },
  ): Promise<ConversationMemoryRecord> {
    const userId = options?.userId || getEffectiveUserId();
    const memories = getPersistedMemories(userId);
    const now = nowIso();

    // Check for duplicate (same fact already exists — update it instead)
    const existing = memories.find(
      m => m.fact.toLowerCase().trim() === fact.toLowerCase().trim(),
    );
    if (existing) {
      existing.lastAccessedAt = now;
      existing.accessCount += 1;
      if (options?.category) existing.category = options.category;
      if (options?.importance) existing.importance = options.importance;
      if (options?.tags) existing.tags = [...new Set([...existing.tags, ...options.tags])];
      persistMemories(userId, memories);

      const updatedRecord: ConversationMemoryRecord = {
        ...existing,
        createdAt: existing.createdAt,
        lastAccessedAt: now,
      };
      await syncToFirestore(updatedRecord);
      return updatedRecord;
    }

    const memory: ConversationMemoryRecord = {
      id: createId('cmem'),
      userId,
      fact: fact.trim(),
      category: options?.category || 'general',
      importance: options?.importance || 'medium',
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      tags: options?.tags || [],
    };

    memories.push(memory);
    persistMemories(userId, memories);
    await syncToFirestore(memory);

    return memory;
  }

  /**
   * Search conversation memories matching a query.
   * Uses simple text scoring sorted by relevance + importance + recency.
   */
  static search(
    query: string,
    options?: {
      limit?: number;
      minImportance?: MemoryImportance;
      userId?: string;
    },
  ): MemorySearchResult[] {
    const userId = options?.userId || getEffectiveUserId();
    const memories = getPersistedMemories(userId);
    const minImpOrder: Record<MemoryImportance, number> = {
      low: 0, medium: 1, high: 2, critical: 3,
    };
    const minScore = minImpOrder[options?.minImportance || 'low'] || 0;

    const scored = memories
      .filter(m => (minImpOrder[m.importance] || 0) >= minScore)
      .map(m => {
        const textScore = simpleTextScore(query, m.fact);
        const importanceBonus = (minImpOrder[m.importance] || 0) * 0.1;
        const recencyBonus = Math.min(
          (Date.now() - new Date(m.lastAccessedAt).getTime()) / (7 * 24 * 60 * 60 * 1000),
          1,
        ) * 0.05;
        const frequencyBonus = Math.min(m.accessCount / 10, 1) * 0.05;

        return {
          memory: m,
          score: textScore + importanceBonus + recencyBonus + frequencyBonus,
        };
      })
      .filter(r => r.score > 0.1)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, options?.limit || 10);
  }

  /**
   * Get the most recent or most frequently accessed memories.
   * This is used to load "what Beatrice remembers about this user" at session start.
   */
  static getRecentMemories(
    options?: {
      limit?: number;
      userId?: string;
    },
  ): ConversationMemoryRecord[] {
    const userId = options?.userId || getEffectiveUserId();
    const memories = getPersistedMemories(userId);

    // Sort by: importance (high first), then access count, then recency
    const importanceOrder: Record<MemoryImportance, number> = {
      critical: 100, high: 10, medium: 5, low: 1,
    };

    return [...memories]
      .sort((a, b) => {
        const impA = importanceOrder[a.importance] || 0;
        const impB = importanceOrder[b.importance] || 0;
        if (impA !== impB) return impB - impA;
        if (b.accessCount !== a.accessCount) return b.accessCount - a.accessCount;
        return new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime();
      })
      .slice(0, options?.limit || RECENT_MEMORY_SLOT_COUNT);
  }

  /**
   * Get all memories for a user (for full context).
   */
  static getAll(options?: { userId?: string }): ConversationMemoryRecord[] {
    const userId = options?.userId || getEffectiveUserId();
    return getPersistedMemories(userId);
  }

  /**
   * Delete a specific memory by id.
   */
  static async delete(
    memoryId: string,
    options?: { userId?: string },
  ): Promise<boolean> {
    const userId = options?.userId || getEffectiveUserId();
    const memories = getPersistedMemories(userId);
    const idx = memories.findIndex(m => m.id === memoryId);
    if (idx === -1) return false;

    memories.splice(idx, 1);
    persistMemories(userId, memories);
    await deleteFromFirestore(memoryId, userId);
    return true;
  }

  /**
   * Delete memories matching a fact (by text).
   */
  static async deleteByFact(
    fact: string,
    options?: { userId?: string },
  ): Promise<number> {
    const userId = options?.userId || getEffectiveUserId();
    const memories = getPersistedMemories(userId);
    const factLower = fact.toLowerCase().trim();
    const toDelete = memories.filter(
      m => m.fact.toLowerCase().includes(factLower) || factLower.includes(m.fact.toLowerCase()),
    );

    if (toDelete.length === 0) return 0;

    const remaining = memories.filter(m => !toDelete.find(d => d.id === m.id));
    persistMemories(userId, remaining);

    for (const m of toDelete) {
      await deleteFromFirestore(m.id, userId);
    }

    return toDelete.length;
  }

  /**
   * Initialize (load from Firestore if available) and return
   * a formatted context string of what Beatrice remembers about this user.
   */
  static async loadUserContext(options?: {
    userId?: string;
    limit?: number;
  }): Promise<string> {
    const userId = options?.userId || getEffectiveUserId();
    const limitCount = options?.limit || RECENT_MEMORY_SLOT_COUNT;

    // Try to sync from Firestore first (for logged-in users)
    if (userId !== 'local-dev-user') {
      try {
        const remoteMemories = await syncFromFirestore(userId);
        if (remoteMemories.length > 0) {
          // Merge with local (remote wins)
          const localMemories = getPersistedMemories(userId);
          const merged = [...remoteMemories];
          for (const local of localMemories) {
            if (!merged.find(m => m.id === local.id)) {
              merged.push(local);
            }
          }
          persistMemories(userId, merged);
        }
      } catch {
        // best-effort
      }
    }

    const topMemories = this.getRecentMemories({ userId, limit: limitCount });
    if (topMemories.length === 0) return '';

    const parts = topMemories.map(
      m => `- [${m.importance}] ${m.category}: ${m.fact}`,
    );

    return `I remember these things about this user:\n${parts.join('\n')}`;
  }
}
