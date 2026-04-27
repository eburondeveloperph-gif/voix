export type VoiceIntentName =
  | 'DOCUMENT_SCAN_INTENT'
  | 'DOCUMENT_MEMORY_SAVE_INTENT'
  | 'DOCUMENT_MEMORY_SEARCH_INTENT'
  | 'DOCUMENT_MEMORY_DELETE_INTENT'
  | 'NONE';

export interface VoiceIntentResult {
  intent: VoiceIntentName;
  matchedPhrase: string | null;
}

const MATCHERS: Array<{ intent: VoiceIntentName; phrases: string[] }> = [
  {
    intent: 'DOCUMENT_SCAN_INTENT',
    phrases: [
      'scan this',
      'scan document',
      'read this document',
      'read this paper',
      'take a photo of this text',
      'ocr this',
      'analyze this image',
      'summarize this document',
      'read this image',
      'translate this scan',
      'explain this in dutch',
      'beatrice scan this document',
      'beatrice read this paper',
      'lees deze tekst',
      'scan deze tekst',
      'geef mij een samenvatting',
      'résumé ce document',
      'lis ce document',
      'vertaal deze tekst',
      'read this english document',
      'scan this french text and explain it in dutch',
      'save this document to memory',
      'remember this document for later',
    ],
  },
  {
    intent: 'DOCUMENT_MEMORY_SAVE_INTENT',
    phrases: [
      'save this document',
      'save this to long memory',
      'remember this document',
      'remember this paper',
      'save this scan',
    ],
  },
  {
    intent: 'DOCUMENT_MEMORY_SEARCH_INTENT',
    phrases: [
      'what did i scan',
      'find the french document',
      'do we already have this in memory',
      'compare this to the previous document',
      'find the agreement document',
    ],
  },
  {
    intent: 'DOCUMENT_MEMORY_DELETE_INTENT',
    phrases: [
      'forget the document',
      'delete the scan',
      'remove this from memory',
    ],
  },
];

export const VoiceCommandRouter = {
  detectIntent(transcript: string): VoiceIntentResult {
    const normalized = transcript.toLowerCase().trim();
    if (!normalized) {
      return { intent: 'NONE', matchedPhrase: null };
    }

    for (const matcher of MATCHERS) {
      const matchedPhrase = matcher.phrases.find(phrase => normalized.includes(phrase));
      if (matchedPhrase) {
        return {
          intent: matcher.intent,
          matchedPhrase,
        };
      }
    }

    return { intent: 'NONE', matchedPhrase: null };
  },
};
