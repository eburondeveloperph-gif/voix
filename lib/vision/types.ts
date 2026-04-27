export interface VisionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionDetection {
  id: string;
  label: string;
  score: number;
  box: VisionBox;
  threat: boolean;
  threatReason?: string;
}

export interface VisionScanResult {
  id: string;
  sourceLabel: string;
  createdAt: string;
  width: number;
  height: number;
  detections: VisionDetection[];
  threatDetections: VisionDetection[];
  summary: string;
  annotatedDataUrl?: string;
}

export interface CctvMonitorConfig {
  streamUrl: string;
  sourceLabel: string;
  intervalMs: number;
  enabled: boolean;
}
