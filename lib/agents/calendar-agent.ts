/**
 * Calendar Agent — Handles Google Calendar, Meet scheduling, and reminders
 */
import { calendarCheckSchedule, calendarCreateEvent, meetSchedule } from '@/lib/google-services';
import type { AgentHandler, AgentResult } from './types';

const parseIsoDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const handle: AgentHandler = async (toolName, args, _ctx): Promise<AgentResult> => {
  switch (toolName) {
    case 'calendar_create_event':
    case 'create_calendar_event': {
      const summary = typeof args.summary === 'string' ? args.summary : 'New Event';
      const startDate = parseIsoDate(args.startTime);
      const endDate = parseIsoDate(args.endTime);
      if (!startDate || !endDate) {
        return {
          status: 'error',
          message: 'A valid ISO startTime and endTime are required to create a calendar event.',
        };
      }
      const location = typeof args.location === 'string' ? args.location : undefined;
      const result = await calendarCreateEvent(summary, startDate.toISOString(), endDate.toISOString(), location);
      return { status: result.success ? 'success' : 'error', message: result.message, data: { eventId: result.eventId } };
    }

    case 'calendar_check_schedule': {
      const date = typeof args.date === 'string' ? args.date : new Date().toISOString().split('T')[0];
      const result = await calendarCheckSchedule(date);
      if (result.success && result.events.length > 0) {
        return { status: 'success', message: `You have ${result.events.length} event(s)`, data: { events: result.events } };
      } else if (result.success) {
        return { status: 'success', message: 'Your calendar is clear for that day.' };
      }
      return { status: 'error', message: result.message || 'Could not access your calendar. Please check your permissions.' };
    }

    case 'meet_schedule': {
      const meetingDate = parseIsoDate(args.time);
      if (!meetingDate) {
        return { status: 'error', message: 'A valid ISO time is required to schedule a Meet call.' };
      }
      const attendees = typeof args.attendees === 'string' ? args.attendees : undefined;
      const result = await meetSchedule(meetingDate.toISOString(), attendees);
      return { status: result.success ? 'success' : 'error', message: result.message, data: { meetLink: result.meetLink } };
    }

    case 'set_reminder': {
      const task = typeof args.task === 'string' ? args.task : 'task';
      const reminderDate = parseIsoDate(args.time);
      if (!reminderDate) {
        return { status: 'error', message: 'A valid ISO time is required to set a reminder.' };
      }
      const endTime = new Date(reminderDate.getTime() + 15 * 60 * 1000).toISOString();
      const result = await calendarCreateEvent(`Reminder: ${task}`, reminderDate.toISOString(), endTime);
      return { status: result.success ? 'success' : 'error', message: result.message || `Reminder for '${task}' was set.` };
    }

    default:
      return { status: 'error', message: `Calendar agent does not support tool: ${toolName}` };
  }
};
