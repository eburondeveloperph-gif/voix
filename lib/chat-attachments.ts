/**
 * Chat Attachments — File ingestion for the text chat.
 *
 * Handles any file type the user drops into the chat:
 *   • Images → passed through as data URL; described by Gemini Vision.
 *   • PDF    → text extracted via pdfjs-dist.
 *   • DOCX   → mammoth raw-text extraction.
 *   • XLSX / XLS / CSV / ODS → SheetJS, sheet-by-sheet CSV dump.
 *   • PPTX   → JSZip pulls slide XML, regex extracts <a:t>… text runs.
 *   • Plain text / code formats → FileReader.readAsText.
 *   • Anything else → attached as a metadata-only reference.
 *
 * The result is consumed by the chat composer in App.tsx, which renders the
 * attachment in the message bubble and forwards extracted text to Beatrice.
 */

const TEXT_LIKE_EXT = new Set([
  'txt',
  'md',
  'markdown',
  'rst',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'sh',
  'bash',
  'zsh',
  'sql',
  'log',
  'ini',
  'toml',
  'env',
  'conf',
  'csv',
  'tsv',
]);

const TEXT_LIKE_MIME_PREFIXES = ['text/', 'application/json', 'application/xml'];

export type AttachmentKind =
  | 'image'
  | 'video'
  | 'pdf'
  | 'docx'
  | 'spreadsheet'
  | 'pptx'
  | 'text'
  | 'binary';

export interface ChatAttachment {
  kind: AttachmentKind;
  filename: string;
  size: number;
  mimeType: string;
  /** Truncated extracted text content (may be empty for unsupported types). */
  extractedText: string;
  /** Whether extracted text was truncated. */
  truncated: boolean;
  /** For images only: data URL preview (also used for vision API calls). */
  imageDataUrl?: string;
  /** Total characters extracted before truncation. */
  rawCharCount: number;
  /** Optional human note (e.g. "Could not read the file content"). */
  note?: string;
}

export const MAX_TEXT_CHARS = 6000;

const collapseWhitespace = (text: string) =>
  text.replace(/[\t ]+/g, ' ').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const truncate = (text: string) => {
  const cleaned = collapseWhitespace(text);
  if (cleaned.length <= MAX_TEXT_CHARS) {
    return { text: cleaned, truncated: false, rawCharCount: cleaned.length };
  }
  return {
    text: `${cleaned.slice(0, MAX_TEXT_CHARS)}…`,
    truncated: true,
    rawCharCount: cleaned.length,
  };
};

const fileToArrayBuffer = (file: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsArrayBuffer(file);
  });

const fileToText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsText(file);
  });

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(file);
  });

let pdfJsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
const loadPdfJs = () => {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist').then(module => {
      module.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      return module;
    });
  }
  return pdfJsPromise;
};

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfJs();
  const buf = await fileToArrayBuffer(file);
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const lines: string[] = [];
  const pageLimit = Math.min(pdf.numPages, 30);
  for (let pageNum = 1; pageNum <= pageLimit; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map(item => ('str' in item ? (item as any).str : ''))
      .filter(Boolean)
      .join(' ');
    if (pageText.trim()) {
      lines.push(`--- Page ${pageNum} ---`);
      lines.push(pageText);
    }
  }
  if (pdf.numPages > pageLimit) {
    lines.push(`\n[+${pdf.numPages - pageLimit} more pages truncated]`);
  }
  return lines.join('\n');
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser');
  const buf = await fileToArrayBuffer(file);
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value || '';
}

async function extractSpreadsheetText(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const buf = await fileToArrayBuffer(file);
  const workbook = XLSX.read(buf, { type: 'array' });
  const out: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      out.push(`--- Sheet: ${sheetName} ---`);
      out.push(csv.trim());
    }
  }
  return out.join('\n\n');
}

async function extractPptxText(file: File): Promise<string> {
  const JSZipMod: any = await import('jszip');
  const JSZip = JSZipMod.default || JSZipMod;
  const buf = await fileToArrayBuffer(file);
  const zip = await JSZip.loadAsync(buf);
  const slides: { num: number; text: string }[] = [];
  await Promise.all(
    Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .map(async name => {
        const xml = await zip.files[name].async('string');
        const match = name.match(/slide(\d+)\.xml/);
        const num = match ? parseInt(match[1], 10) : 0;
        const runs = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g));
        const text = runs
          .map(m => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (text) slides.push({ num, text });
      }),
  );
  slides.sort((a, b) => a.num - b.num);
  return slides.map(s => `--- Slide ${s.num} ---\n${s.text}`).join('\n\n');
}

const isTextLike = (file: File) => {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (TEXT_LIKE_EXT.has(ext)) return true;
  return TEXT_LIKE_MIME_PREFIXES.some(prefix => file.type.startsWith(prefix));
};

const detectKind = (file: File): AttachmentKind => {
  const mime = file.type.toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return 'docx';
  }
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === 'pptx'
  ) {
    return 'pptx';
  }
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.oasis.opendocument.spreadsheet' ||
    mime === 'text/csv' ||
    ext === 'xlsx' ||
    ext === 'xls' ||
    ext === 'csv' ||
    ext === 'tsv' ||
    ext === 'ods'
  ) {
    return 'spreadsheet';
  }
  if (isTextLike(file)) return 'text';
  return 'binary';
};

export async function extractChatAttachment(file: File): Promise<ChatAttachment> {
  const kind = detectKind(file);
  const base = {
    filename: file.name || 'attachment',
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    extractedText: '',
    truncated: false,
    rawCharCount: 0,
  } as ChatAttachment;

  try {
    if (kind === 'image') {
      const dataUrl = await fileToDataUrl(file);
      return { ...base, kind, imageDataUrl: dataUrl };
    }
    if (kind === 'video') {
      return {
        ...base,
        kind,
        note: 'Video media uploaded. Beatrice stores the original file in Drive and can use it as a source reference.',
      };
    }
    if (kind === 'pdf') {
      const raw = await extractPdfText(file);
      const t = truncate(raw);
      return { ...base, kind, extractedText: t.text, truncated: t.truncated, rawCharCount: t.rawCharCount };
    }
    if (kind === 'docx') {
      const raw = await extractDocxText(file);
      const t = truncate(raw);
      return { ...base, kind, extractedText: t.text, truncated: t.truncated, rawCharCount: t.rawCharCount };
    }
    if (kind === 'spreadsheet') {
      const raw = await extractSpreadsheetText(file);
      const t = truncate(raw);
      return { ...base, kind, extractedText: t.text, truncated: t.truncated, rawCharCount: t.rawCharCount };
    }
    if (kind === 'pptx') {
      const raw = await extractPptxText(file);
      const t = truncate(raw);
      return { ...base, kind, extractedText: t.text, truncated: t.truncated, rawCharCount: t.rawCharCount };
    }
    if (kind === 'text') {
      const raw = await fileToText(file);
      const t = truncate(raw);
      return { ...base, kind, extractedText: t.text, truncated: t.truncated, rawCharCount: t.rawCharCount };
    }
    return {
      ...base,
      kind: 'binary',
      note: 'Beatrice has noted this file but cannot read its contents inline. The metadata is in your knowledgebase.',
    };
  } catch (err) {
    console.error('Attachment extraction failed:', err);
    return {
      ...base,
      kind: 'binary',
      note: err instanceof Error ? err.message : 'Could not read this file.',
    };
  }
}

const KIND_ICON: Record<AttachmentKind, string> = {
  image: 'ph ph-image',
  video: 'ph ph-video',
  pdf: 'ph ph-file-pdf',
  docx: 'ph ph-file-doc',
  spreadsheet: 'ph ph-file-xls',
  pptx: 'ph ph-file-ppt',
  text: 'ph ph-file-text',
  binary: 'ph ph-file',
};

const KIND_LABEL: Record<AttachmentKind, string> = {
  image: 'Image',
  video: 'Video',
  pdf: 'PDF',
  docx: 'Word document',
  spreadsheet: 'Spreadsheet',
  pptx: 'Presentation',
  text: 'Text file',
  binary: 'File',
};

export const formatAttachmentSummary = (att: ChatAttachment) => {
  const sizeKb = Math.max(1, Math.round(att.size / 1024));
  return `${KIND_LABEL[att.kind]} • ${att.filename} • ${sizeKb} KB`;
};

export const attachmentIcon = (kind: AttachmentKind) => KIND_ICON[kind];
export const attachmentLabel = (kind: AttachmentKind) => KIND_LABEL[kind];

/**
 * Build the user-facing chat message body for an attachment. Includes the
 * extracted text (truncated) so Beatrice can answer about it.
 */
export const buildChatPromptForAttachment = (
  att: ChatAttachment,
  userNote?: string,
) => {
  const header = `📎 Attached: ${att.filename} (${KIND_LABEL[att.kind]}, ${Math.max(
    1,
    Math.round(att.size / 1024),
  )} KB)`;
  const note = userNote ? `\nNote from user: ${userNote}` : '';
  if (att.kind === 'image') {
    return `${header}${note}\n\nThis is an image attachment. Please describe what you see and any text or data visible.`;
  }
  if (att.kind === 'video') {
    return `${header}${note}\n\nThis is a video attachment. The original video has been uploaded to Drive as media context. Do not claim to have watched frames unless a separate video or CCTV analysis result is provided.`;
  }
  if (!att.extractedText) {
    return `${header}${note}\n\n${
      att.note || 'No readable text was found in this file.'
    }`;
  }
  const truncationNote = att.truncated
    ? `\n[Content truncated — ${att.rawCharCount.toLocaleString()} characters total]`
    : '';
  return `${header}${note}\n\nContent:\n${att.extractedText}${truncationNote}`;
};

// ── Gemini Vision describer ─────────────────────────────────────────────
// When the user attaches a photo or screenshot, run it through Gemini Vision
// so the text-only DeepSeek conversation can react meaningfully to images.
const VISION_MODEL = 'gemini-2.5-flash';
const VISION_SYSTEM_PROMPT =
  'You are an image-reading assistant. Describe the photo concisely (3-6 sentences). Include any visible text verbatim, identify objects, people, scenes, and note anything that looks important. Do not editorialise.';

export async function describeImage(
  imageDataUrl: string,
  userNote?: string,
): Promise<string> {
  const env: Record<string, string | undefined> =
    (typeof process !== 'undefined' ? (process as any).env : {}) || {};
  const apiKey = env.GEMINI_API_KEY || env.API_KEY;
  if (!apiKey) {
    return 'Image attached. (Vision description unavailable — GEMINI_API_KEY missing.)';
  }
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const [meta, base64] = imageDataUrl.split(',');
    const mimeMatch = meta?.match(/data:([^;]+);base64/);
    const mimeType = mimeMatch?.[1] || 'image/jpeg';
    const data = base64 || imageDataUrl;
    const userText = userNote
      ? `User note: ${userNote}\nDescribe the attached image.`
      : 'Describe the attached image.';
    const response = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data } },
            { text: userText },
          ],
        },
      ],
      config: {
        systemInstruction: VISION_SYSTEM_PROMPT,
        maxOutputTokens: 400,
        temperature: 0.4,
      },
    });
    return (response.text || '').trim() || 'No description returned.';
  } catch (err) {
    console.error('Vision describe failed:', err);
    return 'Image attached. (Vision description failed to load.)';
  }
}
