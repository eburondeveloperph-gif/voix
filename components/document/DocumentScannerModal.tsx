import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import c from 'classnames';
import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import { useLogStore, useUI } from '@/lib/state';
import { DocumentAIService } from '@/lib/document/document-ai-service';
import { BeatriceResponseService } from '@/lib/document/beatrice-response-service';
import { DriveKnowledgeService } from '@/lib/document/drive-knowledge-service';
import { MemoryService } from '@/lib/document/memory-service';
import { OCRService } from '@/lib/document/ocr-service';
import { ScannerService } from '@/lib/document/scanner-service';
import { useCctvVisionStore } from '@/lib/vision/cctv-store';
import { ObjectDetectionService } from '@/lib/vision/object-detection-service';
import type { VisionScanResult } from '@/lib/vision/types';
import {
  useDocumentSettingsStore,
  useDocumentVisionStore,
} from '@/lib/document/store';
import type { OCRExtraction, ScannedDocumentRecord } from '@/lib/document/types';
import {
  buildDocumentAwarePrompt,
  createId,
  detectLanguageHeuristically,
  getEffectiveUserId,
  normalizeWhitespace,
  nowIso,
} from '@/lib/document/utils';

const DEFAULT_REQUEST = 'Beatrice, upload this file and use it as context.';

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected media file.'));
    reader.readAsDataURL(file);
  });

const ActionFeedback = ({
  title,
  value,
}: {
  title: string;
  value: string;
}) => (
  <div className="scan-action-feedback">
    <p className="scan-section-label">{title}</p>
    <div className="scan-action-copy">{value}</div>
  </div>
);

export default function DocumentScannerModal() {
  const {
    client,
    connected,
  } = useLiveAPIContext();
  const {
    toggleChat,
  } = useUI();
  const {
    isScannerOpen,
    stage,
    request,
    source,
    draftPages,
    selectedPageIndex,
    cropBounds,
    currentDocument,
    processingMessage,
    ocrProgress,
    error,
    closeScanner,
    setDraftPages,
    setSelectedPageIndex,
    setCropBounds,
    setProcessingState,
    setScanResult,
    setStage,
    setError,
    clearResult,
  } = useDocumentVisionStore();
  const { settings } = useDocumentSettingsStore();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ title: string; value: string } | null>(null);
  const [driveSyncMessage, setDriveSyncMessage] = useState<string | null>(null);

  const activePage = draftPages[selectedPageIndex] || null;
  const requestText = request?.userRequest || DEFAULT_REQUEST;
  const [mediaPreview, setMediaPreview] = useState<{
    kind: 'image' | 'video';
    fileName: string;
    dataUrl: string;
    detection?: VisionScanResult | null;
  } | null>(null);

  useEffect(() => {
    if (!activePage || stage !== 'crop') return;
    let disposed = false;
    ScannerService.autoDetectCrop(activePage.dataUrl)
      .then(bounds => {
        if (!disposed) {
          setCropBounds(bounds);
        }
      })
      .catch(() => {
        if (!disposed) {
          setCropBounds({ left: 0.06, top: 0.06, width: 0.88, height: 0.88 });
        }
      });

    return () => {
      disposed = true;
    };
  }, [activePage, stage, setCropBounds]);

  useEffect(() => {
    if (!isScannerOpen) {
      setActionFeedback(null);
      setDriveSyncMessage(null);
      setMediaPreview(null);
    }
  }, [isScannerOpen]);

  const cropStyle = useMemo(
    () => ({
      left: `${cropBounds.left * 100}%`,
      top: `${cropBounds.top * 100}%`,
      width: `${cropBounds.width * 100}%`,
      height: `${cropBounds.height * 100}%`,
    }),
    [cropBounds],
  );

  const handleClose = () => {
    closeScanner();
  };

  const handleMediaFile = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) return false;

    setError(null);
    setActionFeedback(null);
    setDriveSyncMessage('Uploading media to your Google Drive knowledge folder...');

    try {
      const dataUrl = await fileToDataUrl(file);
      let detection: VisionScanResult | null = null;
      if (isImage) {
        try {
          detection = await ObjectDetectionService.detectDataUrl(dataUrl, file.name);
          useCctvVisionStore.getState().setLastFrame(dataUrl);
          useCctvVisionStore.getState().setLastResult(detection);
        } catch (detectionError) {
          console.warn('Image object detection skipped:', detectionError);
        }
      }

      const driveResult = await DriveKnowledgeService.uploadSourceFileToKnowledge(file);
      setDriveSyncMessage(driveResult.message);
      setMediaPreview({
        kind: isImage ? 'image' : 'video',
        fileName: file.name,
        dataUrl,
        detection,
      });
      setActionFeedback({
        title: isImage ? 'Image Uploaded' : 'Video Uploaded',
        value: detection?.summary || `${file.name} is stored in Drive. Beatrice can use the media file as a source reference.`,
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload this media file.');
      setDriveSyncMessage(null);
      return true;
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const handledAsMedia = await handleMediaFile(file);
      if (handledAsMedia) return;
      setDriveSyncMessage('Uploading original file to your Google Drive knowledge folder...');
      const uploaded = await ScannerService.uploadFromGallery(file);
      setDraftPages(uploaded.pages, uploaded.source);
      const driveResult = await DriveKnowledgeService.uploadSourceFileToKnowledge(file);
      setDriveSyncMessage(driveResult.message);
    } catch {
      setError('Ik kon dit bestand niet openen.');
      setDriveSyncMessage(null);
    } finally {
      event.target.value = '';
    }
  };

  const updateCropValue = (key: 'left' | 'top' | 'width' | 'height', value: number) => {
    const next = {
      ...cropBounds,
      [key]: value / 100,
    };

    if (key === 'left') {
      next.left = Math.min(next.left, 1 - cropBounds.width);
    }
    if (key === 'top') {
      next.top = Math.min(next.top, 1 - cropBounds.height);
    }
    if (key === 'width') {
      next.width = Math.min(next.width, 1 - cropBounds.left);
    }
    if (key === 'height') {
      next.height = Math.min(next.height, 1 - cropBounds.top);
    }

    setCropBounds(next);
  };

  const processScan = async () => {
    if (!draftPages.length) return;
    setProcessingState('Beatrice is reading the document...', 0.02);
    setActionFeedback(null);
    setError(null);

    try {
      const directText = draftPages
        .map(page => (typeof page.metadata.extracted_text === 'string' ? page.metadata.extracted_text : ''))
        .filter(Boolean)
        .join('\n\n');
      let processedPages = draftPages;
      let ocr: OCRExtraction;

      if (directText.trim()) {
        const cleanedText = normalizeWhitespace(directText);
        ocr = {
          raw_text: directText,
          cleaned_text: cleanedText,
          detected_language: detectLanguageHeuristically(cleanedText),
          confidence: 0.99,
          page_count: draftPages.length,
        };
        setProcessingState('Using direct document text extraction...', 0.72);
      } else {
        processedPages = [];
        for (let index = 0; index < draftPages.length; index += 1) {
          const page = draftPages[index];
          const bounds =
            index === selectedPageIndex
              ? cropBounds
              : await ScannerService.autoDetectCrop(page.dataUrl).catch(() => ({
                  left: 0.05,
                  top: 0.05,
                  width: 0.9,
                  height: 0.9,
                }));
          const cropped = await ScannerService.cropImage(page.dataUrl, bounds);
          const processed = await ScannerService.preprocessImage(cropped.dataUrl);
          processedPages.push({
            ...cropped,
            dataUrl: processed.dataUrl,
            metadata: {
              ...page.metadata,
              ...cropped.metadata,
              ...processed.metadata,
            },
          });
          setProcessingState(`Preparing page ${index + 1} of ${draftPages.length}...`, 0.1 + (index / draftPages.length) * 0.15);
        }

        ocr = await OCRService.extractText({
          pages: processedPages,
          onProgress: (progress, status) => {
            setProcessingState(`OCR: ${status}`, 0.25 + progress * 0.45);
          },
        });
      }

      if (!ocr.cleaned_text.trim()) {
        throw new Error('NO_TEXT_FOUND');
      }

      const analysis = await DocumentAIService.analyzeDocument({
        ocr,
        userRequest: requestText,
      });

      const createdAt = nowIso();
      const document: ScannedDocumentRecord = {
        document_id: createId('doc'),
        owner_user_id: getEffectiveUserId(),
        source,
        created_at: createdAt,
        updated_at: createdAt,
        title: analysis.suggested_title || 'Scanned document',
        scan_label: requestText,
        source_name: typeof activePage?.metadata?.source_name === 'string' ? activePage.metadata.source_name : undefined,
        image_metadata: {
          page_count: processedPages.length,
          source,
          processed_pages: processedPages.map(page => page.metadata),
        },
        ocr,
        analysis,
        memory: {
          saved_to_short_memory: false,
          saved_to_long_memory: false,
          memory_id: null,
          suggested_title: analysis.suggested_title,
          suggested_tags: analysis.suggested_tags,
        },
        ui: {
          suggested_followups: analysis.suggested_followup_questions,
        },
        related_document_ids: [],
        raw_image_data_url:
          settings.saveOriginalImage && !settings.privateScanMode ? processedPages[0]?.dataUrl || null : null,
      };

      const shortSaved = settings.autoSaveShortMemory
        ? await MemoryService.saveShortMemory({
            document,
            userQuestion: requestText,
          })
        : null;

      document.memory.saved_to_short_memory = Boolean(shortSaved);

      if (!settings.privateScanMode) {
        document.embedding_vector = await DocumentAIService.embedText(
          `${document.title}\n${document.analysis.short_summary}\n${document.ocr.cleaned_text.slice(0, 6000)}`,
        );
      }

      let finalized = document;
      const shouldSaveLong =
        !settings.privateScanMode &&
        (Boolean(directText.trim()) ||
          request?.autoSaveLongMemory ||
          request?.saveRequested ||
          settings.autoSaveImportantLongMemory && document.analysis.importance === 'high');

      if (shouldSaveLong) {
        finalized = await MemoryService.saveLongMemory(document);
      }

      setScanResult(finalized);

      const summaryText = BeatriceResponseService.generateVoiceResponse(finalized);
      useLogStore.getState().addTurn({
        role: 'agent',
        text: summaryText,
        isFinal: true,
      });

      if (connected) {
        client.send(
          [
            {
              text: `You just finished reading a scanned document for the user. Respond naturally in voice using this guidance, staying concise and human:

${summaryText}

If the document is only in short memory, mention that follow-up questions are ready in this session.`,
            },
          ],
          true,
        );
      }
    } catch (processingError: any) {
      if (processingError?.message === 'NO_TEXT_FOUND') {
        setError('Ik zie geen duidelijke tekst in deze afbeelding.');
      } else {
        setError('Ik kon de tekst niet goed lezen. Probeer opnieuw met beter licht of dichter bij het document.');
      }
      setStage('crop');
    }
  };

  const handleAskBeatrice = () => {
    if (!currentDocument) return;
    toggleChat();
    setActionFeedback({
      title: 'Beatrice Context Ready',
      value: 'The scanned document is active in this session. Ask your follow-up in chat or by voice.',
    });
    if (connected) {
      client.send(
        [
          {
            text: buildDocumentAwarePrompt(
              'Acknowledge that the scanned document is loaded and tell the user they can ask follow-up questions now.',
              currentDocument,
            ),
          },
        ],
        true,
      );
    }
  };

  const handleActionQuestion = async (title: string, question: string) => {
    if (!currentDocument) return;
    const answer = await DocumentAIService.answerQuestion({
      document: currentDocument,
      question,
    });
    setActionFeedback({
      title,
      value: answer.text,
    });
    useLogStore.getState().addTurn({
      role: 'agent',
      text: answer.text,
      isFinal: true,
    });
  };

  const handleSaveLongMemory = async () => {
    if (!currentDocument) return;
    const saved = await MemoryService.saveLongMemory(currentDocument);
    setScanResult(saved);
    setActionFeedback({
      title: 'Saved To Memory',
      value: `Saved as "${saved.title}". You can retrieve it later by asking naturally.`,
    });
  };

  const handleCopyText = async () => {
    if (!currentDocument?.ocr.cleaned_text) return;
    await navigator.clipboard.writeText(currentDocument.ocr.cleaned_text);
    setActionFeedback({
      title: 'Copied',
      value: 'The extracted text is now in your clipboard.',
    });
  };

  const handleExport = () => {
    if (!currentDocument) return;
    const blob = new Blob([JSON.stringify(currentDocument, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${currentDocument.title.replace(/\s+/g, '_').toLowerCase() || 'scan'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    if (currentDocument?.memory.memory_id) {
      await MemoryService.deleteMemory(currentDocument.memory.memory_id);
    }
    clearResult();
    setStage('capture');
    setActionFeedback(null);
  };

  const handleRetake = () => {
    clearResult();
    setMediaPreview(null);
    setStage('capture');
  };

  if (!isScannerOpen) {
    return null;
  }

  return (
    <div className="scan-modal-shell">
      <div className="scan-modal-backdrop" onClick={handleClose} />
      <section className="scan-modal" role="dialog" aria-modal="true" aria-label="Upload media or document">
        <header className="scan-modal-header">
          <div>
            <p className="scan-kicker">Beatrice Media Intake</p>
            <h2>Photo, Video, or File Upload</h2>
            <p className="scan-request-copy">{requestText}</p>
          </div>
          <button className="scan-icon-button" onClick={handleClose} aria-label="Close scanner">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {error ? (
          <div className="scan-error-banner">
            <span className="material-symbols-outlined">warning</span>
            <span>{error}</span>
          </div>
        ) : null}

        {driveSyncMessage ? (
          <div className="scan-action-feedback">
            <p className="scan-section-label">Drive Knowledge Storage</p>
            <div className="scan-action-copy">{driveSyncMessage}</div>
          </div>
        ) : null}

        {stage === 'capture' ? (
          <div className="scan-capture-layout">
            <div className="scan-toolbar">
              <button className="scan-upload-pill" onClick={() => photoInputRef.current?.click()}>
                <span className="material-symbols-outlined">photo_camera</span>
                <span>Take Photo</span>
              </button>
              <button className="scan-upload-pill" onClick={() => videoInputRef.current?.click()}>
                <span className="material-symbols-outlined">videocam</span>
                <span>Take Video</span>
              </button>
              <button className="scan-upload-pill" onClick={() => fileInputRef.current?.click()}>
                <span className="material-symbols-outlined">upload_file</span>
                <span>Upload Image / File</span>
              </button>
              <button className="scan-cancel-pill" onClick={handleClose}>
                Cancel
              </button>
            </div>
            {mediaPreview ? (
              <div className="scan-crop-layout">
                <div className="scan-crop-preview">
                  {mediaPreview.kind === 'image' ? (
                    <img
                      src={mediaPreview.detection?.annotatedDataUrl || mediaPreview.dataUrl}
                      alt={mediaPreview.fileName}
                    />
                  ) : (
                    <video
                      src={mediaPreview.dataUrl}
                      controls
                      playsInline
                      className="scan-camera-preview"
                    />
                  )}
                </div>
                {mediaPreview.detection ? (
                  <div className="scan-result-summary">
                    <div className="scan-result-meta">
                      <span className="scan-meta-pill">Objects: {mediaPreview.detection.detections.length}</span>
                      <span className="scan-meta-pill">Threat flags: {mediaPreview.detection.threatDetections.length}</span>
                    </div>
                    <h3>{mediaPreview.fileName}</h3>
                    <p>{mediaPreview.detection.summary}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="scan-capture-footer">
              <button className="scan-capture-button" onClick={() => photoInputRef.current?.click()}>
                <span className="material-symbols-outlined">photo_camera</span>
              </button>
              <p>Use normal device photo/video capture or upload an existing image/file.</p>
            </div>
          </div>
        ) : null}

        {stage === 'crop' && activePage ? (
          <div className="scan-crop-layout">
            <div className="scan-crop-preview">
              <img src={activePage.dataUrl} alt="Captured document preview" />
              <div className="scan-crop-rect" style={cropStyle} />
            </div>

            {draftPages.length > 1 ? (
              <div className="scan-page-tabs">
                {draftPages.map((page, index) => (
                  <button
                    key={page.id}
                    className={c('scan-page-tab', { active: index === selectedPageIndex })}
                    onClick={() => setSelectedPageIndex(index)}
                  >
                    Page {index + 1}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="scan-crop-controls">
              <label>
                Left
                <input
                  type="range"
                  min="0"
                  max="90"
                  value={Math.round(cropBounds.left * 100)}
                  onChange={event => updateCropValue('left', Number(event.target.value))}
                />
              </label>
              <label>
                Top
                <input
                  type="range"
                  min="0"
                  max="90"
                  value={Math.round(cropBounds.top * 100)}
                  onChange={event => updateCropValue('top', Number(event.target.value))}
                />
              </label>
              <label>
                Width
                <input
                  type="range"
                  min="10"
                  max={Math.max(10, Math.round((1 - cropBounds.left) * 100))}
                  value={Math.round(cropBounds.width * 100)}
                  onChange={event => updateCropValue('width', Number(event.target.value))}
                />
              </label>
              <label>
                Height
                <input
                  type="range"
                  min="10"
                  max={Math.max(10, Math.round((1 - cropBounds.top) * 100))}
                  value={Math.round(cropBounds.height * 100)}
                  onChange={event => updateCropValue('height', Number(event.target.value))}
                />
              </label>
            </div>

            <div className="scan-result-actions">
              <button className="scan-secondary-button" onClick={handleRetake}>
                Retake
              </button>
              <button className="scan-primary-button" onClick={processScan}>
                Use File
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'processing' ? (
          <div className="scan-processing-state">
            <div className="scan-processing-ring" />
            <h3>Beatrice is reading the document...</h3>
            <p>{processingMessage || 'OCR is running.'}</p>
            <div className="scan-progress-bar">
              <span style={{ width: `${Math.round(ocrProgress * 100)}%` }} />
            </div>
            <strong>{Math.round(ocrProgress * 100)}%</strong>
          </div>
        ) : null}

        {stage === 'result' && currentDocument ? (
          <div className="scan-result-layout">
            <div className="scan-result-summary">
              <div className="scan-result-meta">
                <span className="scan-meta-pill">Language: {currentDocument.ocr.detected_language}</span>
                <span className="scan-meta-pill">Type: {currentDocument.analysis.document_type}</span>
                <span className="scan-meta-pill">
                  Confidence: {Math.round(currentDocument.ocr.confidence * 100)}%
                </span>
              </div>
              <h3>{currentDocument.title}</h3>
              <p>{currentDocument.analysis.short_summary}</p>
            </div>

            <div className="scan-section-grid">
              <section className="scan-content-card">
                <p className="scan-section-label">Extracted Text Preview</p>
                <div className="scan-text-preview">{currentDocument.ocr.cleaned_text.slice(0, 2800)}</div>
              </section>

              <section className="scan-content-card">
                <p className="scan-section-label">Detailed Summary</p>
                <div className="scan-summary-preview">{currentDocument.analysis.detailed_summary}</div>
              </section>
            </div>

            <div className="scan-followups">
              {currentDocument.ui.suggested_followups.map(followup => (
                <button
                  key={followup}
                  className="scan-followup-chip"
                  onClick={() => handleActionQuestion('Beatrice Follow-up', followup)}
                >
                  {followup}
                </button>
              ))}
            </div>

            <div className="scan-result-actions">
              <button className="scan-primary-button" onClick={handleAskBeatrice}>
                Ask Beatrice
              </button>
              <button
                className="scan-secondary-button"
                onClick={() =>
                  handleActionQuestion('Dutch Translation', 'Translate this into Dutch and explain it naturally.')
                }
              >
                Translate
              </button>
              <button className="scan-secondary-button" onClick={handleSaveLongMemory}>
                Save to Memory
              </button>
              <button
                className="scan-secondary-button"
                onClick={() => handleActionQuestion('Detailed Summary', 'Give me a detailed explanation of this document.')}
              >
                Detailed Summary
              </button>
              <button className="scan-secondary-button" onClick={handleCopyText}>
                Copy Text
              </button>
              <button className="scan-secondary-button" onClick={handleExport}>
                Export
              </button>
              <button className="scan-danger-button" onClick={handleDelete}>
                Delete Scan
              </button>
            </div>

            {actionFeedback ? (
              <ActionFeedback title={actionFeedback.title} value={actionFeedback.value} />
            ) : null}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json"
          hidden
          onChange={handleUpload}
        />
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={handleUpload}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          capture="environment"
          hidden
          onChange={handleUpload}
        />
      </section>
    </div>
  );
}
