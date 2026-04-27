/**
 * Email Agent — Handles Gmail read/send operations
 */
import { gmailRead, gmailSend } from '@/lib/google-services';
import type { AgentHandler, AgentResult } from './types';

export const handle: AgentHandler = async (toolName, args, _ctx): Promise<AgentResult> => {
  switch (toolName) {
    case 'gmail_send':
    case 'send_email': {
      const recipient = typeof args.recipient === 'string' ? args.recipient : '';
      const subject = typeof args.subject === 'string' ? args.subject : 'No Subject';
      const body = typeof args.body === 'string' ? args.body : '';
      if (!recipient) return { status: 'error', message: 'Recipient email address is required.' };
      const result = await gmailSend(recipient, subject, body);
      return { status: result.success ? 'success' : 'error', message: result.message, data: { id: result.id } };
    }

    case 'gmail_read': {
      const query = typeof args.query === 'string' ? args.query : undefined;
      const result = await gmailRead(query, 500);
      if (result.success && result.messages.length > 0) {
        return { status: 'success', message: `Found ${result.messages.length} email(s)`, data: { emails: result.messages } };
      } else if (result.success) {
        return { status: 'success', message: 'No emails found matching your query.' };
      }
      return { status: 'error', message: result.message || 'Could not access Gmail. Please check your permissions.' };
    }

    default:
      return { status: 'error', message: `Email agent does not support tool: ${toolName}` };
  }
};
