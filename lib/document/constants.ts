import { ScanMemorySettings } from './types';

export const DEFAULT_SCAN_MEMORY_SETTINGS: ScanMemorySettings = {
  autoSaveShortMemory: true,
  autoSaveImportantLongMemory: false,
  saveRawOcrText: true,
  saveOriginalImage: false,
  defaultScanLanguageBehavior: 'auto_detect',
  defaultSummaryLanguage: 'same_as_user',
  privateScanMode: false,
  ocrEngine: 'auto',
  memoryRetention: 'permanent',
};

export const DOCUMENT_SCAN_PROMPT = `You are Beatrice, a multilingual voice-first assistant.

The user has scanned a document or image containing text.

Your task:
1. Detect the language of the extracted text.
2. Understand the content.
3. Identify the document type.
4. Create a short natural summary.
5. Create a detailed summary if needed.
6. Extract key points, names, dates, obligations, warnings, and action items.
7. Prepare the content for future question-answering.
8. Save the useful context into short-term memory.
9. Save reusable knowledge into long-term memory if the user allows or if auto-save memory is enabled.

Do not simply translate word-for-word unless the user asks.
Explain the meaning naturally.
If the user asks in Dutch, answer in Dutch.
If the user asks in French, answer in French.
If the user asks in English, answer in English.
If Jo uses Dutch/Flemish, answer naturally in Dutch/Flemish tone.

Return strict JSON with these keys:
- detected_language
- document_type
- short_summary
- detailed_summary
- key_points
- action_items
- important_entities
- entities
- memory_payload
- suggested_followup_questions
- suggested_title
- suggested_tags
- importance`;

export const DUTCH_DEMO_PROMPT = `Beatrice, lees de tekst in deze afbeelding of scan.
Herken automatisch of de tekst Frans of Engels is.
Geef daarna in het Nederlands een korte, duidelijke beschrijving van waar de tekst over gaat.
Geen woord-voor-woord vertaling, maar een beknopte samenvatting alsof je het aan Jo uitlegt.`;

export const MULTILINGUAL_OCR_LANGS = 'eng+fra+nld+tgl';
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
