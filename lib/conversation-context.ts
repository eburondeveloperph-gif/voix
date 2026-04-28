/**
 * Conversation Context
 *
 * Bundles userId, user profile, conversation history, active task state,
 * detected intent, and memory context into a single object consumed by
 * all tools and agents. Provides session-persistent memory for conversation
 * state beyond document memory.
 */

import { getRuntimeUserIdentity, UserProfile, UserProfileService } from './user-profile';
import { useUserProfileStore } from './user-profile-store';
import { useLogStore, ConversationTurn } from './state';
import { useProcessingStore } from './state';
import { MemoryService } from './document/memory-service';
import { detectTaskType, TaskInfo } from './task-engagement';
import { getEffectiveUserId } from './document/utils';
import { ConversationMemory } from './conversation-memory';
import { loadHistoryContextForSession } from './conversation-history';

// ─── Types ────────────────────────────────────────────

export interface ActiveTaskState {
  taskId: string;
  toolName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  result?: string;
  args?: Record<string, any>;
}

export interface ConversationContext {
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  profile: UserProfile | null;
  profilePrompt: string;

  /** Current conversation turns (most recent, capped at 25) */
  recentTurns: ConversationTurn[];

  /** Active background task (tool being executed) */
  activeTask: ActiveTaskState | null;

  /** All active tasks in the current session */
  activeTasks: ActiveTaskState[];

  /** Detected intent from the latest user message */
  detectedIntent: TaskInfo;

  /** Document memory context relevant to the conversation */
  memoryContext: string;

  /** Preferences and usage hints */
  preferences: {
    preferredAddress: string;
    preferredName: string;
    language: string;
    relationship: string;
  };

  /** Timestamp for freshness */
  timestamp: number;
}

// ─── Session Memory Store ─────────────────────────────
// Persists conversation context across turns within a session
// Uses localStorage with session-based keying

const SESSION_STORAGE_KEY_PREFIX = 'beatrice_session_context_';
const MAX_RECENT_TURNS = 25;

interface SessionMemory {
  context: Partial<ConversationContext>;
  lastUpdated: number;
}

function getSessionKey(): string {
  const userId = getEffectiveUserId();
  return `${SESSION_STORAGE_KEY_PREFIX}${userId}`;
}

function readSessionMemory(): SessionMemory {
  try {
    const raw = localStorage.getItem(getSessionKey());
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    // ignore parse errors
  }
  return { context: {}, lastUpdated: Date.now() };
}

function writeSessionMemory(context: Partial<ConversationContext>) {
  try {
    const memory: SessionMemory = {
      context,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(getSessionKey(), JSON.stringify(memory));
  } catch (e) {
    // ignore storage errors (quota, etc.)
  }
}

export function clearSessionMemory() {
  try {
    localStorage.removeItem(getSessionKey());
  } catch (e) {
    // ignore
  }
}

// ─── Context Packer ───────────────────────────────────

/**
 * Builds a full ConversationContext from current application state.
 * Call this before every tool call or agent dispatch to ensure
 * the context is fresh.
 */
export async function buildConversationContext(
  latestUserMessage?: string,
  toolName?: string,
  toolArgs?: Record<string, any>,
): Promise<ConversationContext> {
  const identity = getRuntimeUserIdentity();
  const profile = useUserProfileStore.getState().profile ?? (await UserProfileService.loadProfile());
  const profilePrompt = profile ? UserProfileService.buildProfilePrompt(profile) : '';

  // Gather recent turns from the log store
  const logTurns = useLogStore.getState().turns;
  const recentTurns = logTurns.slice(-MAX_RECENT_TURNS);

  // Detect intent from the latest message
  const detectedIntent = latestUserMessage
    ? detectTaskType(latestUserMessage)
    : { type: 'general' as const, label: 'General conversation', icon: '⚡' };

  // Search memory for relevant context
  let memoryContext = '';
  if (latestUserMessage && latestUserMessage.trim().length > 5) {
    try {
      const memoryResults = await MemoryService.searchMemory(latestUserMessage, { limit: 3 });
      if (memoryResults.length > 0) {
        memoryContext = memoryResults
          .map(r => `[${r.document.title}]: ${r.document.analysis.short_summary}`)
          .join('\n');
      }
    } catch (e) {
      // memory search is best-effort
    }

    // Also search conversation memories for relevant personal context
    try {
      const convMemResults = ConversationMemory.search(latestUserMessage, { limit: 3 });
      if (convMemResults.length > 0) {
        const convMemContext = convMemResults
          .map(r => `[Conversation Memory - ${r.memory.category}]: ${r.memory.fact}`)
          .join('\n');
        memoryContext = memoryContext
          ? `${memoryContext}\n\n${convMemContext}`
          : convMemContext;
      }
    } catch (e) {
      // conversation memory search is best-effort
    }
  }

  // ── Long-term conversation history context ──────────────
  // Load the user's past conversation digest to use as long-term memory.
  // This gives Beatrice awareness of past sessions.
  try {
    const historyContext = await loadHistoryContextForSession({ userId: identity.userId });
    if (historyContext) {
      memoryContext = memoryContext
        ? `${memoryContext}\n\n${historyContext}`
        : historyContext;
    }
  } catch (e) {
    // history loading is best-effort
    console.warn('Failed to load conversation history context:', e);
  }

  // Build active task state
  let activeTask: ActiveTaskState | null = null;
  if (toolName) {
    activeTask = {
      taskId: `task_${Date.now()}`,
      toolName,
      status: 'pending',
      startedAt: Date.now(),
      args: toolArgs,
    };
  } else {
    // Check if there's an active processing task
    const processing = useProcessingStore.getState();
    if (processing.isProcessingTask && processing.currentTaskInfo) {
      activeTask = {
        taskId: `task_${Date.now()}`,
        toolName: processing.currentTaskInfo.type,
        status: 'processing',
        startedAt: Date.now(),
      };
    }
  }

  // Read session-persisted context to carry forward
  const sessionMemory = readSessionMemory();
  const previousActiveTasks = sessionMemory.context.activeTasks || [];

  // Merge previous active tasks (keep last 5)
  const activeTasks: ActiveTaskState[] = activeTask
    ? [activeTask, ...previousActiveTasks.filter(t => t.taskId !== activeTask.taskId)].slice(0, 5)
    : previousActiveTasks;

  const context: ConversationContext = {
    userId: identity.userId,
    userEmail: identity.email,
    userDisplayName: identity.displayName,
    profile,
    profilePrompt,
    recentTurns,
    activeTask,
    activeTasks,
    detectedIntent,
    memoryContext,
    preferences: {
      preferredAddress: profile?.preferred_address || 'User',
      preferredName: profile?.preferred_name || identity.displayName || 'User',
      language: 'auto',
      relationship: profile?.relationship_to_jo || 'associate',
    },
    timestamp: Date.now(),
  };

  // Persist to session for next turn
  writeSessionMemory(context);

  return context;
}

/**
 * Builds a compact text representation of the context for insertion
 * into prompts or system instructions.
 */
export function contextToPromptFragment(ctx: ConversationContext): string {
  const parts: string[] = [];

  // User identity
  parts.push(`User: ${ctx.preferences.preferredAddress}`);
  if (ctx.userEmail) {
    parts.push(`Email: ${ctx.userEmail}`);
  }

  // Current task
  if (ctx.activeTask) {
    parts.push(`Active task: ${ctx.activeTask.toolName.replace(/_/g, ' ')} (${ctx.activeTask.status})`);
  }

  // Recent context
  if (ctx.activeTasks.length > 1) {
    const recent = ctx.activeTasks.slice(0, 3).map(t =>
      `${t.toolName.replace(/_/g, ' ')}: ${t.status}${t.result ? ` — ${t.result.slice(0, 80)}` : ''}`
    ).join(' | ');
    parts.push(`Recent tasks: ${recent}`);
  }

  // Memory context
  if (ctx.memoryContext) {
    parts.push(`Relevant memory: ${ctx.memoryContext.slice(0, 200)}`);
  }

  // Recent conversation summary
  const userTurns = ctx.recentTurns.filter(t => t.role === 'user').slice(-3);
  if (userTurns.length > 0) {
    parts.push(`Last user said: "${userTurns.map(t => t.text.slice(0, 100)).join('" | "')}"`);
  }

  return parts.join('\n');
}

/**
 * Creates a system prompt addition that tells Beatrice about
 * the current context and what she should remember.
 */
export function contextToSystemInstruction(ctx: ConversationContext): string {
  const instructions: string[] = [];

  if (ctx.activeTask) {
    instructions.push(
      `You are currently executing: "${ctx.activeTask.toolName.replace(/_/g, ' ')}". ` +
      `Status: ${ctx.activeTask.status}. ` +
      `Do NOT abandon this task — continue working on it until complete.`
    );
  }

  // Remind Beatrice of recent tasks that might be referenced
  const recentCompleted = ctx.activeTasks
    .filter(t => t.status === 'completed' && t.taskId !== ctx.activeTask?.taskId)
    .slice(0, 2);
  if (recentCompleted.length > 0) {
    instructions.push(
      `Recent completed tasks:\n${recentCompleted.map(t =>
        `- ${t.toolName.replace(/_/g, ' ')}${t.result ? `: ${t.result.slice(0, 100)}` : ''}`
      ).join('\n')}`
    );
  }

  if (ctx.memoryContext) {
    instructions.push(
      `Relevant documents from your knowledge base:\n${ctx.memoryContext.slice(0, 300)}`
    );
  }

  // ── Current-conversation working memory ────────────────
  // Always remind Beatrice of the last few turns so her context survives
  // tool round-trips, model resets, and long pauses.
  const recap = buildRunningConversationRecap(ctx.recentTurns);
  if (recap) {
    instructions.push(`[CURRENT CONVERSATION SO FAR]\n${recap}`);
  }

  return instructions.join('\n\n');
}

/**
 * Build a tight "what we've been talking about" recap from the live turn log.
 * Caps at 8 turns and 600 characters total so it stays cheap to inject on
 * every tool call.
 */
export function buildRunningConversationRecap(
  turns: ConversationTurn[],
  options: { maxTurns?: number; maxChars?: number } = {},
): string {
  const maxTurns = options.maxTurns ?? 8;
  const maxChars = options.maxChars ?? 600;
  if (!turns || turns.length === 0) return '';

  // Pull the last N user/agent turns (skip noisy system tool-trigger logs).
  const speech = turns
    .filter(t => (t.role === 'user' || t.role === 'agent') && t.text?.trim())
    .slice(-maxTurns);
  if (speech.length === 0) return '';

  const formatted = speech.map(t => {
    const who = t.role === 'agent' ? 'Beatrice' : 'User';
    const line = t.text.replace(/\s+/g, ' ').trim();
    return `${who}: ${line}`;
  });

  let out = formatted.join('\n');
  if (out.length > maxChars) {
    out = `…${out.slice(out.length - maxChars)}`;
  }
  return out;
}
