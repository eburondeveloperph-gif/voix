export type SupportedDocumentLanguage =
  | 'en'
  | 'fr'
  | 'nl'
  | 'tl'
  | 'mixed'
  | 'unknown';

export type DocumentSourceType =
  | 'camera_scan'
  | 'gallery_upload'
  | 'file_upload'
  | 'screenshot';

export type DocumentType =
  | 'letter'
  | 'contract'
  | 'article'
  | 'receipt'
  | 'invoice'
  | 'id_document'
  | 'note'
  | 'email_screenshot'
  | 'instruction_manual'
  | 'business_document'
  | 'medical_document'
  | 'legal_document'
  | 'academic_text'
  | 'marketing_material'
  | 'book_page'
  | 'unknown';

export type MemoryImportance = 'low' | 'medium' | 'high';
export type MemoryVisibility = 'private' | 'shared' | 'organization';
export type RetentionPolicy = 'manual_delete' | 'auto_expire' | 'permanent';
export type ScannerStage = 'idle' | 'capture' | 'crop' | 'processing' | 'result';
export type OCRExecutionMode = 'auto' | 'local' | 'cloud';
export type MemoryRetention = 'session_only' | '30_days' | 'permanent';

export interface CropBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OCRExtraction {
  raw_text: string;
  cleaned_text: string;
  detected_language: SupportedDocumentLanguage;
  confidence: number;
  page_count: number;
}

export interface DocumentEntities {
  people: string[];
  companies: string[];
  dates: string[];
  places: string[];
  amounts: string[];
  emails: string[];
  phone_numbers: string[];
}

export interface DocumentAnalysis {
  document_type: DocumentType;
  short_summary: string;
  detailed_summary: string;
  key_points: string[];
  action_items: string[];
  entities: DocumentEntities;
  important_entities: string[];
  memory_payload: string;
  suggested_followup_questions: string[];
  suggested_title: string;
  suggested_tags: string[];
  importance: MemoryImportance;
}

export interface DocumentMemoryStatus {
  saved_to_short_memory: boolean;
  saved_to_long_memory: boolean;
  memory_id: string | null;
  suggested_title: string;
  suggested_tags: string[];
}

export interface DocumentUiPayload {
  suggested_followups: string[];
}

export interface ScanImageAsset {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  metadata: Record<string, unknown>;
}

export interface ScannedDocumentRecord {
  document_id: string;
  owner_user_id: string;
  source: DocumentSourceType;
  created_at: string;
  updated_at: string;
  title: string;
  scan_label: string;
  source_name?: string;
  image_metadata: Record<string, unknown>;
  ocr: OCRExtraction;
  analysis: DocumentAnalysis;
  memory: DocumentMemoryStatus;
  ui: DocumentUiPayload;
  embedding_vector?: number[];
  related_document_ids: string[];
  raw_image_data_url?: string | null;
}

export interface ScanSessionRequest {
  userRequest: string;
  requestedOutputLanguage?: SupportedDocumentLanguage | 'same_as_user';
  autoSaveLongMemory?: boolean;
  saveRequested?: boolean;
}

export interface DocumentChunkRecord {
  id: string;
  owner_user_id?: string;
  document_id: string;
  chunk_index: number;
  chunk_text: string;
  embedding_id: string;
  embedding_vector?: number[];
  metadata: Record<string, unknown>;
}

export interface ShortMemoryRecord {
  id: string;
  memory_type: 'short';
  session_id: string;
  document_id: string;
  created_at: string;
  source: DocumentSourceType;
  raw_ocr_text: string;
  cleaned_text: string;
  detected_language: SupportedDocumentLanguage;
  document_type: DocumentType;
  short_summary: string;
  detailed_summary: string;
  key_points: string[];
  entities: string[];
  action_items: string[];
  user_question: string;
  last_used_at: string;
  expires_at: string;
}

export interface LongMemoryRecord {
  id: string;
  memory_type: 'long';
  owner_user_id: string;
  document_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  source: DocumentSourceType;
  detected_language: SupportedDocumentLanguage;
  document_type: DocumentType;
  raw_ocr_text: string;
  cleaned_text: string;
  short_summary: string;
  detailed_summary: string;
  key_points: string[];
  entities: string[];
  action_items: string[];
  tags: string[];
  embedding_id: string;
  visibility: MemoryVisibility;
  memory_importance: MemoryImportance;
  retention_policy: RetentionPolicy;
  related_conversation_ids: string[];
  related_document_ids: string[];
}

export interface ScanEventRecord {
  id: string;
  user_id: string;
  document_id: string;
  scan_source: DocumentSourceType;
  ocr_confidence: number;
  image_metadata: Record<string, unknown>;
  created_at: string;
}

export interface ScanMemorySettings {
  autoSaveShortMemory: boolean;
  autoSaveImportantLongMemory: boolean;
  saveRawOcrText: boolean;
  saveOriginalImage: boolean;
  defaultScanLanguageBehavior: 'auto_detect';
  defaultSummaryLanguage: 'same_as_user' | SupportedDocumentLanguage;
  privateScanMode: boolean;
  ocrEngine: OCRExecutionMode;
  memoryRetention: MemoryRetention;
}

export interface MemorySearchResult {
  score: number;
  document: ScannedDocumentRecord;
  chunks: DocumentChunkRecord[];
  memory?: LongMemoryRecord;
}

export interface DocumentConversationContext {
  activeDocument: ScannedDocumentRecord | null;
  relatedDocuments: MemorySearchResult[];
  contextPrompt: string | null;
}

export interface DocumentAnswerResult {
  text: string;
  language: SupportedDocumentLanguage | 'same_as_user';
}
