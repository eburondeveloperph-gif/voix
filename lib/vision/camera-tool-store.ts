import { create } from 'zustand';

export type VisionCameraToolMode = 'video' | 'photo';

interface VisionCameraToolState {
  requestId: number;
  mode: VisionCameraToolMode | null;
  sourceLabel: string;
  autoDetect: boolean;
  openVideoCamera: (options?: { sourceLabel?: string; autoDetect?: boolean }) => void;
  openPhotoCamera: (options?: { sourceLabel?: string; autoDetect?: boolean }) => void;
  clearRequest: () => void;
}

export const useVisionCameraToolStore = create<VisionCameraToolState>(set => ({
  requestId: 0,
  mode: null,
  sourceLabel: 'Beatrice camera',
  autoDetect: true,
  openVideoCamera: options =>
    set(state => ({
      requestId: state.requestId + 1,
      mode: 'video',
      sourceLabel: options?.sourceLabel || 'Beatrice video camera',
      autoDetect: options?.autoDetect ?? true,
    })),
  openPhotoCamera: options =>
    set(state => ({
      requestId: state.requestId + 1,
      mode: 'photo',
      sourceLabel: options?.sourceLabel || 'Phone camera photo',
      autoDetect: options?.autoDetect ?? true,
    })),
  clearRequest: () => set({ mode: null }),
}));
