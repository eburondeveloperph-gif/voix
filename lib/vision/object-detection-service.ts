import type { ObjectDetection } from '@tensorflow-models/coco-ssd';
import type { VisionDetection, VisionScanResult } from './types';

const MIN_SCORE = 0.45;
const ULTRALYTICS_ENDPOINT = import.meta.env.VITE_ULTRALYTICS_VISION_ENDPOINT || '';

const THREAT_LABELS: Record<string, string> = {
  person: 'Person visible in monitored area',
  car: 'Vehicle visible in monitored area',
  truck: 'Vehicle visible in monitored area',
  bus: 'Vehicle visible in monitored area',
  motorcycle: 'Vehicle visible in monitored area',
  bicycle: 'Vehicle visible in monitored area',
  knife: 'Sharp object detected',
  scissors: 'Sharp object detected',
  backpack: 'Unattended bag/backpack candidate',
  suitcase: 'Unattended bag/suitcase candidate',
};

let modelPromise: Promise<ObjectDetection> | null = null;

const createId = (prefix: string) =>
  `${prefix}_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;

const getModel = async () => {
  if (!modelPromise) {
    modelPromise = Promise.all([
      import('@tensorflow/tfjs'),
      import('@tensorflow-models/coco-ssd'),
    ]).then(([, cocoSsd]) => cocoSsd.load({ base: 'lite_mobilenet_v2' }));
  }
  return modelPromise;
};

const dataUrlToImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image for object detection.'));
    image.src = dataUrl;
  });

const getElementSize = (
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
) => {
  if (source instanceof HTMLVideoElement) {
    return {
      width: source.videoWidth || source.clientWidth || 1,
      height: source.videoHeight || source.clientHeight || 1,
    };
  }
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width || 1,
      height: source.naturalHeight || source.height || 1,
    };
  }
  return {
    width: source.width || 1,
    height: source.height || 1,
  };
};

const summarize = (detections: VisionDetection[]) => {
  if (!detections.length) {
    return 'No objects above confidence threshold were detected.';
  }
  const counts = detections.reduce<Record<string, number>>((acc, detection) => {
    acc[detection.label] = (acc[detection.label] || 0) + 1;
    return acc;
  }, {});
  const labels = Object.entries(counts)
    .map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`)
    .join(', ');
  const threats = detections.filter(item => item.threat);
  return threats.length
    ? `Detected ${labels}. Potential threat flags: ${threats.map(item => item.label).join(', ')}.`
    : `Detected ${labels}. No configured threat labels were found.`;
};

const toScanResult = (
  predictions: Array<{ class: string; score: number; bbox: [number, number, number, number] }>,
  sourceLabel: string,
  width: number,
  height: number,
): VisionScanResult => {
  const detections = predictions
    .filter(prediction => prediction.score >= MIN_SCORE)
    .map((prediction): VisionDetection => {
      const label = prediction.class;
      const threatReason = THREAT_LABELS[label];
      return {
        id: createId('det'),
        label,
        score: prediction.score,
        box: {
          x: Math.max(0, prediction.bbox[0]),
          y: Math.max(0, prediction.bbox[1]),
          width: Math.max(0, prediction.bbox[2]),
          height: Math.max(0, prediction.bbox[3]),
        },
        threat: Boolean(threatReason),
        threatReason,
      };
    });

  const threatDetections = detections.filter(detection => detection.threat);
  return {
    id: createId('vision'),
    sourceLabel,
    createdAt: new Date().toISOString(),
    width,
    height,
    detections,
    threatDetections,
    summary: summarize(detections),
  };
};

const normalizeRemotePredictions = (payload: any) => {
  const rawItems = Array.isArray(payload?.detections)
    ? payload.detections
    : Array.isArray(payload?.predictions)
      ? payload.predictions
      : Array.isArray(payload?.results)
        ? payload.results
        : [];

  return rawItems
    .map((item: any) => {
      const label = item.class || item.label || item.name;
      const score = item.score ?? item.confidence ?? item.conf ?? item.probability;
      const box = item.box || item.bbox || item.xywh || item.xyxy;
      if (!label || typeof score !== 'number' || !box) return null;

      let bbox: [number, number, number, number] | null = null;
      if (Array.isArray(box) && box.length >= 4) {
        const [x, y, wOrX2, hOrY2] = box.map(Number);
        const usesXyxy = item.xyxy || item.boxMode === 'xyxy';
        bbox = usesXyxy
          ? [x, y, Math.max(0, wOrX2 - x), Math.max(0, hOrY2 - y)]
          : [x, y, wOrX2, hOrY2];
      } else if (typeof box === 'object') {
        const x = Number(box.x ?? box.left ?? box.x1 ?? 0);
        const y = Number(box.y ?? box.top ?? box.y1 ?? 0);
        const width = box.width ?? (typeof box.x2 === 'number' ? box.x2 - x : undefined);
        const height = box.height ?? (typeof box.y2 === 'number' ? box.y2 - y : undefined);
        bbox = [x, y, Math.max(0, Number(width ?? 0)), Math.max(0, Number(height ?? 0))];
      }

      if (!bbox) return null;
      return {
        class: String(label),
        score,
        bbox,
      };
    })
    .filter(Boolean) as Array<{ class: string; score: number; bbox: [number, number, number, number] }>;
};

const detectWithUltralyticsEndpoint = async (
  dataUrl: string,
  sourceLabel: string,
  image: HTMLImageElement,
) => {
  const response = await fetch(ULTRALYTICS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: dataUrl, sourceLabel }),
  });
  if (!response.ok) {
    throw new Error(`Ultralytics endpoint returned ${response.status}`);
  }
  const payload = await response.json();
  const predictions = normalizeRemotePredictions(payload);
  const width = Number(payload?.width || image.naturalWidth || image.width || 1);
  const height = Number(payload?.height || image.naturalHeight || image.height || 1);
  const result = toScanResult(predictions, sourceLabel, width, height);
  result.annotatedDataUrl = drawOverlay(image, result);
  return result;
};

const drawOverlay = (
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  result: VisionScanResult,
) => {
  const canvas = document.createElement('canvas');
  canvas.width = result.width;
  canvas.height = result.height;
  const context = canvas.getContext('2d');
  if (!context) return undefined;

  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  context.lineWidth = Math.max(3, Math.round(canvas.width / 320));
  context.font = `${Math.max(18, Math.round(canvas.width / 48))}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;

  for (const detection of result.detections) {
    const color = detection.threat ? '#ef4444' : '#22c55e';
    const label = `${detection.label} ${Math.round(detection.score * 100)}%`;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.strokeRect(detection.box.x, detection.box.y, detection.box.width, detection.box.height);
    const metrics = context.measureText(label);
    const labelHeight = Math.max(26, Math.round(canvas.width / 34));
    const labelY = Math.max(0, detection.box.y - labelHeight);
    context.globalAlpha = 0.9;
    context.fillRect(detection.box.x, labelY, metrics.width + 18, labelHeight);
    context.globalAlpha = 1;
    context.fillStyle = '#ffffff';
    context.fillText(label, detection.box.x + 9, labelY + labelHeight - 8);
  }

  return canvas.toDataURL('image/jpeg', 0.88);
};

export const ObjectDetectionService = {
  async detectElement(
    source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
    sourceLabel = 'image',
  ): Promise<VisionScanResult> {
    const model = await getModel();
    const size = getElementSize(source);
    const predictions = await model.detect(source);
    const result = toScanResult(predictions as any, sourceLabel, size.width, size.height);
    result.annotatedDataUrl = drawOverlay(source, result);
    return result;
  },

  async detectDataUrl(dataUrl: string, sourceLabel = 'uploaded image') {
    const image = await dataUrlToImage(dataUrl);
    if (ULTRALYTICS_ENDPOINT) {
      try {
        return await detectWithUltralyticsEndpoint(dataUrl, sourceLabel, image);
      } catch (error) {
        console.warn('Ultralytics vision endpoint failed; falling back to browser detector:', error);
      }
    }
    return this.detectElement(image, sourceLabel);
  },

  summarizeThreats(result: VisionScanResult) {
    if (!result.threatDetections.length) {
      return 'No configured CCTV threat labels were detected in the latest frame.';
    }
    return result.threatDetections
      .map(detection => `${detection.label} (${Math.round(detection.score * 100)}%): ${detection.threatReason}`)
      .join('; ');
  },
};
