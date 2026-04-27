/**
 * Google Service Integration Layer
 *
 * Provides access to Google APIs using Firebase auth tokens.
 * Uses the OAuth scopes configured during sign-in:
 * Gmail, Drive, Sheets, Docs, Slides, Chat, Calendar, Forms, YouTube
 */
import { clearStoredGoogleAccessToken, getStoredGoogleAccessToken } from './firebase';

// ─── Token Helper ────────────────────────────────────

const GOOGLE_AUTH_REQUIRED_MESSAGE =
  'Google Workspace is not connected. Sign in with Google again so Beatrice can receive a fresh Workspace OAuth token.';

class GoogleServiceError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GoogleServiceError';
    this.status = status;
  }
}

async function getAccessToken(): Promise<string> {
  const token = getStoredGoogleAccessToken();
  if (!token) {
    throw new GoogleServiceError(GOOGLE_AUTH_REQUIRED_MESSAGE);
  }
  return token;
}

async function readGoogleError(response: Response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || fallback;
  } catch {
    try {
      return (await response.text()) || fallback;
    } catch {
      return fallback;
    }
  }
}

async function googleFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearStoredGoogleAccessToken();
    }
    throw new GoogleServiceError(await readGoogleError(response), response.status);
  }

  return response;
}

const toFailureMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Google service request failed.';

const escapeDriveQuery = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// ─── Gmail ───────────────────────────────────────────

export async function gmailSend(recipient: string, subject: string, body: string): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const emailContent = [
      `To: ${recipient}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\r\n');

    const encodedEmail = btoa(emailContent).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const response = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedEmail }),
    });

    const data = await response.json();
    return {
      success: true,
      message: `Email sent to ${recipient} with subject "${subject}"`,
      id: data.id,
    };
  } catch (e: any) {
    console.warn('Gmail send error:', e);
    return { success: false, message: `Gmail send failed: ${toFailureMessage(e)}` };
  }
}

export async function gmailRead(query?: string, limit: number = 500): Promise<{ success: boolean; message?: string; messages: Array<{ id: string; subject: string; from: string; snippet: string; date: string }> }> {
  try {
    let q = 'in:inbox';
    if (query) q += ` ${query}`;

    const listResp = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${limit}`);

    const listData = await listResp.json();
    const messages = listData.messages || [];

    const result = await Promise.all(
      messages.map(async (m: any) => {
        const detailResp = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}`);
        const detail = await detailResp.json();
        const headers = detail.payload?.headers || [];
        return {
          id: detail.id,
          subject: headers.find((h: any) => h.name === 'Subject')?.value || '(No subject)',
          from: headers.find((h: any) => h.name === 'From')?.value || 'Unknown',
          snippet: detail.snippet || '',
          date: headers.find((h: any) => h.name === 'Date')?.value || '',
        };
      })
    );

    return { success: true, messages: result };
  } catch (e: any) {
    console.warn('Gmail read error:', e);
    return { success: false, message: `Gmail read failed: ${toFailureMessage(e)}`, messages: [] };
  }
}

// ─── Calendar ────────────────────────────────────────

export async function calendarCheckSchedule(date: string): Promise<{ success: boolean; message?: string; events: Array<{ summary: string; start: string; end: string }> }> {
  try {
    const timeMin = new Date(date);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(date);
    timeMax.setHours(23, 59, 59, 999);

    const resp = await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}&singleEvents=true&orderBy=startTime`);

    const data = await resp.json();
    const events = (data.items || []).map((item: any) => ({
      summary: item.summary || 'Untitled event',
      start: item.start?.dateTime || item.start?.date || '',
      end: item.end?.dateTime || item.end?.date || '',
    }));

    return { success: true, events };
  } catch (e: any) {
    console.warn('Calendar check error:', e);
    return { success: false, message: `Calendar check failed: ${toFailureMessage(e)}`, events: [] };
  }
}

export async function calendarCreateEvent(summary: string, startTime: string, endTime: string, location?: string): Promise<{ success: boolean; message: string; eventId?: string }> {
  try {
    const body: any = {
      summary,
      start: { dateTime: startTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end: { dateTime: endTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    };
    if (location) body.location = location;

    const resp = await googleFetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    return {
      success: true,
      message: `Event "${summary}" created successfully`,
      eventId: data.id,
    };
  } catch (e: any) {
    console.warn('Calendar create error:', e);
    return { success: false, message: `Calendar create failed: ${toFailureMessage(e)}` };
  }
}

// ─── Google Drive ────────────────────────────────────

export async function driveSearch(query: string): Promise<{ success: boolean; message?: string; files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }> }> {
  try {
    const safeQuery = escapeDriveQuery(query);
    const resp = await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${safeQuery}' or fullText contains '${safeQuery}'`)}&fields=files(id,name,mimeType,modifiedTime)`);

    const data = await resp.json();
    return { success: true, files: data.files || [] };
  } catch (e: any) {
    console.warn('Drive search error:', e);
    return { success: false, message: `Drive search failed: ${toFailureMessage(e)}`, files: [] };
  }
}

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
  md5Checksum?: string;
  appProperties?: Record<string, string>;
}

export async function driveEnsureFolder(
  folderName: string,
): Promise<{ success: boolean; message?: string; folder?: DriveFileSummary }> {
  try {
    const safeName = escapeDriveQuery(folderName);
    const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${safeName}' and trashed = false`;
    const lookup = await googleFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=1`,
    );
    const lookupData = await lookup.json();
    const existing = lookupData.files?.[0];
    if (existing) {
      return { success: true, folder: existing };
    }

    const createResp = await googleFetch('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime,webViewLink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: {
          beatriceKnowledgeBase: 'true',
        },
      }),
    });
    const folder = await createResp.json();
    return { success: true, folder };
  } catch (e: any) {
    console.warn('Drive folder ensure error:', e);
    return { success: false, message: `Drive folder setup failed: ${toFailureMessage(e)}` };
  }
}

export async function driveListFilesInFolder(
  folderId: string,
  limit = 50,
): Promise<{ success: boolean; message?: string; files: DriveFileSummary[] }> {
  try {
    const q = `'${escapeDriveQuery(folderId)}' in parents and trashed = false`;
    const resp = await googleFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,webViewLink,size,md5Checksum,appProperties)&pageSize=${Math.max(1, Math.min(limit, 100))}&orderBy=modifiedTime desc`,
    );
    const data = await resp.json();
    return { success: true, files: data.files || [] };
  } catch (e: any) {
    console.warn('Drive folder list error:', e);
    return { success: false, message: `Drive folder list failed: ${toFailureMessage(e)}`, files: [] };
  }
}

export async function driveUploadFile(
  file: File,
  options: {
    folderId?: string;
    appProperties?: Record<string, string>;
  } = {},
): Promise<{ success: boolean; message?: string; file?: DriveFileSummary }> {
  try {
    const boundary = `beatrice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const mimeType = file.type || 'application/octet-stream';
    const metadata = {
      name: file.name || `beatrice-upload-${Date.now()}`,
      mimeType,
      parents: options.folderId ? [options.folderId] : undefined,
      appProperties: {
        beatriceKnowledgeFile: 'true',
        ...(options.appProperties || {}),
      },
    };
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const body = new Blob(
      [
        delimiter,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        delimiter,
        `Content-Type: ${mimeType}\r\n\r\n`,
        file,
        closeDelimiter,
      ],
      { type: `multipart/related; boundary=${boundary}` },
    );

    const resp = await googleFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink,size,md5Checksum,appProperties',
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    const uploaded = await resp.json();
    return { success: true, file: uploaded };
  } catch (e: any) {
    console.warn('Drive upload error:', e);
    return { success: false, message: `Drive upload failed: ${toFailureMessage(e)}` };
  }
}

export async function driveDownloadFileBlob(
  fileId: string,
): Promise<{ success: boolean; message?: string; blob?: Blob }> {
  try {
    const resp = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
    return { success: true, blob: await resp.blob() };
  } catch (e: any) {
    console.warn('Drive download error:', e);
    return { success: false, message: `Drive download failed: ${toFailureMessage(e)}` };
  }
}

export async function driveExportFileBlob(
  fileId: string,
  mimeType: string,
): Promise<{ success: boolean; message?: string; blob?: Blob }> {
  try {
    const resp = await googleFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType)}`,
    );
    return { success: true, blob: await resp.blob() };
  } catch (e: any) {
    console.warn('Drive export error:', e);
    return { success: false, message: `Drive export failed: ${toFailureMessage(e)}` };
  }
}

// ─── Google Docs ─────────────────────────────────────

export async function docsCreate(title: string, content?: string): Promise<{ success: boolean; message: string; url?: string; docId?: string }> {
  try {
    // Step 1: Create blank document
    const createResp = await googleFetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });

    const doc = await createResp.json();
    const docId = doc.documentId;

    // Step 2: Insert content if provided
    if (content && docId) {
      await googleFetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: content,
              },
            },
          ],
        }),
      });
    }

    return {
      success: true,
      message: `Document "${title}" created`,
      url: `https://docs.google.com/document/d/${docId}`,
      docId,
    };
  } catch (e: any) {
    console.warn('Docs create error:', e);
    return { success: false, message: `Docs create failed: ${toFailureMessage(e)}` };
  }
}

// ─── Google Meet ─────────────────────────────────────

export async function meetSchedule(time: string, attendees?: string): Promise<{ success: boolean; message: string; meetLink?: string }> {
  try {
    // Create calendar event with Meet link
    const startTime = new Date(time);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour default

    const eventBody: any = {
      summary: 'Meeting scheduled by Beatrice',
      start: { dateTime: startTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end: { dateTime: endTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      conferenceData: {
        createRequest: {
          requestId: `meet_${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    if (attendees) {
      eventBody.attendees = attendees.split(',').map((email: string) => ({ email: email.trim() }));
    }

    const resp = await googleFetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    });

    const data = await resp.json();
    const meetLink = data.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === 'video')?.uri || '';

    return {
      success: true,
      message: attendees
        ? `Meeting scheduled with ${attendees}`
        : `Meeting scheduled for ${startTime.toLocaleTimeString()}`,
      meetLink,
    };
  } catch (e: any) {
    console.warn('Meet schedule error:', e);
    return { success: false, message: `Meet schedule failed: ${toFailureMessage(e)}` };
  }
}

// ─── Service Router ──────────────────────────────────

export type GoogleServiceAction = {
  name: string;
  execute: () => Promise<string>;
};

/**
 * Detects which Google service action to take based on user message
 * and returns a description of what was done (for display in chat).
 */
export async function executeGoogleService(
  userMessage: string
): Promise<{ handled: boolean; result: string; serviceName: string; success?: boolean }> {
  const msg = userMessage.toLowerCase();

  // Gmail Send
  const emailMatch = msg.match(/send(\s+(an?\s+)?)?email\s+(to\s+)?(\S+@\S+)?(\s+)?(subject\s+(.+?))?(\s+)?(body\s+(.+))?/i);
  if (emailMatch) {
    const recipient = emailMatch[4] || '';
    if (!recipient) {
      return {
        handled: true,
        result: 'Gmail send failed: recipient email address is required.',
        serviceName: 'Gmail',
        success: false,
      };
    }
    const subject = emailMatch[7] || 'From Beatrice';
    const body = emailMatch[10] || userMessage;
    const result = await gmailSend(recipient, subject, body);
    return { handled: true, result: result.message, serviceName: 'Gmail', success: result.success };
  }

  // Gmail Read
  if (/read\s+(my\s+)?(email|inbox|messages)|check\s+(my\s+)?(email|inbox)/i.test(msg)) {
    const query = msg.includes('from ') ? msg.split('from ')[1]?.trim() : undefined;
    const result = await gmailRead(query);
    if (!result.success) {
      return {
        handled: true,
        result: result.message || 'Gmail read failed.',
        serviceName: 'Gmail',
        success: false,
      };
    }
    const count = result.messages.length;
    return {
      handled: true,
      result: `Found ${count} recent message${count !== 1 ? 's' : ''} in your inbox.`,
      serviceName: 'Gmail',
      success: true,
    };
  }

  // Calendar check
  if (/check\s+(my\s+)?(calendar|schedule)|what(\'s| is)\s+(on\s+)?(my\s+)?(calendar|schedule)/i.test(msg)) {
    const today = new Date().toISOString().split('T')[0];
    const result = await calendarCheckSchedule(today);
    if (!result.success) {
      return {
        handled: true,
        result: result.message || 'Calendar check failed.',
        serviceName: 'Calendar',
        success: false,
      };
    }
    const eventCount = result.events.length;
    return {
      handled: true,
      result: eventCount > 0
        ? `You have ${eventCount} event${eventCount !== 1 ? 's' : ''} today.`
        : `You have no events scheduled for today. Your calendar is clear!`,
      serviceName: 'Calendar',
      success: true,
    };
  }

  // Calendar create
  if (/create\s+(an?\s+)?event|schedule\s+(a\s+)?meeting|add\s+(to\s+)?(my\s+)?calendar/i.test(msg)) {
    const titleMatch = msg.match(/(?:called|titled|named)\s+"([^"]+)"|(?:for|about)\s+([a-z\s]+?)(?:\s+(?:on|at|tomorrow|today))/i);
    const summary = titleMatch?.[1] || titleMatch?.[2] || 'New Event';
    const startTime = new Date(Date.now() + 3600000).toISOString();
    const endTime = new Date(Date.now() + 7200000).toISOString();
    const result = await calendarCreateEvent(summary, startTime, endTime);
    return { handled: true, result: result.message, serviceName: 'Calendar', success: result.success };
  }

  // Drive search
  if (/search\s+(my\s+)?drive|find\s+(a\s+)?file|drive\s+search/i.test(msg)) {
    const queryMatch = msg.match(/(?:for|named|called)\s+"([^"]+)"|(?:find|search)\s+(?:for\s+)?(.+)/i);
    const query = queryMatch?.[1] || queryMatch?.[2] || userMessage;
    const result = await driveSearch(query);
    if (!result.success) {
      return {
        handled: true,
        result: result.message || 'Drive search failed.',
        serviceName: 'Drive',
        success: false,
      };
    }
    return {
      handled: true,
      result: `Found ${result.files.length} file${result.files.length !== 1 ? 's' : ''} matching your search.`,
      serviceName: 'Drive',
      success: true,
    };
  }

  // Docs create
  if (/create\s+(a\s+)?(doc|document)/i.test(msg)) {
    const titleMatch = msg.match(/(?:called|titled|named)\s+"([^"]+)"|(?:create)\s+(?:a\s+)?(?:doc|document)\s+(?:called\s+)?(.+)/i);
    const title = titleMatch?.[1] || titleMatch?.[2]?.trim() || 'Untitled Document';
    const result = await docsCreate(title);
    return { handled: true, result: result.message, serviceName: 'Docs', success: result.success };
  }

  // Meet schedule
  if (/schedule\s+(a\s+)?(meet|video\s*call)|create\s+(a\s+)?meet\s+link/i.test(msg)) {
    const now = new Date().toISOString();
    const result = await meetSchedule(now);
    return { handled: true, result: result.message, serviceName: 'Meet', success: result.success };
  }

  return { handled: false, result: '', serviceName: '' };
}
