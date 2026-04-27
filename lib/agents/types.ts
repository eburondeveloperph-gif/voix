/**
 * Agent Handler Interface
 *
 * Every specialized agent implements this interface so Beatrice
 * (the orchestrator) can dispatch tool calls to the right worker.
 */
import type { ConversationContext } from '@/lib/conversation-context';

export type AgentResult = {
  status: 'success' | 'error' | 'processing';
  message: string;
  data?: any;
};

/**
 * Standard handler signature for all agents.
 * @param toolName  The name of the tool/function being called
 * @param args      Arguments passed by the model
 * @param ctx       Full conversation context (identity, memory, active tasks, etc.)
 */
export type AgentHandler = (
  toolName: string,
  args: Record<string, any>,
  ctx: ConversationContext,
) => Promise<AgentResult>;
