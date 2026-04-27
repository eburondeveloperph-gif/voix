/**
 * Conversation History — Long-Term Memory of Past Conversations
 *
 * Persists every voice/chat turn per user, locally + in Firestore, so
 * Beatrice can fetch a summary of past conversations at the start of every
 * new session. This is the "I remember our last chats" capability — separate
 * from `conversation-memory.ts` (which stores explicit fact memories saved
 * via the remember_this tool) and from `document/memory-service.ts` (which
 * stores OCR scan memory).
 *
 * Flow:
 *   • Every final turn from voice (StreamingConsole.handleTurnComplete) and
 *     chat (App.sendChatMessage) is appended via recordTurn().
 *   • Turns are bucketed per-user in localStorage and mirrored to Firestore
 *     ('conversation_history' collection). Local cap = 500 turns.
 *   • At session start, use-live-api.onSetupComplete() awaits
 *     loadHistoryContextForSession(userId), which pulls the last N turns
 *     and—if there are many—asks a background Gemini model to compress
 *     them into a 4-8 line digest. The digest is cached for 12h.
 *   • The digest text is sent into the Live session as a `[USER HISTORY
 *     CONTEXT]` system message before the greeting, so Beatrice can speak
 *     about prior topics naturally.
 */

import { db } from './firebase';
import { collection, query, where, orderBy, limit as fsLimit, getDocs } from 'firebase/firestore';
import { safeAddDoc } from './firestore-safe';
import { getRuntimeUserIdentity } from './user-profile';

// ─── Types ─────────────────────────────────────────────

export type HistoryRole = 'user' | 'agent' | 'system';
export type HistorySource = 'voice' | 'chat' | 'system';

export interface HistoryTurn {
  /** Local id (millis + random suffix) */
  id: string;
  /** Owner — never share across users */
  userId: string;
  /** Who said it */
  role: HistoryRole;
  /** Final transcript / message text */
  text: string;
  /** Epoch ms */
  timestamp: number;
  /** Where it came from */
  source: HistorySource;
  /** Optional session correlation id */
  sessionId?: string;
}

interface HistorySummaryCache {
  userId: string;
  /** The compressed history block that gets injected into Beatrice's context */
  digest: string;
  /** Number of raw turns the digest summarizes */
  turnCount: number;
  /** When the digest was generated (epoch ms) */
  generatedAt: number;
  /** Latest turn timestamp included in this digest (epoch ms) */
  coversThrough: number;
}

// ─── Constants ─────────────────────────────────────────

const STORAGE_VERSION = 1;
const HISTORY_KEY_PREFIX = `beatrice_conv_history_v${STORAGE_VERSION}_`;
const SUMMARY_KEY_PREFIX = `beatrice_conv_history_summary_v${STORAGE_VERSION}_`;
const FIRESTORE_HISTORY_COLLECTION = 'conversation_history';

const LOCAL_TURN_CAP = 500;
const SESSION_CONTEXT_TURN_LIMIT = 60; // how many recent turns to consider for the digest
const SUMMARY_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MIN_TURNS_FOR_AI_SUMMARY = 8; // below this, just list turns verbatim

// ─── Local Storage Helpers ─────────────────────────────

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

function historyKey(userId: string): string {
  return `${HISTORY_KEY_PREFIX}${userId}`;
}
function summaryKey(userId: string): string {
  return `${SUMMARY_KEY_PREFIX}${userId}`;
}

function readLocalTurns(userId: string): HistoryTurn[] {
  if (!isBrowser) return [];
  try {
    const raw = localStorage.getItem(historyKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalTurns(userId: string, turns: HistoryTurn[]) {
  if (!isBrowser) return;
  try {
    // Cap to LOCAL_TURN_CAP, keeping the most recent
    const trimmed = turns.length > LOCAL_TURN_CAP
      ? turns.slice(turns.length - LOCAL_TURN_CAP)
      : turns;
    localStorage.setItem(historyKey(userId), JSON.stringify(trimmed));
  } catch {
    // Quota exceeded — try to drop half and retry once
    try {
      const half = turns.slice(turns.length - Math.floor(LOCAL_TURN_CAP / 2));
      localStorage.setItem(historyKey(userId), JSON.stringify(half));
    } catch {
      // Give up
    }
  }
}

function readCachedSummary(userId: string): HistorySummaryCache | null {
  if (!isBrowser) return null;
  try {
    const raw = localStorage.getItem(summaryKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as HistorySummaryCache;
  } catch {
    return null;
  }
}

function writeCachedSummary(cache: HistorySummaryCache) {
  if (!isBrowser) return;
  try {
    localStorage.setItem(summaryKey(cache.userId), JSON.stringify(cache));
  } catch {
    // ignore
  }
}

// ─── ID + Time Helpers ────────────────────────────────

function makeTurnId(): string {
  return `htn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isValidUserId(userId: string | undefined | null): userId is string {
  return Boolean(userId && userId !== 'local-dev-user');
}

// ─── Firestore Sync ───────────────────────────────────

async function pushTurnToFirestore(turn: HistoryTurn): Promise<void> {
  if (!isValidUserId(turn.userId)) return;
  try {
    await safeAddDoc(db, FIRESTORE_HISTORY_COLLECTION, {
      user_id: turn.userId,
      role: turn.role,
      text: turn.text,
      timestamp: turn.timestamp,
      source: turn.source,
      session_id: turn.sessionId ?? null,
      client_id: turn.id,
    });
  } catch (e) {
    console.warn('Conversation history Firestore push failed:', e);
  }
}

async function fetchTurnsFromFirestore(
  userId: string,
  maxTurns: number,
): Promise<HistoryTurn[]> {
  if (!isValidUserId(userId)) return [];
  try {
    const q = query(
      collection(db, FIRESTORE_HISTORY_COLLECTION),
      where('user_id', '==', userId),
      orderBy('timestamp', 'desc'),
      fsLimit(maxTurns),
    );
    const snap = await getDocs(q);
    const remote: HistoryTurn[] = [];
    snap.forEach(doc => {
      const data = doc.data() as any;
      const ts = typeof data.timestamp === 'number'
        ? data.timestamp
        : data.timestamp?.toMillis?.() ?? Date.now();
      remote.push({
        id: data.client_id || `remote_${doc.id}`,
        userId: data.user_id || userId,
        role: (data.role as HistoryRole) || 'user',
        text: String(data.text ?? ''),
        timestamp: ts,
        source: (data.source as HistorySource) || 'voice',
        sessionId: data.session_id || undefined,
      });
    });
    // ascending order so it slots into the local list naturally
    remote.sort((a, b) => a.timestamp - b.timestamp);
    return remote;
  } catch (e) {
    console.warn('Conversation history Firestore fetch failed:', e);
    return [];
  }
}

// ─── Public API ───────────────────────────────────────

export interface RecordTurnOptions {
  userId?: string;
  source?: HistorySource;
  sessionId?: string;
  /** Skip Firestore mirror (for batched/imported turns) */
  skipRemote?: boolean;
}

/**
 * Append a single conversation turn to the user's long-term history.
 * Trivial turns (empty / single-word fragments) are skipped to keep the
 * digest signal-rich.
 */
export async function recordTurn(
  role: HistoryRole,
  text: string,
  options: RecordTurnOptions = {},
): Promise<HistoryTurn | null> {
  const cleaned = (text || '').trim();
  if (!cleaned) return null;
  // Skip filler — single token, no spaces, very short utterances
  if (cleaned.length < 2) return null;

  const userId = options.userId || getRuntimeUserIdentity().userId;
  const turn: HistoryTurn = {
    id: makeTurnId(),
    userId,
    role,
    text: cleaned.slice(0, 4000), // hard cap per turn
    timestamp: Date.now(),
    source: options.source || 'voice',
    sessionId: options.sessionId,
  };

  // Local first
  const local = readLocalTurns(userId);
  // De-dupe: skip if the immediately previous turn has identical text+role
  const last = local[local.length - 1];
  if (!last || last.role !== turn.role || last.text !== turn.text) {
    local.push(turn);
    writeLocalTurns(userId, local);
  }

  // Mirror to Firestore (best-effort, async)
  if (!options.skipRemote) {
    void pushTurnToFirestore(turn);
  }

  return turn;
}

/**
 * Returns the last N turns for a user, drawn from local cache.
 * Order: oldest → newest.
 */
export function getRecentTurns(
  userId?: string,
  limit: number = SESSION_CONTEXT_TURN_LIMIT,
): HistoryTurn[] {
  const id = userId || getRuntimeUserIdentity().userId;
  const local = readLocalTurns(id);
  return local.slice(-limit);
}

/**
 * Pulls the last N turns from Firestore and merges them into the local cache.
 * Use when the local cache is empty (e.g. user just logged in on a new device).
 */
export async function syncHistoryFromFirestore(
  userId?: string,
  maxTurns: number = LOCAL_TURN_CAP,
): Promise<HistoryTurn[]> {
  const id = userId || getRuntimeUserIdentity().userId;
  if (!isValidUserId(id)) return readLocalTurns(id);

  const remote = await fetchTurnsFromFirestore(id, maxTurns);
  if (remote.length === 0) return readLocalTurns(id);

  const local = readLocalTurns(id);
  // Merge by client_id — local takes precedence when timestamps overlap
  const seen = new Set(local.map(t => t.id));
  const merged: HistoryTurn[] = [...local];
  for (const r of remote) {
    if (!seen.has(r.id)) {
      merged.push(r);
      seen.add(r.id);
    }
  }
  // Sort ascending then trim
  merged.sort((a, b) => a.timestamp - b.timestamp);
  const trimmed = merged.length > LOCAL_TURN_CAP ? merged.slice(-LOCAL_TURN_CAP) : merged;
  writeLocalTurns(id, trimmed);
  return trimmed;
}

/**
 * Format a slice of turns as a transcript Beatrice can read at a glance.
 */
function turnsToTranscript(turns: HistoryTurn[]): string {
  if (turns.length === 0) return '';
  return turns
    .map(t => {
      const who = t.role === 'agent' ? 'Beatrice' : t.role === 'user' ? 'User' : 'System';
      const when = new Date(t.timestamp).toISOString().slice(0, 16).replace('T', ' ');
      return `[${when}] ${who}: ${t.text}`;
    })
    .join('\n');
}

const SUMMARIZER_MODEL = 'gemini-2.5-flash';
const SUMMARIZER_PROMPT = `You compress a transcript of past conversations between a user and Beatrice (the user's voice assistant) into a short, useful long-term memory digest.

Output rules:
- 4 to 8 short bullet lines, no preamble
- Capture: ongoing topics/projects, user preferences and personal facts, open questions or follow-ups, important names/places/dates, the tone the user prefers
- Use third person ("the user prefers...", "earlier they discussed..."). Do NOT address the user directly.
- Skip greetings, filler, and trivial small talk
- Never invent details that aren't supported by the transcript
- If a turn looks ambiguous, leave it out rather than guessing
- Plain text, no Markdown headers, no quotes around bullets`;

async function summarizeWithGemini(
  apiKey: string,
  transcript: string,
): Promise<string> {
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: SUMMARIZER_MODEL,
      contents: `Transcript (oldest → newest):\n${transcript}`,
      config: {
        systemInstruction: SUMMARIZER_PROMPT,
        maxOutputTokens: 360,
        temperature: 0.4,
      },
    });
    const text = (response.text || '').trim();
    return text;
  } catch (e) {
    console.warn('Conversation history summarizer failed:', e);
    return '';
  }
}

function pickApiKey(): string | undefined {
  const env: Record<string, string | undefined> =
    (typeof process !== 'undefined' ? (process as any).env : {}) || {};
  return env.GEMINI_API_KEY || env.API_KEY || undefined;
}

export interface LoadHistoryOptions {
  userId?: string;
  /** Override the API key used for AI summarization */
  apiKey?: string;
  /** Force a fresh summary even if a cached one is still valid */
  forceRefresh?: boolean;
}

/**
 * Build the long-term-memory context block that gets injected into Beatrice
 * at the start of a session. Returns "" if there's no usable history yet.
 *
 * Strategy:
 *   1. Sync recent turns from Firestore into the local cache.
 *   2. If we have a fresh cached digest covering the latest turn, use it.
 *   3. Otherwise compress the last N turns with Gemini (or list verbatim if
 *      we have very few turns / no API key).
 *   4. Cache the digest for SUMMARY_TTL_MS.
 */
export async function loadHistoryContextForSession(
  options: LoadHistoryOptions = {},
): Promise<string> {
  const userId = options.userId || getRuntimeUserIdentity().userId;

  // Best-effort sync from cloud (no-op for local-dev-user)
  if (isValidUserId(userId)) {
    try {
      await syncHistoryFromFirestore(userId, LOCAL_TURN_CAP);
    } catch {
      // Cloud sync is best-effort
    }
  }

  const turns = readLocalTurns(userId);
  if (turns.length === 0) return '';

  const recent = turns.slice(-SESSION_CONTEXT_TURN_LIMIT);
  const latestTs = recent[recent.length - 1].timestamp;
  const cached = readCachedSummary(userId);

  // 2. Use cached digest if still warm and covers the latest turn
  if (
    !options.forceRefresh &&
    cached &&
    cached.coversThrough >= latestTs &&
    Date.now() - cached.generatedAt < SUMMARY_TTL_MS &&
    cached.digest.trim()
  ) {
    return formatHistoryBlock(cached.digest, cached.turnCount);
  }

  // 3a. Few turns → just list them verbatim, no AI call
  if (recent.length < MIN_TURNS_FOR_AI_SUMMARY) {
    const transcript = turnsToTranscript(recent);
    const inlineDigest = `Recent conversation excerpts (last ${recent.length} turn${recent.length === 1 ? '' : 's'}):\n${transcript}`;
    writeCachedSummary({
      userId,
      digest: inlineDigest,
      turnCount: recent.length,
      generatedAt: Date.now(),
      coversThrough: latestTs,
    });
    return formatHistoryBlock(inlineDigest, recent.length);
  }

  // 3b. Many turns → ask Gemini for a compressed digest
  const apiKey = options.apiKey || pickApiKey();
  let digest = '';
  if (apiKey) {
    const transcript = turnsToTranscript(recent);
    digest = await summarizeWithGemini(apiKey, transcript);
  }

  // 4. Fallback if AI summary failed or no key — drop to verbatim transcript
  if (!digest) {
    const fallback = turnsToTranscript(recent.slice(-15));
    digest = `Recent conversation excerpts:\n${fallback}`;
  }

  writeCachedSummary({
    userId,
    digest,
    turnCount: recent.length,
    generatedAt: Date.now(),
    coversThrough: latestTs,
  });

  return formatHistoryBlock(digest, recent.length);
}

function formatHistoryBlock(digest: string, turnCount: number): string {
  return `[USER HISTORY CONTEXT — ${turnCount} prior turn${turnCount === 1 ? '' : 's'} on file]\n${digest}`;
}

/**
 * Wipe a user's local + cached summary. Firestore data is left intact unless
 * `wipeRemote` is true (in which case we'd need to add a deleteAll—omitted
 * deliberately because deletes scale poorly for large histories).
 */
export function clearLocalHistory(userId?: string): void {
  if (!isBrowser) return;
  const id = userId || getRuntimeUserIdentity().userId;
  try {
    localStorage.removeItem(historyKey(id));
    localStorage.removeItem(summaryKey(id));
  } catch {
    // ignore
  }
}

/**
 * Public stats for diagnostic UIs.
 */
export function getHistoryStats(userId?: string): {
  totalTurns: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  hasCachedDigest: boolean;
} {
  const id = userId || getRuntimeUserIdentity().userId;
  const turns = readLocalTurns(id);
  const cached = readCachedSummary(id);
  return {
    totalTurns: turns.length,
    oldestTimestamp: turns[0]?.timestamp ?? null,
    newestTimestamp: turns[turns.length - 1]?.timestamp ?? null,
    hasCachedDigest: Boolean(cached?.digest?.trim()),
  };
}
