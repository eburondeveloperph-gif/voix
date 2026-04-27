import { auth } from '@/lib/firebase';
import {
  CropBounds,
  DocumentChunkRecord,
  MemoryRetention,
  ScannedDocumentRecord,
  SupportedDocumentLanguage,
} from './types';

const LANGUAGE_HINTS: Record<Exclude<SupportedDocumentLanguage, 'mixed' | 'unknown'>, string[]> = {
  en: ['the', 'and', 'with', 'for', 'this', 'that', 'will', 'from', 'about', 'document'],
  fr: ['le', 'la', 'les', 'des', 'une', 'dans', 'avec', 'pour', 'est', 'document'],
  nl: ['de', 'het', 'een', 'met', 'voor', 'dit', 'dat', 'van', 'en', 'tekst'],
  tl: ['ang', 'mga', 'para', 'ito', 'iyan', 'sa', 'ng', 'ako', 'kami', 'dokumento'],
};

export const nowIso = () => new Date().toISOString();

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const createId = (prefix: string) =>
  `${prefix}_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;

export const safeJsonParse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const normalizeWhitespace = (value: string) =>
  value
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

export const detectLanguageHeuristically = (value: string): SupportedDocumentLanguage => {
  const text = normalizeWhitespace(value).toLowerCase();
  if (!text) return 'unknown';

  const scores = Object.entries(LANGUAGE_HINTS).map(([language, hints]) => {
    const score = hints.reduce((total, hint) => total + (text.match(new RegExp(`\\b${hint}\\b`, 'g'))?.length || 0), 0);
    return { language: language as SupportedDocumentLanguage, score };
  });

  scores.sort((a, b) => b.score - a.score);
  if (scores[0].score === 0) return 'unknown';
  if (scores[1] && scores[1].score > 0 && scores[0].score - scores[1].score <= 1) {
    return 'mixed';
  }
  return scores[0].language;
};

export const hashText = async (value: string) => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return `hash_${value.length}_${value.slice(0, 12).replace(/\W/g, '')}`;
  }

  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map(item => item.toString(16).padStart(2, '0'))
    .join('');
};

export const getEffectiveUserId = () => auth.currentUser?.uid || 'local-dev-user';

export const getSessionId = () => {
  const storageKey = 'beatrice_document_session_id';
  const existing = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) : null;
  if (existing) return existing;
  const next = createId('session');
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(storageKey, next);
  }
  return next;
};

export const retentionToExpiry = (createdAt: string, retention: MemoryRetention) => {
  const created = new Date(createdAt).getTime();
  if (retention === 'session_only') {
    return new Date(created + 24 * 60 * 60 * 1000).toISOString();
  }
  if (retention === '30_days') {
    return new Date(created + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  return new Date(created + 3650 * 24 * 60 * 60 * 1000).toISOString();
};

export const buildTextChunks = async (
  documentId: string,
  value: string,
  pageCount: number,
  ownerUserId?: string,
): Promise<DocumentChunkRecord[]> => {
  const words = normalizeWhitespace(value).split(/\s+/);
  const chunks: DocumentChunkRecord[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < words.length) {
    const slice = words.slice(cursor, cursor + 160);
    const chunkText = slice.join(' ').trim();
    if (!chunkText) break;
    const id = createId('chunk');
    chunks.push({
      id,
      owner_user_id: ownerUserId,
      document_id: documentId,
      chunk_index: index,
      chunk_text: chunkText,
      embedding_id: id,
      metadata: {
        page_count: pageCount,
        approximate_word_start: cursor,
      },
    });
    cursor += 120;
    index += 1;
  }

  return chunks;
};

export const cosineSimilarity = (a: number[], b: number[]) => {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
};

export const fallbackEmbedding = (value: string, dimensions = 96) => {
  const vector = new Array(dimensions).fill(0);
  const tokens = normalizeWhitespace(value).toLowerCase().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    vector[hash % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(item => item / norm);
};

export const cropBoundsToPixels = (
  bounds: CropBounds,
  naturalWidth: number,
  naturalHeight: number,
) => ({
  x: Math.round(clamp(bounds.left, 0, 1) * naturalWidth),
  y: Math.round(clamp(bounds.top, 0, 1) * naturalHeight),
  width: Math.round(clamp(bounds.width, 0.05, 1) * naturalWidth),
  height: Math.round(clamp(bounds.height, 0.05, 1) * naturalHeight),
});

export const escapeForPrompt = (value: string) => value.replace(/```/g, '"""');

export const buildDocumentAwarePrompt = (
  userText: string,
  activeDocument: ScannedDocumentRecord | null,
  relatedDocuments: ScannedDocumentRecord[] = [],
) => {
  if (!activeDocument && relatedDocuments.length === 0) return userText;

  const sections: string[] = [];
  if (activeDocument) {
    sections.push(
      `ACTIVE SCANNED DOCUMENT:
Title: ${activeDocument.title}
Language: ${activeDocument.ocr.detected_language}
Type: ${activeDocument.analysis.document_type}
Short summary: ${activeDocument.analysis.short_summary}
Detailed summary: ${activeDocument.analysis.detailed_summary}
Key points: ${activeDocument.analysis.key_points.join('; ')}
OCR confidence: ${Math.round(activeDocument.ocr.confidence * 100)}%
Text excerpt:
${escapeForPrompt(activeDocument.ocr.cleaned_text.slice(0, 6000))}`,
    );
  }

  if (relatedDocuments.length > 0) {
    sections.push(
      `RELATED MEMORY MATCHES:
${relatedDocuments
  .slice(0, 3)
  .map(
    doc =>
      `- ${doc.title}: ${doc.analysis.short_summary} (language: ${doc.ocr.detected_language}, type: ${doc.analysis.document_type})`,
  )
  .join('\n')}`,
    );
  }

  sections.push(`USER REQUEST:\n${userText}`);

  return `${sections.join('\n\n')}\n\nUse the document context only when relevant. Mention uncertainty if OCR confidence is low.`;
};
