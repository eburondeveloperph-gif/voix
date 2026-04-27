import {
  CropBounds,
  DocumentSourceType,
  ScanImageAsset,
} from './types';
import { extractFileText, getKnowledgeFileKind } from './file-text-extractor';
import { clamp, createId, cropBoundsToPixels } from './utils';

const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image for scanning.'));
    image.src = source;
  });

const canvasToDataUrl = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/jpeg', 0.92);

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read uploaded file.'));
    reader.readAsDataURL(file);
  });

const renderTextPreviewPage = (file: File, text: string): ScanImageAsset => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 1600;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create document preview.');
  }

  context.fillStyle = '#f8fafc';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111827';
  context.font = '600 46px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText(file.name || 'Uploaded document', 72, 110);
  context.fillStyle = '#64748b';
  context.font = '28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText('Readable file imported directly into Beatrice knowledge.', 72, 158);

  context.fillStyle = '#1f2937';
  context.font = '28px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  const words = text.slice(0, 4200).split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const next = currentLine ? `${currentLine} ${word}` : word;
    if (context.measureText(next).width > canvas.width - 144) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = next;
    }
    if (lines.length >= 42) break;
  }
  if (currentLine && lines.length < 42) lines.push(currentLine);
  lines.forEach((line, index) => context.fillText(line, 72, 230 + index * 34));

  return {
    id: createId('file_text'),
    dataUrl: canvasToDataUrl(canvas),
    width: canvas.width,
    height: canvas.height,
    metadata: {
      source_name: file.name,
      file_type: file.type,
      extracted_text: text,
      text_extraction_mode: 'direct_file_parser',
    },
  };
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

let pdfJsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

const loadPdfJs = async () => {
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

const detectDocumentBounds = (canvas: HTMLCanvasElement): CropBounds => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return { left: 0.04, top: 0.04, width: 0.92, height: 0.92 };
  }

  const { width, height } = canvas;
  const sample = context.getImageData(0, 0, width, height);
  const luminanceAt = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    const r = sample.data[index];
    const g = sample.data[index + 1];
    const b = sample.data[index + 2];
    return r * 0.299 + g * 0.587 + b * 0.114;
  };

  const borderSamples: number[] = [];
  for (let x = 0; x < width; x += Math.max(1, Math.round(width / 40))) {
    borderSamples.push(luminanceAt(x, 0));
    borderSamples.push(luminanceAt(x, height - 1));
  }
  for (let y = 0; y < height; y += Math.max(1, Math.round(height / 40))) {
    borderSamples.push(luminanceAt(0, y));
    borderSamples.push(luminanceAt(width - 1, y));
  }

  const borderAverage = average(borderSamples);
  const threshold = Math.max(18, Math.min(52, borderAverage > 160 ? 26 : 38));
  const columnStep = Math.max(1, Math.round(width / 48));
  const rowStep = Math.max(1, Math.round(height / 48));

  let top = 0;
  for (let y = 0; y < height; y += rowStep) {
    const row: number[] = [];
    for (let x = 0; x < width; x += columnStep) {
      row.push(luminanceAt(x, y));
    }
    if (Math.abs(average(row) - borderAverage) > threshold) {
      top = y;
      break;
    }
  }

  let bottom = height;
  for (let y = height - 1; y >= 0; y -= rowStep) {
    const row: number[] = [];
    for (let x = 0; x < width; x += columnStep) {
      row.push(luminanceAt(x, y));
    }
    if (Math.abs(average(row) - borderAverage) > threshold) {
      bottom = y;
      break;
    }
  }

  let left = 0;
  for (let x = 0; x < width; x += columnStep) {
    const column: number[] = [];
    for (let y = 0; y < height; y += rowStep) {
      column.push(luminanceAt(x, y));
    }
    if (Math.abs(average(column) - borderAverage) > threshold) {
      left = x;
      break;
    }
  }

  let right = width;
  for (let x = width - 1; x >= 0; x -= columnStep) {
    const column: number[] = [];
    for (let y = 0; y < height; y += rowStep) {
      column.push(luminanceAt(x, y));
    }
    if (Math.abs(average(column) - borderAverage) > threshold) {
      right = x;
      break;
    }
  }

  const safeLeft = clamp(left / width, 0, 0.9);
  const safeTop = clamp(top / height, 0, 0.9);
  const safeWidth = clamp((right - left) / width, 0.2, 1);
  const safeHeight = clamp((bottom - top) / height, 0.2, 1);

  return {
    left: safeLeft,
    top: safeTop,
    width: safeWidth,
    height: safeHeight,
  };
};

const sharpenImage = (
  source: ImageData,
  target: ImageData,
  width: number,
  height: number,
) => {
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0;
        let kernelIndex = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          for (let kx = -1; kx <= 1; kx += 1) {
            const index = ((y + ky) * width + (x + kx)) * 4 + channel;
            value += source.data[index] * kernel[kernelIndex];
            kernelIndex += 1;
          }
        }
        const outIndex = (y * width + x) * 4 + channel;
        target.data[outIndex] = clamp(Math.round(value), 0, 255);
      }
      target.data[(y * width + x) * 4 + 3] = 255;
    }
  }
};

export const ScannerService = {
  async openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is not available in this browser.');
    }

    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  },

  async toggleTorch(stream: MediaStream, enabled: boolean) {
    const [track] = stream.getVideoTracks();
    if (!track) return false;
    const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
    if (!capabilities?.torch) return false;
    await track.applyConstraints({
      advanced: [{ torch: enabled } as unknown as MediaTrackConstraintSet],
    });
    return true;
  },

  async captureImage(video: HTMLVideoElement, source: DocumentSourceType = 'camera_scan'): Promise<ScanImageAsset> {
    const canvas = document.createElement('canvas');
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not create camera capture context.');
    }
    context.drawImage(video, 0, 0, width, height);
    return {
      id: createId('scan'),
      dataUrl: canvasToDataUrl(canvas),
      width,
      height,
      metadata: {
        source,
        captured_at: new Date().toISOString(),
      },
    };
  },

  async uploadFromGallery(file: File): Promise<{ source: DocumentSourceType; pages: ScanImageAsset[] }> {
    const lowerName = file.name.toLowerCase();
    if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
      const pdfjsLib = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages: ScanImageAsset[] = [];
      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = await pdf.getPage(index);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) continue;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        pages.push({
          id: createId('pdf_page'),
          dataUrl: canvasToDataUrl(canvas),
          width: canvas.width,
          height: canvas.height,
          metadata: {
            page_number: index,
            source_name: file.name,
          },
        });
      }
      return {
        source: 'file_upload',
        pages,
      };
    }

    const fileKind = getKnowledgeFileKind(file);
    if (fileKind !== 'image' && fileKind !== 'binary') {
      const extracted = await extractFileText(file, { maxChars: 50000 });
      if (extracted.text) {
        return {
          source: 'file_upload',
          pages: [renderTextPreviewPage(file, extracted.text)],
        };
      }
    }

    const dataUrl = await fileToDataUrl(file);
    const image = await loadImage(dataUrl);
    return {
      source: file.type.startsWith('image/') ? 'gallery_upload' : 'file_upload',
      pages: [
        {
          id: createId('upload'),
          dataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
          metadata: {
            source_name: file.name,
            file_type: file.type,
          },
        },
      ],
    };
  },

  async autoDetectCrop(imageDataUrl: string) {
    const image = await loadImage(imageDataUrl);
    const canvas = document.createElement('canvas');
    const maxWidth = 1400;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      return { left: 0.05, top: 0.05, width: 0.9, height: 0.9 };
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return detectDocumentBounds(canvas);
  },

  async cropImage(imageDataUrl: string, bounds: CropBounds): Promise<ScanImageAsset> {
    const image = await loadImage(imageDataUrl);
    const { x, y, width, height } = cropBoundsToPixels(bounds, image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not crop the scanned image.');
    }
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    return {
      id: createId('crop'),
      dataUrl: canvasToDataUrl(canvas),
      width,
      height,
      metadata: {
        crop_bounds: bounds,
      },
    };
  },

  async preprocessImage(imageDataUrl: string) {
    const image = await loadImage(imageDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Could not preprocess the scanned image.');
    }

    context.drawImage(image, 0, 0);
    const source = context.getImageData(0, 0, canvas.width, canvas.height);
    const working = new ImageData(canvas.width, canvas.height);

    for (let index = 0; index < source.data.length; index += 4) {
      const r = source.data[index];
      const g = source.data[index + 1];
      const b = source.data[index + 2];
      let luminance = r * 0.299 + g * 0.587 + b * 0.114;
      luminance = clamp((luminance - 127) * 1.18 + 127 + 10, 0, 255);
      working.data[index] = luminance;
      working.data[index + 1] = luminance;
      working.data[index + 2] = luminance;
      working.data[index + 3] = 255;
    }

    const sharpened = new ImageData(canvas.width, canvas.height);
    sharpenImage(working, sharpened, canvas.width, canvas.height);
    context.putImageData(sharpened, 0, 0);

    return {
      dataUrl: canvasToDataUrl(canvas),
      metadata: {
        preprocessing: ['grayscale', 'contrast_boost', 'noise_reduction', 'sharpen'],
        width: canvas.width,
        height: canvas.height,
      },
    };
  },

  async confirmScan<T>(payload: T) {
    return payload;
  },
};
