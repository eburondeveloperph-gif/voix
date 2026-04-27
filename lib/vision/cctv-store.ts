import { create } from 'zustand';
import type { CctvMonitorConfig, VisionScanResult } from './types';

interface CctvVisionState {
  config: CctvMonitorConfig | null;
  lastResult: VisionScanResult | null;
  lastFrameDataUrl: string | null;
  error: string | null;
  openMonitor: (config: Partial<CctvMonitorConfig> & { streamUrl: string }) => void;
  closeMonitor: () => void;
  setLastFrame: (frameDataUrl: string | null) => void;
  setLastResult: (result: VisionScanResult | null) => void;
  setError: (error: string | null) => void;
}

export const useCctvVisionStore = create<CctvVisionState>(set => ({
  config: null,
  lastResult: null,
  lastFrameDataUrl: null,
  error: null,
  openMonitor: config =>
    set({
      config: {
        streamUrl: config.streamUrl,
        sourceLabel: config.sourceLabel || 'CCTV feed',
        intervalMs: config.intervalMs || 3000,
        enabled: config.enabled ?? true,
      },
      error: null,
    }),
  closeMonitor: () =>
    set({
      config: null,
      error: null,
    }),
  setLastFrame: lastFrameDataUrl => set({ lastFrameDataUrl }),
  setLastResult: lastResult => set({ lastResult }),
  setError: error => set({ error }),
}));
