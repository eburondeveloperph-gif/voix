/**
 * Document Agent — Handles document scanning, memory search/save/forget
 */
import { MemoryService } from '@/lib/document/memory-service';
import { useDocumentVisionStore } from '@/lib/document/store';
import type { AgentHandler, AgentResult } from './types';

export const handle: AgentHandler = async (toolName, args, _ctx): Promise<AgentResult> => {
  switch (toolName) {
    case 'document_scan_start': {
      useDocumentVisionStore.getState().openScanner({
        userRequest: typeof args.userRequest === 'string' ? args.userRequest : 'Beatrice, scan this document.',
        autoSaveLongMemory: Boolean(args.autoSaveLongMemory),
        saveRequested: Boolean(args.autoSaveLongMemory),
      });
      return { status: 'success', message: 'Media upload is now open. Waiting for the user to take a normal photo/video or upload a file.' };
    }

    case 'document_memory_search': {
      const results = await MemoryService.searchMemory(typeof args.query === 'string' ? args.query : '', { limit: 5 });
      return {
        status: 'success',
        message: results.length ? `Found ${results.length} relevant document memories.` : 'No relevant document memories were found.',
        data: results.map(item => ({
          document_id: item.document.document_id,
          title: item.document.title,
          short_summary: item.document.analysis.short_summary,
          language: item.document.ocr.detected_language,
          document_type: item.document.analysis.document_type,
          score: Number(item.score.toFixed(3)),
        })),
      };
    }

    case 'document_memory_save': {
      const activeDocumentId = useDocumentVisionStore.getState().activeDocumentId;
      const activeDocument = useDocumentVisionStore.getState().currentDocument || MemoryService.getActiveDocument(activeDocumentId);
      if (!activeDocument) {
        return { status: 'error', message: 'There is no active scanned document to save yet.' };
      }
      const updatedDocument = typeof args.title === 'string' ? { ...activeDocument, title: args.title } : activeDocument;
      const savedDocument = await MemoryService.saveLongMemory(updatedDocument);
      useDocumentVisionStore.getState().setScanResult(savedDocument);
      return { status: 'success', message: `Saved the current document to long memory as "${savedDocument.title}".`, data: { document_id: savedDocument.document_id } };
    }

    case 'document_memory_forget': {
      const activeDocumentId = useDocumentVisionStore.getState().activeDocumentId;
      const activeDocument = useDocumentVisionStore.getState().currentDocument || MemoryService.getActiveDocument(activeDocumentId);
      const memoryId = typeof args.memoryId === 'string' ? args.memoryId : activeDocument?.memory.memory_id;
      if (!memoryId) {
        return { status: 'error', message: 'I could not find a saved document memory to delete.' };
      }
      await MemoryService.deleteMemory(memoryId);
      return { status: 'success', message: 'The requested document memory has been deleted.' };
    }

    default:
      return { status: 'error', message: `Document agent does not support tool: ${toolName}` };
  }
};
