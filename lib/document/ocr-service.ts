import { MULTILINGUAL_OCR_LANGS } from './constants';
import { OCRExtraction, ScanImageAsset, SupportedDocumentLanguage } from './types';
import { detectLanguageHeuristically, normalizeWhitespace } from './utils';

interface OCRJobOptions {
  pages: ScanImageAsset[];
  onProgress?: (progress: number, status: string) => void;
}

let tesseractPromise: Promise<typeof import('tesseract.js')> | null = null;

const loadTesseract = async () => {
  if (!tesseractPromise) {
    tesseractPromise = import('tesseract.js');
  }

  return tesseractPromise;
};

export const OCRService = {
  detectLanguage(text: string): SupportedDocumentLanguage {
    return detectLanguageHeuristically(text);
  },

  cleanText(text: string) {
    return normalizeWhitespace(
      text
        .replace(/[|¦]/g, 'I')
        .replace(/[ ]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n'),
    );
  },

  getConfidence(confidences: number[]) {
    if (confidences.length === 0) return 0;
    return confidences.reduce((sum, value) => sum + value, 0) / confidences.length / 100;
  },

  async extractText({ pages, onProgress }: OCRJobOptions): Promise<OCRExtraction> {
    const { createWorker } = await loadTesseract();
    const worker = await createWorker(MULTILINGUAL_OCR_LANGS, 1, {
      logger: message => {
        if (typeof message.progress === 'number') {
          onProgress?.(message.progress, message.status);
        }
      },
    });

    try {
      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '3' as any,
      });

      const pageTexts: string[] = [];
      const confidences: number[] = [];

      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        onProgress?.(index / pages.length, `Analyzing page ${index + 1} of ${pages.length}`);
        const result = await worker.recognize(page.dataUrl, { rotateAuto: true }, { text: true });
        pageTexts.push(result.data.text || '');
        confidences.push(result.data.confidence || 0);
      }

      const rawText = pageTexts.join('\n\n--- PAGE BREAK ---\n\n').trim();
      const cleanedText = this.cleanText(rawText);
      const detectedLanguage = this.detectLanguage(cleanedText);

      onProgress?.(1, 'OCR completed');

      return {
        raw_text: rawText,
        cleaned_text: cleanedText,
        detected_language: detectedLanguage,
        confidence: this.getConfidence(confidences),
        page_count: pages.length,
      };
    } finally {
      await worker.terminate();
    }
  },
};
