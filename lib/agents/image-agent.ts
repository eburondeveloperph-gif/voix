/**
 * Image Agent - Handles AI image generation for Beatrice tools.
 */
import { GoogleGenAI } from '@google/genai';
import { useUI } from '@/lib/state';
import type { AgentHandler, AgentResult } from './types';

const IMAGE_MODEL = ((import.meta.env as Record<string, string | undefined>).VITE_GEMINI_IMAGE_MODEL || 'imagen-4.0-generate-001').trim();
const ALLOWED_ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9']);

function getGeminiApiKey(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
}

function normalizeAspectRatio(value: unknown): string {
  const ratio = typeof value === 'string' ? value.trim() : '';
  return ALLOWED_ASPECT_RATIOS.has(ratio) ? ratio : '1:1';
}

function normalizeImageCount(value: unknown): number {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(4, Math.round(parsed)));
}

function filenameFromPrompt(prompt: string, mimeType: string): string {
  const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 44) || 'generated-image';
  return `${slug}.${extension}`;
}

export const handle: AgentHandler = async (toolName, args): Promise<AgentResult> => {
  switch (toolName) {
    case 'image_generate': {
      const prompt = String(args.prompt || args.text || args.description || '').trim();
      if (!prompt) {
        return { status: 'error', message: 'Image generation needs a prompt.' };
      }

      const apiKey = getGeminiApiKey();
      if (!apiKey) {
        return { status: 'error', message: 'Gemini API key is missing. Set GEMINI_API_KEY or VITE_GEMINI_API_KEY to generate images.' };
      }

      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateImages({
          model: IMAGE_MODEL,
          prompt,
          config: {
            numberOfImages: normalizeImageCount(args.numberOfImages),
            aspectRatio: normalizeAspectRatio(args.aspectRatio),
            negativePrompt: typeof args.negativePrompt === 'string' ? args.negativePrompt : undefined,
            outputMimeType: 'image/png',
            includeRaiReason: true,
            enhancePrompt: true,
          },
        });

        const generatedImages = response.generatedImages || [];
        const firstImage = generatedImages.find(item => item.image?.imageBytes);
        if (!firstImage?.image?.imageBytes) {
          const reason = generatedImages.find(item => item.raiFilteredReason)?.raiFilteredReason;
          return {
            status: 'error',
            message: reason ? `Image generation was filtered: ${reason}` : 'Image generation completed without an image result.',
            data: { model: IMAGE_MODEL, prompt },
          };
        }

        const mimeType = firstImage.image.mimeType || 'image/png';
        const imageDataUrl = `data:${mimeType};base64,${firstImage.image.imageBytes}`;
        const downloadFilename = filenameFromPrompt(prompt, mimeType);

        useUI.getState().setTaskResult({
          title: 'AI Image Generated',
          message: 'Your generated image is ready in the voice workspace.',
          artifactType: 'image',
          previewData: imageDataUrl,
          downloadData: imageDataUrl,
          downloadFilename,
          mimeType,
        });

        return {
          status: 'success',
          message: 'Image generated and placed in the voice workspace.',
          data: {
            model: IMAGE_MODEL,
            prompt,
            enhancedPrompt: firstImage.enhancedPrompt,
            mimeType,
            imageDataUrl,
            filename: downloadFilename,
          },
        };
      } catch (error) {
        return {
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to generate image.',
          data: { model: IMAGE_MODEL, prompt },
        };
      }
    }

    default:
      return { status: 'error', message: `Image agent does not support tool: ${toolName}` };
  }
};
