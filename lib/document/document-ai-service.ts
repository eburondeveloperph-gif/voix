import { GoogleGenAI } from '@google/genai';
import { DOCUMENT_SCAN_PROMPT, DUTCH_DEMO_PROMPT } from './constants';
import {
  DocumentAnalysis,
  DocumentAnswerResult,
  DocumentType,
  OCRExtraction,
  ScannedDocumentRecord,
  SupportedDocumentLanguage,
} from './types';
import {
  createId,
  detectLanguageHeuristically,
  escapeForPrompt,
  fallbackEmbedding,
  normalizeWhitespace,
} from './utils';

const DEFAULT_ANALYSIS: DocumentAnalysis = {
  document_type: 'unknown',
  short_summary: '',
  detailed_summary: '',
  key_points: [],
  action_items: [],
  entities: {
    people: [],
    companies: [],
    dates: [],
    places: [],
    amounts: [],
    emails: [],
    phone_numbers: [],
  },
  important_entities: [],
  memory_payload: '',
  suggested_followup_questions: [],
  suggested_title: 'Untitled document',
  suggested_tags: [],
  importance: 'medium',
};

const envEnabled = (name: string) => {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return value === '1' || value === 'true';
};

const DOCUMENT_AI_DEBUG = envEnabled('VITE_DEBUG_DOCUMENT_AI');
const REMOTE_EMBEDDINGS_ENABLED = envEnabled('VITE_ENABLE_REMOTE_EMBEDDINGS');
let remoteDocumentAnalysisUnavailable = false;
let remoteEmbeddingUnavailable = false;

const isTemporaryModelError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('"code":503') ||
    message.includes('"status":"UNAVAILABLE"') ||
    message.includes('high demand') ||
    message.includes('"code":429') ||
    message.includes('"status":"RESOURCE_EXHAUSTED"') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('"code":404') ||
    message.includes('"status":"NOT_FOUND"')
  );
};

const extractJson = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  return objectMatch?.[0] || trimmed;
};

const toSupportedLanguage = (value: string | undefined): SupportedDocumentLanguage => {
  if (value === 'en' || value === 'fr' || value === 'nl' || value === 'tl' || value === 'mixed') {
    return value;
  }
  return 'unknown';
};

const inferDocumentType = (text: string): DocumentType => {
  const normalized = text.toLowerCase();
  if (/invoice|subtotal|vat|receipt total|tax/.test(normalized)) return 'invoice';
  if (/agreement|terms|party|obligation|contract/.test(normalized)) return 'contract';
  if (/dear|sincerely|regards/.test(normalized)) return 'letter';
  if (/abstract|introduction|references/.test(normalized)) return 'academic_text';
  if (/chapter|page \d+/.test(normalized)) return 'book_page';
  if (/manual|instructions|step 1|step 2/.test(normalized)) return 'instruction_manual';
  if (/campaign|offer|limited time|subscribe/.test(normalized)) return 'marketing_material';
  if (/article|news|reported by/.test(normalized)) return 'article';
  return 'unknown';
};

const extractRegexEntities = (text: string) => {
  const emails = Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []));
  const phoneNumbers = Array.from(
    new Set(text.match(/(?:\+?\d[\d ()-]{7,}\d)/g)?.map(item => item.trim()) || []),
  );
  const dates = Array.from(
    new Set(
      text.match(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4})\b/gi) || [],
    ),
  );
  const amounts = Array.from(new Set(text.match(/(?:€|\$|£)\s?\d[\d,.]*/g) || []));
  return { emails, phone_numbers: phoneNumbers, dates, amounts };
};

const buildFallbackAnalysis = (ocr: OCRExtraction, userRequest: string): DocumentAnalysis => {
  const cleaned = ocr.cleaned_text;
  const preview = cleaned.slice(0, 560);
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  const keyPoints = sentences.slice(0, 4);
  const regexEntities = extractRegexEntities(cleaned);
  const detectedLanguage = detectLanguageHeuristically(cleaned);
  const shortSummary =
    preview.length > 0
      ? `${preview.slice(0, 220)}${preview.length > 220 ? '...' : ''}`
      : 'The scan completed, but the text is limited.';

  return {
    ...DEFAULT_ANALYSIS,
    document_type: inferDocumentType(cleaned),
    short_summary: shortSummary,
    detailed_summary: cleaned.slice(0, 1400),
    key_points: keyPoints,
    action_items: sentences.filter(sentence => /must|should|deadline|before|required|action/i.test(sentence)).slice(0, 5),
    entities: {
      ...DEFAULT_ANALYSIS.entities,
      ...regexEntities,
    },
    important_entities: [...regexEntities.emails, ...regexEntities.dates, ...regexEntities.amounts].slice(0, 12),
    memory_payload: normalizeWhitespace(`${shortSummary}\n\nKey points:\n- ${keyPoints.join('\n- ')}`),
    suggested_followup_questions: [
      'Summarize this shorter',
      'Translate to Dutch',
      'What are the important parts?',
      'Save this to memory',
    ],
    suggested_title:
      keyPoints[0]?.slice(0, 64) ||
      (userRequest.toLowerCase().includes('receipt') ? 'Scanned receipt' : 'Scanned document'),
    suggested_tags: [detectedLanguage, inferDocumentType(cleaned), 'scan'].filter(Boolean) as string[],
    importance: /agreement|invoice|deadline|payment|contract/i.test(cleaned) ? 'high' : 'medium',
  };
};

const getClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
};

export const DocumentAIService = {
  async analyzeDocument({
    ocr,
    userRequest,
  }: {
    ocr: OCRExtraction;
    userRequest: string;
  }): Promise<DocumentAnalysis> {
    const fallback = buildFallbackAnalysis(ocr, userRequest);
    const client = getClient();
    if (!client || !ocr.cleaned_text.trim() || remoteDocumentAnalysisUnavailable) {
      return fallback;
    }

    const responseLanguage =
      /nederlands|dutch|flemish|nederlands uit/.test(userRequest.toLowerCase()) ? 'nl' : 'same_as_user';
    const prompt =
      userRequest.toLowerCase().includes('lees deze tekst')
        ? `${DUTCH_DEMO_PROMPT}\n\nOCR TEXT:\n${escapeForPrompt(ocr.cleaned_text)}`
        : `${DOCUMENT_SCAN_PROMPT}

OCR TEXT:
${escapeForPrompt(ocr.cleaned_text)}

DETECTED LANGUAGE:
${ocr.detected_language}

USER REQUEST:
${escapeForPrompt(userRequest)}

PREFERRED RESPONSE LANGUAGE:
${responseLanguage}`;

    try {
      const result = await client.models.generateContent({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        contents: prompt,
        config: {
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      });

      const parsed = JSON.parse(extractJson(result.text || '{}'));
      return {
        ...fallback,
        ...parsed,
        document_type: parsed.document_type || fallback.document_type,
        short_summary: parsed.short_summary || fallback.short_summary,
        detailed_summary: parsed.detailed_summary || fallback.detailed_summary,
        key_points: Array.isArray(parsed.key_points) ? parsed.key_points : fallback.key_points,
        action_items: Array.isArray(parsed.action_items) ? parsed.action_items : fallback.action_items,
        entities: {
          ...fallback.entities,
          ...(parsed.entities || {}),
        },
        important_entities: Array.isArray(parsed.important_entities)
          ? parsed.important_entities
          : fallback.important_entities,
        memory_payload: parsed.memory_payload || fallback.memory_payload,
        suggested_followup_questions: Array.isArray(parsed.suggested_followup_questions)
          ? parsed.suggested_followup_questions
          : fallback.suggested_followup_questions,
        suggested_title: parsed.suggested_title || fallback.suggested_title,
        suggested_tags: Array.isArray(parsed.suggested_tags) ? parsed.suggested_tags : fallback.suggested_tags,
        importance:
          parsed.importance === 'low' || parsed.importance === 'high' || parsed.importance === 'medium'
            ? parsed.importance
            : fallback.importance,
      };
    } catch (error) {
      if (isTemporaryModelError(error)) {
        remoteDocumentAnalysisUnavailable = true;
      }
      if (DOCUMENT_AI_DEBUG) {
        console.info('Document analysis used local heuristics:', error);
      }
      return fallback;
    }
  },

  async embedText(text: string) {
    const client = getClient();
    if (!client || !text.trim() || !REMOTE_EMBEDDINGS_ENABLED || remoteEmbeddingUnavailable) {
      return fallbackEmbedding(text);
    }

    try {
      const result = await client.models.embedContent({
        model: (import.meta.env as Record<string, string | undefined>).VITE_GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
        contents: text.slice(0, 8000),
        config: {
          outputDimensionality: 96,
        },
      });
      const values = result.embeddings?.[0]?.values;
      return Array.isArray(values) && values.length ? values : fallbackEmbedding(text);
    } catch (error) {
      remoteEmbeddingUnavailable = true;
      if (DOCUMENT_AI_DEBUG) {
        console.info('Embedding used local vectorization:', error);
      }
      return fallbackEmbedding(text);
    }
  },

  async answerQuestion({
    document,
    question,
  }: {
    document: ScannedDocumentRecord;
    question: string;
  }): Promise<DocumentAnswerResult> {
    const client = getClient();
    if (!client) {
      return {
        text: `${document.analysis.short_summary}\n\nImportant parts:\n- ${document.analysis.key_points.join('\n- ')}`,
        language: document.ocr.detected_language,
      };
    }

    try {
      const result = await client.models.generateContent({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        contents: `You are Beatrice. Use the scanned document context below to answer the user's question accurately. Mention uncertainty if OCR confidence is low.

DOCUMENT TITLE: ${document.title}
DOCUMENT LANGUAGE: ${document.ocr.detected_language}
DOCUMENT TYPE: ${document.analysis.document_type}
OCR CONFIDENCE: ${Math.round(document.ocr.confidence * 100)}%
SHORT SUMMARY: ${document.analysis.short_summary}
FULL TEXT:
${escapeForPrompt(document.ocr.cleaned_text.slice(0, 12000))}

QUESTION:
${escapeForPrompt(question)}`,
        config: {
          temperature: 0.2,
          maxOutputTokens: 1200,
        },
      });

      return {
        text: result.text || document.analysis.short_summary,
        language: toSupportedLanguage(question.toLowerCase().includes('dutch') ? 'nl' : document.ocr.detected_language),
      };
    } catch (error) {
      console.warn('Question answering fell back to cached analysis:', error);
      return {
        text: `${document.analysis.short_summary}\n\n${document.analysis.detailed_summary}`,
        language: document.ocr.detected_language,
      };
    }
  },

  buildVoiceSummary(document: ScannedDocumentRecord) {
    const language = document.ocr.detected_language;
    if (language === 'fr') {
      return `Jo, ik heb de Franse tekst gelezen. Kort gezegd gaat het over ${document.analysis.short_summary.toLowerCase()}`;
    }
    if (language === 'nl') {
      return `Jo, ik heb de tekst gelezen. Kort gezegd gaat het over ${document.analysis.short_summary.toLowerCase()}`;
    }
    return `Jo, I have read the document. In short, ${document.analysis.short_summary}`;
  },

  createRelatedDocumentId() {
    return createId('related_doc');
  },
};
