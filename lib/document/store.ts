import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SCAN_MEMORY_SETTINGS } from './constants';
import {
  CropBounds,
  ScanMemorySettings,
  ScanSessionRequest,
  ScannedDocumentRecord,
  ScannerStage,
  ScanImageAsset,
} from './types';

export const useDocumentSettingsStore = create<{
  settings: ScanMemorySettings;
  updateSettings: (next: Partial<ScanMemorySettings>) => void;
}>()(
  persist(
    set => ({
      settings: DEFAULT_SCAN_MEMORY_SETTINGS,
      updateSettings: next =>
        set(state => ({
          settings: {
            ...state.settings,
            ...next,
          },
        })),
    }),
    {
      name: 'beatrice-document-settings',
    },
  ),
);

export const useDocumentVisionStore = create<{
  isScannerOpen: boolean;
  stage: ScannerStage;
  request: ScanSessionRequest | null;
  source: 'camera_scan' | 'gallery_upload' | 'file_upload' | 'screenshot';
  draftPages: ScanImageAsset[];
  selectedPageIndex: number;
  cropBounds: CropBounds;
  currentDocument: ScannedDocumentRecord | null;
  activeDocumentId: string | null;
  processingMessage: string | null;
  ocrProgress: number;
  error: string | null;
  openScanner: (request?: ScanSessionRequest | null) => void;
  closeScanner: () => void;
  setStage: (stage: ScannerStage) => void;
  setDraftPages: (pages: ScanImageAsset[], source: 'camera_scan' | 'gallery_upload' | 'file_upload' | 'screenshot') => void;
  setSelectedPageIndex: (index: number) => void;
  setCropBounds: (bounds: CropBounds) => void;
  setProcessingState: (message: string, progress?: number) => void;
  setScanResult: (document: ScannedDocumentRecord) => void;
  clearResult: () => void;
  setError: (error: string | null) => void;
}>((set) => ({
  isScannerOpen: false,
  stage: 'idle',
  request: null,
  source: 'camera_scan',
  draftPages: [],
  selectedPageIndex: 0,
  cropBounds: { left: 0.06, top: 0.06, width: 0.88, height: 0.88 },
  currentDocument: null,
  activeDocumentId: null,
  processingMessage: null,
  ocrProgress: 0,
  error: null,
  openScanner: request =>
    set({
      isScannerOpen: true,
      stage: 'capture',
      request: request || null,
      draftPages: [],
      selectedPageIndex: 0,
      processingMessage: null,
      ocrProgress: 0,
      error: null,
    }),
  closeScanner: () =>
    set({
      isScannerOpen: false,
      stage: 'idle',
      request: null,
      draftPages: [],
      selectedPageIndex: 0,
      processingMessage: null,
      ocrProgress: 0,
      error: null,
    }),
  setStage: stage => set({ stage }),
  setDraftPages: (draftPages, source) =>
    set({
      draftPages,
      source,
      selectedPageIndex: 0,
      stage: 'crop',
      error: null,
    }),
  setSelectedPageIndex: selectedPageIndex => set({ selectedPageIndex }),
  setCropBounds: cropBounds => set({ cropBounds }),
  setProcessingState: (processingMessage, ocrProgress = 0) =>
    set({
      stage: 'processing',
      processingMessage,
      ocrProgress,
      error: null,
    }),
  setScanResult: currentDocument =>
    set({
      currentDocument,
      activeDocumentId: currentDocument.document_id,
      stage: 'result',
      processingMessage: null,
      ocrProgress: 1,
      error: null,
    }),
  clearResult: () =>
    set({
      currentDocument: null,
      activeDocumentId: null,
    }),
  setError: error => set({ error }),
}));
