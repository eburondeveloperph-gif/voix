/**
 * Scan → Chat Bridge
 *
 * Decouples the document scanner (camera capture, image upload, file upload,
 * screenshot) from the chat composer in App.tsx. When OCR / vision work
 * finishes inside DocumentScannerModal, the modal pushes a `ScanChatPayload`
 * onto this store; App.tsx subscribes and calls sendChatMessage(...) so the
 * extracted text + preview lands in the chat thread and Beatrice answers in
 * realtime.
 *
 * The store always replaces the pending payload (no queue) — the latest scan
 * wins, which matches the user's mental model ("I just scanned X, talk about X").
 */

import { create } from 'zustand';

export type ScanChatSource =
  | 'camera_scan'
  | 'gallery_upload'
  | 'file_upload'
  | 'screenshot';

export interface ScanChatPayload {
  /** Stable id so consumers can de-duplicate. */
  id: string;
  /** What the user wants Beatrice to do with the scan, in their own words. */
  userRequest: string;
  /** OCR cleaned text — may be empty for images with no text. */
  extractedText: string;
  /** A short Beatrice-shaped summary (or empty if not generated yet). */
  summary: string;
  /** Title surfaced from the document analysis. */
  title: string;
  /** Source of the upload. */
  source: ScanChatSource;
  /** Original capture (data URL) for inline preview, if present. */
  imageDataUrl?: string | null;
  /** Detected language code, when known. */
  language?: string;
  /** Original filename if file upload. */
  filename?: string;
  /** MIME type, when known. */
  mimeType?: string;
  /** Pushed-at epoch ms. */
  pushedAt: number;
}

interface ScanChatBridgeState {
  pending: ScanChatPayload | null;
  push: (payload: Omit<ScanChatPayload, 'id' | 'pushedAt'>) => ScanChatPayload;
  consume: (id: string) => void;
  clear: () => void;
}

export const useScanChatBridge = create<ScanChatBridgeState>((set, get) => ({
  pending: null,
  push: payload => {
    const next: ScanChatPayload = {
      ...payload,
      id: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      pushedAt: Date.now(),
    };
    set({ pending: next });
    return next;
  },
  consume: id => {
    const { pending } = get();
    if (pending && pending.id === id) {
      set({ pending: null });
    }
  },
  clear: () => set({ pending: null }),
}));
