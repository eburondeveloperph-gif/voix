import {
  DriveFileSummary,
  driveDownloadFileBlob,
  driveEnsureFolder,
  driveExportFileBlob,
  driveListFilesInFolder,
  driveUploadFile,
} from '@/lib/google-services';
import { DocumentAIService } from './document-ai-service';
import { extractFileText } from './file-text-extractor';
import { MemoryService } from './memory-service';
import type {
  DocumentSourceType,
  OCRExtraction,
  ScannedDocumentRecord,
  SupportedDocumentLanguage,
} from './types';
import {
  createId,
  detectLanguageHeuristically,
  getEffectiveUserId,
  normalizeWhitespace,
  nowIso,
} from './utils';

export const DRIVE_KNOWLEDGE_FOLDER_NAME = 'Beatrice Knowledge Base';

interface SaveTextToMemoryInput {
  title: string;
  text: string;
  userRequest?: string;
  source?: DocumentSourceType;
  sourceName?: string;
  driveFile?: DriveFileSummary;
  documentId?: string;
  memoryId?: string;
  extraMetadata?: Record<string, unknown>;
}

const GOOGLE_NATIVE_EXPORTS: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': {
    mimeType: 'text/plain',
    extension: 'txt',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'text/csv',
    extension: 'csv',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'text/plain',
    extension: 'txt',
  },
};

const isFolder = (file: DriveFileSummary) =>
  file.mimeType === 'application/vnd.google-apps.folder';

const extensionForMime = (mimeType: string) => {
  if (mimeType.includes('wordprocessingml')) return 'docx';
  if (mimeType.includes('spreadsheetml')) return 'xlsx';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'txt';
  return 'bin';
};

const fileFromBlob = (blob: Blob, name: string, mimeType: string) =>
  new File([blob], name, { type: mimeType || blob.type || 'application/octet-stream' });

const toOcrExtraction = (text: string): OCRExtraction => {
  const cleaned = normalizeWhitespace(text);
  return {
    raw_text: text,
    cleaned_text: cleaned,
    detected_language: detectLanguageHeuristically(cleaned) as SupportedDocumentLanguage,
    confidence: cleaned ? 0.98 : 0,
    page_count: Math.max(1, (cleaned.match(/--- (Page|Sheet):?/g) || []).length),
  };
};

const stableDriveDocumentId = (fileId: string) =>
  `drive_${fileId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

export const DriveKnowledgeService = {
  async ensureKnowledgeFolder() {
    return driveEnsureFolder(DRIVE_KNOWLEDGE_FOLDER_NAME);
  },

  async uploadSourceFileToKnowledge(file: File) {
    const folder = await this.ensureKnowledgeFolder();
    if (!folder.success || !folder.folder) {
      return {
        success: false,
        message: folder.message || 'Could not prepare the Drive knowledge folder.',
      };
    }

    const uploaded = await driveUploadFile(file, {
      folderId: folder.folder.id,
      appProperties: {
        ownerUserId: getEffectiveUserId(),
        source: 'beatrice_upload',
      },
    });

    return uploaded.success && uploaded.file
      ? {
          success: true,
          message: `Uploaded "${uploaded.file.name}" to ${DRIVE_KNOWLEDGE_FOLDER_NAME}.`,
          file: uploaded.file,
          folder: folder.folder,
        }
      : {
          success: false,
          message: uploaded.message || 'Drive upload failed.',
          folder: folder.folder,
        };
  },

  async saveTextToMemory(input: SaveTextToMemoryInput) {
    const cleaned = normalizeWhitespace(input.text);
    if (!cleaned) {
      return {
        success: false,
        message: 'No readable text was found for memory ingestion.',
      };
    }

    const ocr = toOcrExtraction(cleaned);
    const analysis = await DocumentAIService.analyzeDocument({
      ocr,
      userRequest:
        input.userRequest ||
        `Use this uploaded document as Beatrice knowledge base data: ${input.title}`,
    });
    const createdAt = nowIso();
    const ownerUserId = getEffectiveUserId();
    const documentId =
      input.documentId ||
      (input.driveFile?.id ? stableDriveDocumentId(input.driveFile.id) : createId('doc'));
    const memoryId = input.memoryId || `memory_${documentId}`;

    const document: ScannedDocumentRecord = {
      document_id: documentId,
      owner_user_id: ownerUserId,
      source: input.source || 'file_upload',
      created_at: createdAt,
      updated_at: createdAt,
      title: analysis.suggested_title || input.title,
      scan_label: input.userRequest || 'Knowledge base document import',
      source_name: input.sourceName || input.title,
      image_metadata: {
        source: 'drive_knowledge',
        source_name: input.sourceName || input.title,
        drive_file_id: input.driveFile?.id,
        drive_file_name: input.driveFile?.name,
        drive_mime_type: input.driveFile?.mimeType,
        drive_modified_time: input.driveFile?.modifiedTime,
        drive_web_view_link: input.driveFile?.webViewLink,
        ...(input.extraMetadata || {}),
      },
      ocr,
      analysis,
      memory: {
        saved_to_short_memory: false,
        saved_to_long_memory: true,
        memory_id: memoryId,
        suggested_title: analysis.suggested_title || input.title,
        suggested_tags: analysis.suggested_tags,
      },
      ui: {
        suggested_followups: analysis.suggested_followup_questions,
      },
      related_document_ids: [],
      raw_image_data_url: null,
    };

    const saved = await MemoryService.saveLongMemory(document);
    return {
      success: true,
      message: `Saved "${saved.title}" to Beatrice long-term knowledge.`,
      document: saved,
    };
  },

  async ingestUploadedFile(file: File, options: { userRequest?: string } = {}) {
    const upload = await this.uploadSourceFileToKnowledge(file);
    const extracted = await extractFileText(file);

    if (!extracted.text) {
      return {
        success: upload.success,
        message: upload.success
          ? `${upload.message} No readable text was extracted for memory.`
          : upload.message,
        driveFile: upload.file,
        memorySaved: false,
      };
    }

    const memory = await this.saveTextToMemory({
      title: file.name,
      text: extracted.text,
      userRequest: options.userRequest,
      sourceName: file.name,
      driveFile: upload.file,
      extraMetadata: {
        file_kind: extracted.kind,
        raw_char_count: extracted.rawCharCount,
        truncated: extracted.truncated,
      },
    });

    return {
      success: upload.success || memory.success,
      message: [upload.message, memory.message].filter(Boolean).join(' '),
      driveFile: upload.file,
      memorySaved: memory.success,
      document: memory.document,
    };
  },

  async downloadReadableDriveFile(file: DriveFileSummary) {
    if (isFolder(file)) {
      return null;
    }

    const nativeExport = GOOGLE_NATIVE_EXPORTS[file.mimeType];
    const blobResult = nativeExport
      ? await driveExportFileBlob(file.id, nativeExport.mimeType)
      : await driveDownloadFileBlob(file.id);

    if (!blobResult.success || !blobResult.blob) {
      return null;
    }

    const mimeType = nativeExport?.mimeType || file.mimeType || blobResult.blob.type;
    const extension = nativeExport?.extension || extensionForMime(mimeType);
    const name = /\.[a-z0-9]+$/i.test(file.name) ? file.name : `${file.name}.${extension}`;
    return fileFromBlob(blobResult.blob, name, mimeType);
  },

  async syncDriveKnowledgeToMemory(options: { limit?: number; force?: boolean } = {}) {
    const folder = await this.ensureKnowledgeFolder();
    if (!folder.success || !folder.folder) {
      return {
        success: false,
        message: folder.message || 'Could not access the Drive knowledge folder.',
        imported: 0,
        skipped: 0,
      };
    }

    const list = await driveListFilesInFolder(folder.folder.id, options.limit || 50);
    if (!list.success) {
      return {
        success: false,
        message: list.message || 'Could not list Drive knowledge files.',
        imported: 0,
        skipped: 0,
      };
    }

    const userId = getEffectiveUserId();
    const existingDocs = MemoryService.getPersistedState(userId).documents;
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const driveFile of list.files) {
      if (isFolder(driveFile)) {
        skipped += 1;
        continue;
      }

      const existing = existingDocs.find(
        document => document.image_metadata?.drive_file_id === driveFile.id,
      );
      if (
        existing &&
        !options.force &&
        existing.image_metadata?.drive_modified_time === driveFile.modifiedTime
      ) {
        skipped += 1;
        continue;
      }

      const readableFile = await this.downloadReadableDriveFile(driveFile);
      if (!readableFile) {
        skipped += 1;
        errors.push(`${driveFile.name}: not downloadable or exportable`);
        continue;
      }

      const extracted = await extractFileText(readableFile);
      if (!extracted.text) {
        skipped += 1;
        errors.push(`${driveFile.name}: no readable text`);
        continue;
      }

      const saved = await this.saveTextToMemory({
        title: driveFile.name,
        text: extracted.text,
        sourceName: driveFile.name,
        driveFile,
        documentId: stableDriveDocumentId(driveFile.id),
        memoryId: `memory_${stableDriveDocumentId(driveFile.id)}`,
        extraMetadata: {
          file_kind: extracted.kind,
          raw_char_count: extracted.rawCharCount,
          synced_from_drive: true,
        },
      });

      if (saved.success) {
        imported += 1;
      } else {
        skipped += 1;
        errors.push(`${driveFile.name}: ${saved.message}`);
      }
    }

    return {
      success: true,
      message: `Drive knowledge sync completed. Imported ${imported}, skipped ${skipped}.`,
      imported,
      skipped,
      errors,
      folder: folder.folder,
      files: list.files,
    };
  },
};
