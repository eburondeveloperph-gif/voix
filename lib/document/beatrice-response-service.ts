import { DocumentAnswerResult, ScannedDocumentRecord } from './types';

export const BeatriceResponseService = {
  generateVoiceResponse(document: ScannedDocumentRecord) {
    if (document.ocr.confidence < 0.55) {
      return 'Ik heb de tekst kunnen lezen, maar sommige delen zijn niet helemaal duidelijk. Je mag de foto opnieuw nemen met beter licht, of ik kan toch al samenvatten wat ik wel goed heb herkend.';
    }

    if (document.ocr.detected_language === 'fr') {
      return `Jo, ik heb de Franse tekst gelezen. Kort gezegd gaat het document over ${document.analysis.short_summary.toLowerCase()}. Ik heb het voorlopig onthouden in deze sessie.`;
    }

    if (document.ocr.detected_language === 'nl') {
      return `Jo, ik heb de tekst gelezen. Kort gezegd gaat het document over ${document.analysis.short_summary.toLowerCase()}. Ik heb het beschikbaar in deze sessie.`;
    }

    return `Jo, I have read the document. In short, ${document.analysis.short_summary} I kept it available in this session for follow-up questions.`;
  },

  generateTextResponse(document: ScannedDocumentRecord): DocumentAnswerResult {
    return {
      text: `${document.analysis.short_summary}\n\nKey points:\n- ${document.analysis.key_points.join('\n- ')}`,
      language: document.ocr.detected_language,
    };
  },
};
