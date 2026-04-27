import {
  PERMANENT_KNOWLEDGE_DOCUMENTS,
  PERMANENT_KNOWLEDGE_VERSION,
} from './permanent-knowledge-data';
import { DriveKnowledgeService } from './drive-knowledge-service';
import { MemoryService } from './memory-service';
import { getEffectiveUserId } from './utils';

const markerKey = (userId: string) =>
  `beatrice_permanent_files_knowledge_${PERMANENT_KNOWLEDGE_VERSION}_${userId}`;

const canUseStorage = () => typeof window !== 'undefined' && !!window.localStorage;

export const PermanentKnowledgeService = {
  async syncFilesKnowledgeToMemory(options: { force?: boolean } = {}) {
    const userId = getEffectiveUserId();
    const marker = canUseStorage() ? window.localStorage.getItem(markerKey(userId)) : null;
    const state = MemoryService.getPersistedState(userId);
    const hasAllStaticDocs = PERMANENT_KNOWLEDGE_DOCUMENTS.every(doc =>
      state.documents.some(item => item.document_id === doc.id),
    );

    if (!options.force && marker === 'done' && hasAllStaticDocs) {
      return {
        success: true,
        imported: 0,
        skipped: PERMANENT_KNOWLEDGE_DOCUMENTS.length,
        message: 'Permanent /files knowledge is already loaded.',
      };
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const document of PERMANENT_KNOWLEDGE_DOCUMENTS) {
      const existing = state.documents.find(item => item.document_id === document.id);
      if (existing && !options.force) {
        skipped += 1;
        continue;
      }

      const saved = await DriveKnowledgeService.saveTextToMemory({
        title: document.title,
        text: document.text,
        sourceName: document.sourcePath,
        documentId: document.id,
        memoryId: `memory_${document.id}`,
        userRequest: 'Permanent Beatrice knowledge from repository /files.',
        extraMetadata: {
          permanent_knowledge: true,
          permanent_knowledge_version: PERMANENT_KNOWLEDGE_VERSION,
          source_path: document.sourcePath,
          mime_type: document.mimeType,
        },
      });

      if (saved.success) {
        imported += 1;
      } else {
        skipped += 1;
        errors.push(`${document.title}: ${saved.message}`);
      }
    }

    if (canUseStorage() && errors.length === 0) {
      window.localStorage.setItem(markerKey(userId), 'done');
    }

    return {
      success: errors.length === 0,
      imported,
      skipped,
      errors,
      message: `Permanent /files knowledge sync completed. Imported ${imported}, skipped ${skipped}.`,
    };
  },
};
