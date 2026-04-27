import {
  collection,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isFirestoreRemoteEnabled } from '@/lib/firebase';
import { safeDeleteDoc, safeGetDocs, safeSetDoc } from '@/lib/firestore-safe';
import { DEFAULT_SCAN_MEMORY_SETTINGS } from './constants';
import {
  DocumentChunkRecord,
  LongMemoryRecord,
  MemorySearchResult,
  ScanEventRecord,
  ScanMemorySettings,
  ScannedDocumentRecord,
  ShortMemoryRecord,
} from './types';
import {
  buildTextChunks,
  cosineSimilarity,
  createId,
  getEffectiveUserId,
  getSessionId,
  nowIso,
  retentionToExpiry,
  safeJsonParse,
} from './utils';
import { DocumentAIService } from './document-ai-service';

interface PersistedDocumentState {
  documents: ScannedDocumentRecord[];
  chunks: DocumentChunkRecord[];
  memories: LongMemoryRecord[];
  shortMemories: ShortMemoryRecord[];
  scanEvents: ScanEventRecord[];
  settings: ScanMemorySettings;
}

const STORAGE_VERSION = 1;

const getStorageKey = (userId: string) => `beatrice_document_memory_v${STORAGE_VERSION}_${userId}`;

const readState = (userId: string): PersistedDocumentState =>
  safeJsonParse<PersistedDocumentState>(typeof window !== 'undefined' ? window.localStorage.getItem(getStorageKey(userId)) : null, {
    documents: [],
    chunks: [],
    memories: [],
    shortMemories: [],
    scanEvents: [],
    settings: DEFAULT_SCAN_MEMORY_SETTINGS,
  });

const writeState = (userId: string, state: PersistedDocumentState) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getStorageKey(userId), JSON.stringify(state));
};

const persistRemote = async (collectionName: string, id: string, payload: Record<string, unknown>) => {
  await safeSetDoc(db, collectionName, id, payload);
};

const removeRemote = async (collectionName: string, id: string) => {
  await safeDeleteDoc(db, collectionName, id);
};

export const MemoryService = {
  getSettings(userId = getEffectiveUserId()) {
    return readState(userId).settings;
  },

  updateSettings(settings: Partial<ScanMemorySettings>, userId = getEffectiveUserId()) {
    const state = readState(userId);
    const next = {
      ...state,
      settings: {
        ...state.settings,
        ...settings,
      },
    };
    writeState(userId, next);
    return next.settings;
  },

  getPersistedState(userId = getEffectiveUserId()) {
    const state = readState(userId);
    const now = Date.now();
    const cleanedShort = state.shortMemories.filter(item => new Date(item.expires_at).getTime() > now);
    if (cleanedShort.length !== state.shortMemories.length) {
      writeState(userId, { ...state, shortMemories: cleanedShort });
      return { ...state, shortMemories: cleanedShort };
    }
    return state;
  },

  async saveShortMemory(payload: {
    document: ScannedDocumentRecord;
    userQuestion: string;
  }) {
    const userId = payload.document.owner_user_id || getEffectiveUserId();
    const state = this.getPersistedState(userId);
    const settings = this.getSettings(userId);
    const createdAt = nowIso();
    const record: ShortMemoryRecord = {
      id: createId('short_memory'),
      memory_type: 'short',
      session_id: getSessionId(),
      document_id: payload.document.document_id,
      created_at: createdAt,
      source: payload.document.source,
      raw_ocr_text: settings.saveRawOcrText ? payload.document.ocr.raw_text : '',
      cleaned_text: payload.document.ocr.cleaned_text,
      detected_language: payload.document.ocr.detected_language,
      document_type: payload.document.analysis.document_type,
      short_summary: payload.document.analysis.short_summary,
      detailed_summary: payload.document.analysis.detailed_summary,
      key_points: payload.document.analysis.key_points,
      entities: payload.document.analysis.important_entities,
      action_items: payload.document.analysis.action_items,
      user_question: payload.userQuestion,
      last_used_at: createdAt,
      expires_at: retentionToExpiry(createdAt, this.getSettings(userId).memoryRetention),
    };

    writeState(userId, {
      ...state,
      shortMemories: [record, ...state.shortMemories.filter(item => item.document_id !== record.document_id)].slice(0, 20),
    });

    return record;
  },

  async saveLongMemory(document: ScannedDocumentRecord) {
    const userId = document.owner_user_id || getEffectiveUserId();
    const state = this.getPersistedState(userId);
    const settings = this.getSettings(userId);
    const createdAt = nowIso();
    const updatedDocument: ScannedDocumentRecord = {
      ...document,
      owner_user_id: userId,
      updated_at: createdAt,
      raw_image_data_url: settings.saveOriginalImage && !settings.privateScanMode ? document.raw_image_data_url : null,
      memory: {
        ...document.memory,
        saved_to_long_memory: true,
        memory_id: document.memory.memory_id || createId('memory'),
      },
    };

    const chunks = await buildTextChunks(
      updatedDocument.document_id,
      updatedDocument.ocr.cleaned_text,
      updatedDocument.ocr.page_count,
      userId,
    );

    for (const chunk of chunks) {
      chunk.embedding_vector = await DocumentAIService.embedText(chunk.chunk_text);
    }

    if (!updatedDocument.embedding_vector?.length) {
      updatedDocument.embedding_vector = await DocumentAIService.embedText(
        `${updatedDocument.title}\n${updatedDocument.analysis.short_summary}\n${updatedDocument.ocr.cleaned_text.slice(0, 6000)}`,
      );
    }

    const memoryRecord: LongMemoryRecord = {
      id: updatedDocument.memory.memory_id!,
      memory_type: 'long',
      owner_user_id: userId,
      document_id: updatedDocument.document_id,
      title: updatedDocument.title,
      created_at: createdAt,
      updated_at: createdAt,
      source: updatedDocument.source,
      detected_language: updatedDocument.ocr.detected_language,
      document_type: updatedDocument.analysis.document_type,
      raw_ocr_text: settings.saveRawOcrText ? updatedDocument.ocr.raw_text : '',
      cleaned_text: updatedDocument.ocr.cleaned_text,
      short_summary: updatedDocument.analysis.short_summary,
      detailed_summary: updatedDocument.analysis.detailed_summary,
      key_points: updatedDocument.analysis.key_points,
      entities: updatedDocument.analysis.important_entities,
      action_items: updatedDocument.analysis.action_items,
      tags: updatedDocument.analysis.suggested_tags,
      embedding_id: updatedDocument.document_id,
      visibility: 'private',
      memory_importance: updatedDocument.analysis.importance,
      retention_policy: settings.privateScanMode ? 'manual_delete' : 'permanent',
      related_conversation_ids: [getSessionId()],
      related_document_ids: updatedDocument.related_document_ids,
    };

    const scanEvent: ScanEventRecord = {
      id: createId('scan_event'),
      user_id: userId,
      document_id: updatedDocument.document_id,
      scan_source: updatedDocument.source,
      ocr_confidence: updatedDocument.ocr.confidence,
      image_metadata: updatedDocument.image_metadata,
      created_at: createdAt,
    };

    const next: PersistedDocumentState = {
      ...state,
      documents: [
        updatedDocument,
        ...state.documents.filter(item => item.document_id !== updatedDocument.document_id),
      ],
      chunks: [
        ...chunks,
        ...state.chunks.filter(item => item.document_id !== updatedDocument.document_id),
      ],
      memories: [
        memoryRecord,
        ...state.memories.filter(item => item.document_id !== updatedDocument.document_id),
      ],
      scanEvents: [scanEvent, ...state.scanEvents.filter(item => item.document_id !== updatedDocument.document_id)],
    };

    writeState(userId, next);

    await Promise.all([
      persistRemote('documents', updatedDocument.document_id, updatedDocument as unknown as Record<string, unknown>),
      persistRemote('memories', memoryRecord.id, memoryRecord as unknown as Record<string, unknown>),
      persistRemote('scan_events', scanEvent.id, scanEvent as unknown as Record<string, unknown>),
      ...chunks.map(chunk =>
        persistRemote('document_chunks', chunk.id, chunk as unknown as Record<string, unknown>),
      ),
    ]);

    return updatedDocument;
  },

  getActiveDocument(documentId: string | null, userId = getEffectiveUserId()) {
    if (!documentId) return null;
    return this.getPersistedState(userId).documents.find(item => item.document_id === documentId) || null;
  },

  getRecentDocuments(userId = getEffectiveUserId()) {
    return this.getPersistedState(userId).documents.slice(0, 8);
  },

  async searchMemory(queryText: string, options?: { limit?: number; includeShort?: boolean }) {
    const userId = getEffectiveUserId();
    const state = this.getPersistedState(userId);
    const limit = options?.limit || 5;
    const queryVector = await DocumentAIService.embedText(queryText);

    const ranked = state.documents
      .map(document => {
        const score = cosineSimilarity(queryVector, document.embedding_vector || []);
        const chunks = state.chunks
          .filter(chunk => chunk.document_id === document.document_id)
          .map(chunk => ({
            chunk,
            score: cosineSimilarity(queryVector, chunk.embedding_vector || []),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        return {
          score: Math.max(score, chunks[0]?.score || 0),
          document,
          chunks: chunks.map(item => item.chunk),
          memory: state.memories.find(memory => memory.document_id === document.document_id),
        } satisfies MemorySearchResult;
      })
      .filter(item => item.score > 0.08 || queryText.toLowerCase().includes(item.document.title.toLowerCase()))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return ranked;
  },

  async deleteMemory(memoryId: string) {
    const userId = getEffectiveUserId();
    const state = this.getPersistedState(userId);
    const memory = state.memories.find(item => item.id === memoryId);
    const documentId = memory?.document_id;

    const next: PersistedDocumentState = {
      ...state,
      memories: state.memories.filter(item => item.id !== memoryId),
      documents: state.documents.filter(item => item.document_id !== documentId),
      chunks: state.chunks.filter(item => item.document_id !== documentId),
      shortMemories: state.shortMemories.filter(item => item.document_id !== documentId),
      scanEvents: state.scanEvents.filter(item => item.document_id !== documentId),
    };

    writeState(userId, next);

    await Promise.all([
      removeRemote('memories', memoryId),
      ...(documentId ? [removeRemote('documents', documentId)] : []),
    ]);
  },

  async updateMemory(memoryId: string, payload: Partial<LongMemoryRecord>) {
    const userId = getEffectiveUserId();
    const state = this.getPersistedState(userId);
    const updated = state.memories.map(memory =>
      memory.id === memoryId
        ? {
            ...memory,
            ...payload,
            updated_at: nowIso(),
          }
        : memory,
    );

    writeState(userId, {
      ...state,
      memories: updated,
    });

    const next = updated.find(item => item.id === memoryId);
    if (next) {
      await persistRemote('memories', memoryId, next as unknown as Record<string, unknown>);
    }
  },

  async syncRemoteIntoLocal() {
    const userId = getEffectiveUserId();
    if (!isFirestoreRemoteEnabled()) return;

    try {
      const [documentsSnapshot, memoriesSnapshot, chunksSnapshot, scanEventsSnapshot] = await Promise.all([
        safeGetDocs(query(collection(db, 'documents'), where('owner_user_id', '==', userId))),
        safeGetDocs(query(collection(db, 'memories'), where('owner_user_id', '==', userId))),
        safeGetDocs(query(collection(db, 'document_chunks'), where('owner_user_id', '==', userId))),
        safeGetDocs(query(collection(db, 'scan_events'), where('user_id', '==', userId))),
      ]);

      if (!documentsSnapshot || !memoriesSnapshot || !chunksSnapshot || !scanEventsSnapshot) {
        return;
      }

      const remoteDocuments = documentsSnapshot.docs.map(item => item.data() as ScannedDocumentRecord);
      const remoteMemories = memoriesSnapshot.docs.map(item => item.data() as LongMemoryRecord);
      const remoteChunks = chunksSnapshot.docs.map(item => item.data() as DocumentChunkRecord);
      const remoteScanEvents = scanEventsSnapshot.docs.map(item => item.data() as ScanEventRecord);

      if (
        remoteDocuments.length === 0 &&
        remoteMemories.length === 0 &&
        remoteChunks.length === 0 &&
        remoteScanEvents.length === 0
      ) {
        return;
      }

      const state = this.getPersistedState(userId);
      writeState(userId, {
        ...state,
        documents: [
          ...remoteDocuments,
          ...state.documents.filter(
            local => !remoteDocuments.some(remote => remote.document_id === local.document_id),
          ),
        ],
        memories: [
          ...remoteMemories,
          ...state.memories.filter(
            local => !remoteMemories.some(remote => remote.id === local.id),
          ),
        ],
        chunks: [
          ...remoteChunks,
          ...state.chunks.filter(
            local => !remoteChunks.some(remote => remote.id === local.id),
          ),
        ],
        scanEvents: [
          ...remoteScanEvents,
          ...state.scanEvents.filter(
            local => !remoteScanEvents.some(remote => remote.id === local.id),
          ),
        ],
      });
    } catch (error) {
      console.warn('Remote document sync skipped:', error);
    }
  },
};
