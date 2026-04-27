/**
 * Customer Support Agent — Handles return flows, order status, and human escalation.
 *
 * No external CRM is wired up yet, so each handler returns a structured
 * acknowledgement that Beatrice's secondary formatter will turn into natural speech.
 * When a real backend (Zendesk, Shopify, internal API) is connected, swap the
 * mock responses for live calls — the agent contract stays the same.
 */
import type { AgentHandler, AgentResult } from './types';

export const handle: AgentHandler = async (toolName, args, _ctx): Promise<AgentResult> => {
  switch (toolName) {
    case 'start_return': {
      const orderId = typeof args.orderId === 'string' ? args.orderId.trim() : '';
      const itemName = typeof args.itemName === 'string' ? args.itemName.trim() : '';
      const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
      if (!orderId || !itemName || !reason) {
        return {
          status: 'error',
          message: 'I need the order ID, item name, and reason to start a return.',
        };
      }
      const ticketId = `RMA-${Date.now().toString(36).toUpperCase()}`;
      return {
        status: 'success',
        message: `Return started for "${itemName}" on order ${orderId}. Reference: ${ticketId}.`,
        data: { ticketId, orderId, itemName, reason },
      };
    }

    case 'get_order_status': {
      const orderId = typeof args.orderId === 'string' ? args.orderId.trim() : '';
      const customerName = typeof args.customerName === 'string' ? args.customerName.trim() : '';
      const customerEmail = typeof args.customerEmail === 'string' ? args.customerEmail.trim() : '';
      if (!orderId && !customerName && !customerEmail) {
        return {
          status: 'error',
          message: 'Please share the order ID, customer name, or email so I can look up the order.',
        };
      }
      return {
        status: 'success',
        message: orderId
          ? `Order ${orderId} is currently in transit and expected to arrive in 2-3 business days.`
          : `I located the most recent order for ${customerName || customerEmail}. It is in transit and expected to arrive in 2-3 business days.`,
        data: {
          orderId: orderId || null,
          customerName: customerName || null,
          customerEmail: customerEmail || null,
          status: 'in_transit',
          estimatedArrivalDays: 3,
        },
      };
    }

    case 'speak_to_representative': {
      const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
      if (!reason) {
        return {
          status: 'error',
          message: 'Please tell me briefly what the representative should help with.',
        };
      }
      return {
        status: 'success',
        message: `I escalated this to a human representative with the note: "${reason}". Someone will reach out shortly.`,
        data: { reason, escalated: true },
      };
    }

    default:
      return { status: 'error', message: `Customer support agent does not support tool: ${toolName}` };
  }
};
