import { ObjectDetectionService } from '@/lib/vision/object-detection-service';
import { useCctvVisionStore } from '@/lib/vision/cctv-store';
import { useVisionCameraToolStore } from '@/lib/vision/camera-tool-store';
import { OCRService } from '@/lib/document/ocr-service';
import type { AgentHandler, AgentResult } from './types';

export const handle: AgentHandler = async (toolName, args, _ctx): Promise<AgentResult> => {
  switch (toolName) {
    case 'vision_detect_objects': {
      const imageDataUrl =
        typeof args.imageDataUrl === 'string'
          ? args.imageDataUrl
          : useCctvVisionStore.getState().lastFrameDataUrl;
      if (!imageDataUrl) {
        return {
          status: 'error',
          message: 'No image frame is available. Capture a camera snapshot or start a CCTV monitor first.',
        };
      }

      const result = await ObjectDetectionService.detectDataUrl(
        imageDataUrl,
        typeof args.sourceLabel === 'string' ? args.sourceLabel : 'Beatrice vision image',
      );
      useCctvVisionStore.getState().setLastResult(result);
      return {
        status: 'success',
        message: result.summary,
        data: {
          detections: result.detections,
          threatDetections: result.threatDetections,
          summary: result.summary,
        },
      };
    }

    case 'vision_video_camera_open': {
      const sourceLabel =
        typeof args.sourceLabel === 'string' && args.sourceLabel.trim()
          ? args.sourceLabel.trim()
          : 'Beatrice video camera';
      useVisionCameraToolStore.getState().openVideoCamera({
        sourceLabel,
        autoDetect: args.autoDetect !== false,
      });
      return {
        status: 'success',
        message: `I opened the video camera for ${sourceLabel}. It will use browser video capture with live boxes, labels, confidence scores, and OCR preview.`,
        data: {
          action: 'video_camera_opened',
          sourceLabel,
          autoDetect: args.autoDetect !== false,
        },
      };
    }

    case 'vision_take_photo': {
      const sourceLabel =
        typeof args.sourceLabel === 'string' && args.sourceLabel.trim()
          ? args.sourceLabel.trim()
          : 'Phone camera photo';
      useVisionCameraToolStore.getState().openPhotoCamera({
        sourceLabel,
        autoDetect: args.autoDetect !== false,
      });
      return {
        status: 'success',
        message: `I opened the phone camera/photo picker for ${sourceLabel}. After the image is captured, Beatrice will run object detection and OCR on it.`,
        data: {
          action: 'photo_camera_opened',
          sourceLabel,
          autoDetect: args.autoDetect !== false,
        },
      };
    }

    case 'vision_ocr_latest_frame': {
      const imageDataUrl =
        typeof args.imageDataUrl === 'string'
          ? args.imageDataUrl
          : useCctvVisionStore.getState().lastFrameDataUrl;
      if (!imageDataUrl) {
        return {
          status: 'error',
          message: 'No image frame is available for OCR. Capture a camera photo or video snapshot first.',
        };
      }

      const sourceLabel =
        typeof args.sourceLabel === 'string' && args.sourceLabel.trim()
          ? args.sourceLabel.trim()
          : 'latest camera frame';
      const ocr = await OCRService.extractText({
        pages: [
          {
            id: 'vision_ocr_latest_frame',
            dataUrl: imageDataUrl,
            width: 0,
            height: 0,
            metadata: { sourceLabel },
          },
        ],
      });
      return {
        status: 'success',
        message: ocr.cleaned_text.trim()
          ? `OCR found text in ${sourceLabel}: ${ocr.cleaned_text.slice(0, 400)}`
          : `OCR did not find readable text in ${sourceLabel}.`,
        data: {
          text: ocr.cleaned_text,
          confidence: ocr.confidence,
          language: ocr.detected_language,
        },
      };
    }

    case 'vision_cctv_monitor_start': {
      const streamUrl = typeof args.streamUrl === 'string' ? args.streamUrl.trim() : '';
      if (!streamUrl) {
        return { status: 'error', message: 'A browser-readable CCTV streamUrl is required.' };
      }
      const intervalMs = typeof args.intervalMs === 'number' ? args.intervalMs : 3000;
      const sourceLabel = typeof args.sourceLabel === 'string' ? args.sourceLabel : 'CCTV feed';
      useCctvVisionStore.getState().openMonitor({
        streamUrl,
        sourceLabel,
        intervalMs,
        enabled: true,
      });
      return {
        status: 'success',
        message: `CCTV monitor opened for ${sourceLabel}. Beatrice will scan frames every ${Math.round(intervalMs / 1000)} seconds when the feed is browser-readable.`,
        data: {
          streamUrl,
          sourceLabel,
          intervalMs,
        },
      };
    }

    case 'vision_cctv_monitor_stop': {
      useCctvVisionStore.getState().closeMonitor();
      return { status: 'success', message: 'CCTV monitor stopped.' };
    }

    default:
      return { status: 'error', message: `Vision agent does not support tool: ${toolName}` };
  }
};
