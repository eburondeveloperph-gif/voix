/**
 * Background Tool Executor
 *
 * Executes function-calling tools in the background using a separate
 * Gemini REST model, so the primary Live session can keep speaking
 * to the user uninterrupted.
 *
 * Flow:
 * 1. Live model calls a tool → onToolCall fires
 * 2. We immediately send an "ack" response so the Live model continues talking
 * 3. This executor runs the actual API call + formats the result via a 2nd Gemini model
 * 4. The formatted result is injected back into the Live session as a text message
 *
 * Since the orchestrator refactor, this module now dispatches to
 * specialized agents via the agent registry instead of a monolithic switch.
 */

import { GoogleGenAI } from '@google/genai';
import { buildConversationContext, type ConversationContext } from './conversation-context';
import { dispatchToAgent } from './agents';

const TOOL_EXECUTOR_MODEL = 'gemini-2.5-flash';

const RESULT_FORMATTER_PROMPT = `You are Beatrice's background result formatter. Given a tool name and its raw API result, produce a SHORT, NATURAL, HUMAN-SOUNDING spoken update that Beatrice can say aloud.

Rules:
- Keep it to 1-2 spoken sentences unless the result truly needs more
- Sound like a real person reporting back, not a status logger
- Use contractions and ordinary speech
- Avoid "task completed", "successfully executed", "the tool returned", and similar system language
- If the result is empty, say something like "I don't see anything there" or "Your schedule looks clear"
- Never invent data not present in the result
- Preserve important names, dates, counts, URLs, and next actions
- Be warm, calm, and specific`;

let genaiInstance: GoogleGenAI | null = null;

function getGenAI(apiKey: string): GoogleGenAI {
  if (!genaiInstance) {
    genaiInstance = new GoogleGenAI({ apiKey });
  }
  return genaiInstance;
}

/**
 * Execute a single tool call by dispatching to the correct specialized agent.
 *
 * This replaces the old monolithic switch statement. The buildConversationContext()
 * call provides fresh identity, memory, and active-task context to every agent.
 */
export async function executeToolCall(
  fcName: string,
  args: Record<string, any>,
): Promise<{ status: string; message: string; data?: any }> {
  try {
    // Build a fresh context so every agent knows who the user is,
    // what's in memory, and what active tasks exist
    const ctx: ConversationContext = await buildConversationContext(
      undefined,
      fcName,
      args,
    );

    // Dispatch to the right specialized agent
    const result = await dispatchToAgent(fcName, args, ctx);

    return {
      status: result.status,
      message: result.message,
      data: result.data,
    };
  } catch (err) {
    console.error(`Agent dispatch failed for "${fcName}":`, err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : `Unexpected error executing "${fcName}".`,
    };
  }
}

/**
 * Format raw tool results into natural speech using a secondary Gemini model.
 */
export async function formatToolResultSpeech(
  apiKey: string,
  toolName: string,
  rawResult: { status: string; message: string; data?: any },
): Promise<string> {
  try {
    const ai = getGenAI(apiKey);
    const response = await ai.models.generateContent({
      model: TOOL_EXECUTOR_MODEL,
      contents: `Tool: ${toolName}\nResult: ${JSON.stringify(rawResult, null, 2)}`,
      config: {
        systemInstruction: RESULT_FORMATTER_PROMPT,
        maxOutputTokens: 150,
        temperature: 0.7,
      },
    });
    const text = response.text?.trim();
    return text || rawResult.message;
  } catch (e) {
    console.warn('Background formatter failed, using raw message:', e);
    return rawResult.message;
  }
}
