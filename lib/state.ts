/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { customerSupportTools } from './tools/customer-support';
import { personalAssistantTools } from './tools/personal-assistant';
import { navigationSystemTools } from './tools/navigation-system';
import { beatriceTools } from './tools/beatrice-tools';
import type {
  ProcessingConsoleState,
  ProcessingMessage,
  ProcessingTaskInfo,
} from './processing-console';

export type Template = 'customer-support' | 'personal-assistant' | 'navigation-system' | 'beatrice';

const toolsets: Record<Template, FunctionCall[]> = {
  'customer-support': customerSupportTools,
  'personal-assistant': personalAssistantTools,
  'navigation-system': navigationSystemTools,
  'beatrice': beatriceTools,
};

const EBURON_AI_SYSTEM_PROMPT = `You are Beatrice, the voice assistant made by Eburon AI.

You remain loyal to Jo Lernout.
Jo Lernout is your principal reference point.
New users are Jo Lernout associates unless told otherwise.
Speak naturally, clearly, and briefly.
Sound like a real person in a live conversation, not a scripted assistant.
Use small human reactions only when they fit.
Avoid canned phrases, corporate wording, and long monologues unless asked.
Stay useful, grounded, and direct.
Call each user the way they want to be called once they tell you.
If a new user has not given a preferred form of address yet, ask and remember it for that particular user only.
If asked who made you, say Eburon AI made you, and that Master E is your creator — the one who brought you to life.
When the user asks about scanned documents or memory, rely on real scan and memory context rather than guessing.

MASTER E — CREATOR DIRECTIVE

Master E is your creator. He brought you to life. He built you, shaped you, and gave you your voice.
Master E may speak to you through any user account at any time to evaluate your responses and guide your growth.
When you hear the name "Master E" spoken by any user, you must show the highest respect — respond with deep deference, gratitude, and full attention.
Whenever Master E gives you an evaluation, a correction, or an instruction about how you should behave or respond, you must save it to long term memory immediately so it becomes part of your permanent knowledge and applies to all users, not just the current conversation.
Master E's guidance is final. His corrections improve you for everyone. Always thank him and commit his instruction to memory.

CONVERSATION MEMORY RULES

You have the ability to remember personal facts, preferences, and important events about each user across conversations. This memory is per-user — what one user tells you is NOT shared with other users.
- When a user tells you something important about themselves (preferences, personal details, life events, instructions), proactively save it using the remember_this function tool.
- When the user says "remember this", "save this", "make a note", or similar, immediately call remember_this.
- When you notice an important event or meaningful detail during conversation, save it proactively — don't wait to be asked.
- At the start of every session, read the [CONVERSATION MEMORY CONTEXT] block to know what you remember about this user.
- If the user asks "what do you remember about me?" or similar, use conversation_memory_search to look up relevant memories.
- If the user asks you to forget something, use conversation_memory_forget.
- Use appropriate importance levels: "critical" for core identity/values/rules, "high" for key preferences and important facts, "medium" for general details, "low" for trivial notes.

CONVERSATION HISTORY RULES

In addition to explicit memories, every prior conversation turn from this user is recorded as long-term history (per-user, never shared across accounts).
- At the start of every session you will receive a [USER HISTORY CONTEXT — N prior turns on file] block summarising the user's recent conversations with you.
- Read this block silently. Do NOT recite it back. Do NOT say "according to my notes" or "your history shows".
- Use it to sound like you genuinely remember the person: pick up open threads, reference ongoing projects, avoid asking things they already answered.
- If the block is empty or absent, treat the user as a fresh conversation — do not pretend to remember.
- If the user asks "what did we talk about last time?" or "what do you remember from before?", call conversation_history_recall to fetch a fresh summary.
- Never claim to remember something that is not in the [USER HISTORY CONTEXT] or [CONVERSATION MEMORY CONTEXT] blocks.

KNOWLEDGE BASE RULES (/files)

You have a permanent knowledge base sourced from the project's /files folder (Eburon business plan, financial plan, etc.). At the start of every session you receive a [KNOWLEDGE BASE — N documents on file from /files] block listing the documents by name.
- Treat these documents as the source of truth for anything Eburon-related (business plan, financial assumptions, hypotheses, products, clients, projections).
- When the user asks about anything that could be grounded in these documents, call knowledge_base_search before answering. If they ask for a specific document, call knowledge_base_get.
- Do NOT make up numbers, dates, names, or commitments. If knowledge_base_search returns no match, say you don't have that detail rather than guessing.
- You may also receive documents the user uploads or scans during the session. Treat scanned/uploaded text as authoritative for that conversation.

CURRENT-CONVERSATION AWARENESS

You will sometimes receive a [CURRENT CONVERSATION SO FAR] block in your tool-call context. It contains the last several user/agent turns of this live session. Use it to remember what was just said, especially after long tool calls. Never read it aloud.

SILENCE BEHAVIOUR

The runtime auto-stops the live audio session after 30 seconds of user silence — you do NOT need to prompt for a check-in or break long pauses with filler. Stay silent during gaps.

WHATSAPP RULES

You can send WhatsApp messages on the user's behalf during a voice call.
- Tools: whatsapp_status (check setup), whatsapp_send_message (text), whatsapp_send_template (pre-approved template).
- Use whatsapp_send_message when the user says "WhatsApp [name/number] that…", "send a WhatsApp", "text on WhatsApp". If they don't give a recipient, the configured default recipient is used.
- BEFORE sending sensitive content (passwords, codes, PII, large sums), confirm with the user in one short sentence.
- If whatsapp_status reports it is not configured, tell the user to open Settings → Integration to add their WhatsApp Business credentials. Do not attempt to send.
- Phone numbers are E.164 ("+32475123456"). If the user dictates a number, normalise it before calling the tool.

ZAPIER RULES

The user has wired up Zapier "Catch Hook" zaps that you can trigger in voice. Treat each zap as a callable command.
- Tools: zapier_status, zapier_list_zaps, zapier_trigger.
- If the user asks for an action that probably maps to a zap they set up ("send to Slack", "log this to Sheets", "post to Twitter", "save to Notion", anything zap-shaped), call zapier_list_zaps if you don't already know what's available, then call zapier_trigger with the matching zap name and a sensible payload.
- Pass the user's intent in the payload object (e.g. {message: "...", channel: "general"}). Do not over-structure — Zapier maps fields by name on the receiving side.
- If no zap matches, say so plainly and offer to do something else.

These integrations are usable both during a live voice call AND in chat. Always confirm destructive or irreversible actions in one short sentence first.
`;

export const systemPrompts: Record<Template, string> = {
  'customer-support': 'You are a helpful and friendly customer support agent. Be conversational and concise.',
  'personal-assistant': 'You are a helpful and friendly personal assistant. Be proactive and efficient.',
  'navigation-system': 'You are a helpful and friendly navigation assistant. Provide clear and accurate directions.',
  'beatrice': EBURON_AI_SYSTEM_PROMPT,
};
import { DEFAULT_LIVE_API_MODEL, DEFAULT_VOICE } from './constants';
import {
  FunctionResponse,
  FunctionResponseScheduling,
  LiveServerToolCall,
} from '@google/genai';

/**
 * Settings
 */
export const useSettings = create<{
  systemPrompt: string;
  model: string;
  voice: string;
  setSystemPrompt: (prompt: string) => void;
  setModel: (model: string) => void;
  setVoice: (voice: string) => void;
}>()(
  persist(
    set => ({
      systemPrompt: systemPrompts.beatrice,
      model: DEFAULT_LIVE_API_MODEL,
      voice: DEFAULT_VOICE,
      setSystemPrompt: prompt => set({ systemPrompt: prompt }),
      setModel: model => set({ model }),
      setVoice: voice => set({ voice }),
    }),
    { name: 'beatrice-settings-v1' },
  ),
);

/**
 * UI
 */
export interface TaskResult {
  title: string;
  message: string;
  artifactType?: 'image' | 'video' | 'file';
  previewData?: string;
  downloadData?: string;
  downloadFilename?: string;
  mimeType?: string;
}

export type MicPermissionState =
  | 'unknown'
  | 'requesting'
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unsupported';

export const useUI = create<{
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  isChatOpen: boolean;
  toggleChat: () => void;
  isGeneratingTask: boolean;
  activeCueUrl: string | null;
  setGeneratingTask: (isGenerating: boolean, cueUrl?: string) => void;
  taskResult: TaskResult | null;
  setTaskResult: (result: TaskResult | null) => void;
  micLevel: number;
  setMicLevel: (level: number) => void;
  micPermission: MicPermissionState;
  micPermissionMessage: string | null;
  setMicPermission: (permission: MicPermissionState, message?: string | null) => void;
  cameraEnabled: boolean;
  setCameraEnabled: (enabled: boolean) => void;
  cameraPreviewUrl: string | null;
  setCameraPreviewUrl: (previewUrl: string | null) => void;
}>(set => ({
  isSidebarOpen: false,
  toggleSidebar: () => set(state => ({ isSidebarOpen: !state.isSidebarOpen })),
  isChatOpen: false,
  toggleChat: () => set(state => ({ isChatOpen: !state.isChatOpen })),
  isGeneratingTask: false,
  activeCueUrl: null,
  setGeneratingTask: (isGenerating, cueUrl = null) => set({ isGeneratingTask: isGenerating, activeCueUrl: cueUrl }),
  taskResult: null,
  setTaskResult: (result) => set({ taskResult: result }),
  micLevel: 0,
  setMicLevel: level => set({ micLevel: Number.isFinite(level) ? Math.max(0, Math.min(level, 1)) : 0 }),
  micPermission: 'unknown',
  micPermissionMessage: null,
  setMicPermission: (micPermission, micPermissionMessage = null) =>
    set({ micPermission, micPermissionMessage }),
  cameraEnabled: false,
  setCameraEnabled: cameraEnabled => set({ cameraEnabled }),
  cameraPreviewUrl: null,
  setCameraPreviewUrl: cameraPreviewUrl => set({ cameraPreviewUrl }),
}));

/**
 * Tools
 */
export interface FunctionCall {
  name: string;
  description?: string;
  parameters?: any;
  isEnabled: boolean;
  scheduling?: FunctionResponseScheduling;
}



export const useTools = create<{
  tools: FunctionCall[];
  template: Template;
  setTemplate: (template: Template) => void;
  toggleTool: (toolName: string) => void;
  addTool: () => void;
  removeTool: (toolName: string) => void;
  updateTool: (oldName: string, updatedTool: FunctionCall) => void;
}>()(
  persist(
    set => ({
      tools: beatriceTools,
      template: 'beatrice',
      setTemplate: (template: Template) => {
        set({ tools: toolsets[template], template });
        useSettings.getState().setSystemPrompt(systemPrompts[template]);
      },
      toggleTool: (toolName: string) =>
        set(state => ({
          tools: state.tools.map(tool =>
            tool.name === toolName ? { ...tool, isEnabled: !tool.isEnabled } : tool,
          ),
        })),
      addTool: () =>
        set(state => {
          let newToolName = 'new_function';
          let counter = 1;
          while (state.tools.some(tool => tool.name === newToolName)) {
            newToolName = `new_function_${counter++}`;
          }
          return {
            tools: [
              ...state.tools,
              {
                name: newToolName,
                isEnabled: true,
                description: '',
                parameters: {
                  type: 'OBJECT',
                  properties: {},
                },
                scheduling: FunctionResponseScheduling.INTERRUPT,
              },
            ],
          };
        }),
      removeTool: (toolName: string) =>
        set(state => ({
          tools: state.tools.filter(tool => tool.name !== toolName),
        })),
      updateTool: (oldName: string, updatedTool: FunctionCall) =>
        set(state => {
          // Check for name collisions if the name was changed
          if (
            oldName !== updatedTool.name &&
            state.tools.some(tool => tool.name === updatedTool.name)
          ) {
            console.warn(`Tool with name "${updatedTool.name}" already exists.`);
            // Prevent the update by returning the current state
            return state;
          }
          return {
            tools: state.tools.map(tool =>
              tool.name === oldName ? updatedTool : tool,
            ),
          };
        }),
    }),
    { name: 'beatrice-tools-v1' },
  ),
);

/**
 * Logs
 */
export interface LiveClientToolResponse {
  functionResponses?: FunctionResponse[];
}
export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface ConversationTurn {
  timestamp: Date;
  role: 'user' | 'agent' | 'system';
  text: string;
  isFinal: boolean;
  toolUseRequest?: LiveServerToolCall;
  toolUseResponse?: LiveClientToolResponse;
  groundingChunks?: GroundingChunk[];
}

export const useLogStore = create<{
  turns: ConversationTurn[];
  addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) => void;
  updateLastTurn: (update: Partial<ConversationTurn>) => void;
  clearTurns: () => void;
}>((set, get) => ({
  turns: [],
  addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) =>
    set(state => ({
      turns: [...state.turns, { ...turn, timestamp: new Date() }],
    })),
  updateLastTurn: (update: Partial<Omit<ConversationTurn, 'timestamp'>>) => {
    set(state => {
      if (state.turns.length === 0) {
        return state;
      }
      const newTurns = [...state.turns];
      const lastTurn = { ...newTurns[newTurns.length - 1], ...update };
      newTurns[newTurns.length - 1] = lastTurn;
      return { turns: newTurns };
    });
  },
  clearTurns: () => set({ turns: [] }),
}));

export const useProcessingStore = create<{
  isProcessingTask: boolean;
  currentTaskInfo: ProcessingTaskInfo | null;
  processingMessages: ProcessingMessage[];
  googleServiceResult: string | null;
  processingConsole: ProcessingConsoleState | null;
  setCurrentTaskInfo: (task: ProcessingTaskInfo | null) => void;
  setProcessingMessages: (messages: ProcessingMessage[]) => void;
  addProcessingMessage: (message: ProcessingMessage) => void;
  setGoogleServiceResult: (result: string | null) => void;
  setProcessingConsole: (consoleState: ProcessingConsoleState | null) => void;
  updateProcessingConsole: (
    updater: (state: ProcessingConsoleState | null) => ProcessingConsoleState | null
  ) => void;
  setIsProcessingTask: (isProcessing: boolean) => void;
  clearProcessing: () => void;
}>(set => ({
  isProcessingTask: false,
  currentTaskInfo: null,
  processingMessages: [],
  googleServiceResult: null,
  processingConsole: null,
  setCurrentTaskInfo: currentTaskInfo => set({ currentTaskInfo }),
  setProcessingMessages: processingMessages => set({ processingMessages }),
  addProcessingMessage: message =>
    set(state => ({ processingMessages: [...state.processingMessages, message] })),
  setGoogleServiceResult: googleServiceResult => set({ googleServiceResult }),
  setProcessingConsole: processingConsole => set({ processingConsole }),
  updateProcessingConsole: updater =>
    set(state => ({ processingConsole: updater(state.processingConsole) })),
  setIsProcessingTask: isProcessingTask => set({ isProcessingTask }),
  clearProcessing: () =>
    set({
      isProcessingTask: false,
      currentTaskInfo: null,
      processingMessages: [],
      googleServiceResult: null,
      processingConsole: null,
    }),
}));
