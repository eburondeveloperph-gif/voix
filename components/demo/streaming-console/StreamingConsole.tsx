/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useCallback, useEffect, useRef, useState } from 'react';
import c from 'classnames';
import PopUp from '../popup/PopUp';
import AudioVisualizer from './AudioVisualizer';
import ControlTray from '../../console/control-tray/ControlTray';
import TestLogViewer from '../../TestLogViewer';
// FIX: Import LiveServerContent to correctly type the content handler.
import { LiveServerContent, Modality } from '@google/genai';
import { buildBeatriceLiveSystemPrompt } from '@/lib/prompts/beatrice';
import { VoiceCommandRouter } from '@/lib/document/voice-command-router';
import { MemoryService } from '@/lib/document/memory-service';
import { OCRService } from '@/lib/document/ocr-service';
import { useDocumentVisionStore } from '@/lib/document/store';
import { buildDocumentAwarePrompt, getEffectiveUserId, createId, nowIso } from '@/lib/document/utils';
import type { OCRExtraction } from '@/lib/document/types';
import { useUserProfileStore } from '@/lib/user-profile-store';
import { UserProfileService, getRuntimeUserIdentity } from '@/lib/user-profile';
import { useCctvVisionStore } from '@/lib/vision/cctv-store';
import { useVisionCameraToolStore } from '@/lib/vision/camera-tool-store';
import { ObjectDetectionService } from '@/lib/vision/object-detection-service';
import type { VisionScanResult } from '@/lib/vision/types';
import { useTestLogStore, copyToClipboard, logConversation } from '@/lib/test-log-store';
import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import {
  useSettings,
  useLogStore,
  useTools,
  useUI,
  useProcessingStore,
  ConversationTurn,
} from '@/lib/state';
import {
  PROCESSING_SERVICE_VISUALS,
  getProcessingServiceKeys,
  type ProcessingServiceKey,
} from '@/lib/processing-console';
import { db, isFirestoreRemoteEnabled } from '@/lib/firebase';
import { collection, query, limit, serverTimestamp, where } from 'firebase/firestore';
import { safeAddDoc, safeGetDocs } from '@/lib/firestore-safe';

const formatTimestamp = (date: Date) => {
  const pad = (num: number, size = 2) => num.toString().padStart(size, '0');
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const milliseconds = pad(date.getMilliseconds(), 3);
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
};

const mergeTranscriptText = (previousText: string, incomingText: string) => {
  const previous = previousText.trim();
  const incoming = incomingText.trim();

  if (!previous) return incomingText;
  if (!incoming) return previousText;

  if (incoming === previous) return previousText;
  if (incoming.startsWith(previous)) return incomingText;
  if (previous.startsWith(incoming)) return previousText;
  if (incoming.includes(previous)) return incomingText;
  if (previous.includes(incoming)) return previousText;

  const maxOverlap = Math.min(previous.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(-overlap) === incoming.slice(0, overlap)) {
      return `${previous}${incoming.slice(overlap)}`;
    }
  }

  const separator = /[\s([{'"-]$/.test(previous) || /^[\s.,!?;:)\]}'"-]/.test(incoming) ? '' : ' ';
  return `${previous}${separator}${incoming}`;
};

const renderContent = (text: string) => {
  // Split by ```json...``` code blocks
  const parts = text.split(/(`{3}json\n[\s\S]*?\n`{3})/g);

  return parts.map((part, index) => {
    if (part.startsWith('```json')) {
      const jsonContent = part.replace(/^`{3}json\n|`{3}$/g, '');
      return (
        <pre key={index}>
          <code>{jsonContent}</code>
        </pre>
      );
    }

    // Split by **bold** text
    const boldParts = part.split(/(\*\*.*?\*\*)/g);
    return boldParts.map((boldPart, boldIndex) => {
      if (boldPart.startsWith('**') && boldPart.endsWith('**')) {
        return <strong key={boldIndex}>{boldPart.slice(2, -2)}</strong>;
      }
      return boldPart;
    });
  });
};

const extractPreferredAddress = (text: string) => {
  const match = text.match(/\b(?:call me|address me as|refer to me as|you can call me)\s+(.+)/i);
  if (!match?.[1]) return null;
  const value = match[1].trim().replace(/[.?!]+$/, '');
  if (!value) return null;
  return value;
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });

const formatOcrPreview = (ocr: OCRExtraction | null) => {
  if (!ocr) return '';
  const text = ocr.cleaned_text.trim();
  return text ? text.slice(0, 500) : '';
};


export default function StreamingConsole() {
  const {
    client,
    setConfig,
    connected,
    connect,
    disconnect,
    volume,
    speakerMuted,
    setSpeakerMuted
  } = useLiveAPIContext();
  const { systemPrompt, voice } = useSettings();
  const { tools, template } = useTools();
  const {
    isGeneratingTask,
    activeCueUrl,
    taskResult,
    setTaskResult,
    cameraEnabled,
    setCameraEnabled,
    cameraPreviewUrl,
    micLevel,
    isChatOpen,
    toggleChat,
    micPermission,
    setMicPermission,
  } = useUI();
  const { currentDocument, openScanner } = useDocumentVisionStore();
  const profile = useUserProfileStore(state => state.profile);
  const submitOnboarding = useUserProfileStore(state => state.submitOnboarding);
  const turns = useLogStore(state => state.turns);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [showPopUp, setShowPopUp] = useState(false);
  const [manualMessage, setManualMessage] = useState('');
  const [showTestLogViewer, setShowTestLogViewer] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // ─── Video camera + snapshot state ───
  const [showVideoCamera, setShowVideoCamera] = useState(false);
  const [videoSnapshot, setVideoSnapshot] = useState<string | null>(null);
  const [isAnalyzingSnapshot, setIsAnalyzingSnapshot] = useState(false);
  const [isDetectingSnapshot, setIsDetectingSnapshot] = useState(false);
  const [snapshotDetection, setSnapshotDetection] = useState<VisionScanResult | null>(null);
  const [snapshotOcr, setSnapshotOcr] = useState<OCRExtraction | null>(null);
  const [liveDetection, setLiveDetection] = useState<VisionScanResult | null>(null);
  const [liveOcr, setLiveOcr] = useState<OCRExtraction | null>(null);
  const [isRunningLiveVision, setIsRunningLiveVision] = useState(false);
  const [isRunningLiveOcr, setIsRunningLiveOcr] = useState(false);
  const [isReadingSnapshotText, setIsReadingSnapshotText] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraSourceLabel, setCameraSourceLabel] = useState('Beatrice video camera');
  const [cameraAutoDetect, setCameraAutoDetect] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nativePhotoInputRef = useRef<HTMLInputElement>(null);
  const liveVisionBusyRef = useRef(false);
  const liveOcrBusyRef = useRef(false);
  const handledCameraToolRequestRef = useRef(0);
  const cameraToolRequestId = useVisionCameraToolStore(state => state.requestId);
  const cameraToolMode = useVisionCameraToolStore(state => state.mode);
  const cameraToolSourceLabel = useVisionCameraToolStore(state => state.sourceLabel);
  const cameraToolAutoDetect = useVisionCameraToolStore(state => state.autoDetect);
  const clearCameraToolRequest = useVisionCameraToolStore(state => state.clearRequest);

  // Test logging
  const { 
    isLogging, 
    startSession, 
    endSession, 
    addEntry 
  } = useTestLogStore();

  const handleClosePopUp = () => {
    setShowPopUp(false);
  };

  // Set the configuration for the Live API
  useEffect(() => {
    const enabledTools = tools
      .filter(tool => tool.isEnabled)
      .map(tool => ({
        functionDeclarations: [
          {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        ],
      }));

    const finalSystemPrompt = template === 'beatrice'
      ? buildBeatriceLiveSystemPrompt(UserProfileService.buildProfilePrompt(profile))
      : systemPrompt;

    const config = {
      responseModalities: [Modality.AUDIO],
      temperature: 0.85,
      topP: 0.92,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
      systemInstruction: {
        parts: [
          {
            text: finalSystemPrompt,
          },
        ],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: enabledTools,
    };

    setConfig(config);
  }, [setConfig, systemPrompt, tools, voice, template, profile]);

  useEffect(() => {
    const { addTurn, updateLastTurn } = useLogStore.getState();

    const handleInputTranscription = async (text: string, isFinal: boolean) => {
      const turns = useLogStore.getState().turns;
      const last = turns[turns.length - 1];
      if (last && last.role === 'user' && !last.isFinal) {
        updateLastTurn({
          text: mergeTranscriptText(last.text, text),
          isFinal,
        });
      } else {
        addTurn({ role: 'user', text, isFinal });
      }

      // Log to test store when final
      if (isFinal) {
        try {
          await safeAddDoc(db, 'turns', {
            user_id: profile?.user_id || getRuntimeUserIdentity().userId,
            role: 'user',
            text,
            timestamp: serverTimestamp(),
            isFinal: true,
          });
        } catch (e) {
          console.error('Error syncing user transcript to Firebase:', e);
        }

        logConversation(addEntry, 'user', text, { 
          source: 'voice',
          timestamp: Date.now(),
        });
        
        const preferredAddress = extractPreferredAddress(text);
        if (preferredAddress) {
          void submitOnboarding({
            preferred_name: profile?.preferred_name || preferredAddress,
            preferred_address: preferredAddress,
          });
        }

        const intent = VoiceCommandRouter.detectIntent(text);
        if (intent.intent === 'DOCUMENT_SCAN_INTENT') {
          useDocumentVisionStore.getState().openScanner({
            userRequest: text,
            autoSaveLongMemory: /save|remember|long memory|permanent/i.test(text),
            saveRequested: /save|remember|long memory|permanent/i.test(text),
          });
          useLogStore.getState().addTurn({
            role: 'system',
            text: 'Opening Beatrice Document Vision for the current voice request.',
            isFinal: true,
          });
          addEntry('system', 'Opening Beatrice Document Vision', { intent: intent.intent });
        }
      }
    };

    const handleOutputTranscription = (text: string, isFinal: boolean) => {
      const turns = useLogStore.getState().turns;
      const last = turns[turns.length - 1];
      if (last && last.role === 'agent' && !last.isFinal) {
        updateLastTurn({
          text: mergeTranscriptText(last.text, text),
          isFinal,
        });
      } else {
        addTurn({ role: 'agent', text, isFinal });
      }

      // Log AI response to test store when final
      if (isFinal) {
        logConversation(addEntry, 'assistant', text, { 
          source: 'ai',
          timestamp: Date.now(),
        });
      }
    };

    const onContent = (serverContent: LiveServerContent) => {
      const text =
        serverContent.modelTurn?.parts
          ?.map((p: any) => p.text)
          .filter(Boolean)
          .join(' ') ?? '';
      const groundingChunks = serverContent.groundingMetadata?.groundingChunks;

      if (!text && !groundingChunks) return;

      const turns = useLogStore.getState().turns;
      const last = turns.at(-1);

      if (last?.role === 'agent' && !last.isFinal) {
        const updatedTurn: Partial<ConversationTurn> = {
          text: mergeTranscriptText(last.text, text),
        };
        if (groundingChunks) {
          updatedTurn.groundingChunks = [
            ...(last.groundingChunks || []),
            ...(groundingChunks as any),
          ];
        }
        updateLastTurn(updatedTurn);
      } else {
        addTurn({ role: 'agent', text, isFinal: false, groundingChunks: groundingChunks as any });
      }
    };

    const handleTurnComplete = async () => {
      const last = useLogStore.getState().turns.at(-1);
      if (last && !last.isFinal) {
        updateLastTurn({ isFinal: true });
        
        // Sync final turn to Firebase
        try {
          await safeAddDoc(db, 'turns', {
            user_id: profile?.user_id || getRuntimeUserIdentity().userId,
            role: last.role,
            text: last.text,
            timestamp: serverTimestamp(),
            isFinal: true
          });
          
          // If it's a significant turn, update "Knowledge" (Long Term Memory)
          if (last.text.length > 20) {
             await safeAddDoc(db, 'knowledge', {
               user_id: profile?.user_id || 'local-dev-user',
               content: last.text,
               timestamp: serverTimestamp(),
               source: last.role
             });
          }
        } catch (e) {
          console.error("Error syncing to Firebase:", e);
        }
      }
    };

    client.on('inputTranscription', handleInputTranscription);
    client.on('outputTranscription', handleOutputTranscription);
    client.on('content', onContent);
    client.on('turncomplete', handleTurnComplete);

    return () => {
      client.off('inputTranscription', handleInputTranscription);
      client.off('outputTranscription', handleOutputTranscription);
      client.off('content', onContent);
      client.off('turncomplete', handleTurnComplete);
    };
  }, [addEntry, client, profile, submitOnboarding]);

  // Load Long Term Memory / Previous Turns
  useEffect(() => {
    const loadMemory = async () => {
      try {
        await MemoryService.syncRemoteIntoLocal();
        if (!isFirestoreRemoteEnabled()) return;

        const q = query(
          collection(db, 'turns'),
          where('user_id', '==', profile?.user_id || 'local-dev-user'),
          limit(25),
        );
        const querySnapshot = await safeGetDocs(q);
        if (!querySnapshot) return;

        const previousTurns: ConversationTurn[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          previousTurns.unshift({
            role: data.role,
            text: data.text,
            timestamp: data.timestamp?.toDate() || new Date(),
            isFinal: true
          });
        });
        previousTurns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        if (previousTurns.length > 0) {
          useLogStore.setState({ turns: previousTurns.slice(-10) });
        }
      } catch (e) {
        console.error("Error loading memory:", e);
      }
    };
    loadMemory();
  }, [profile?.user_id]);

  useEffect(() => {
    if (scrollRef.current && autoScrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported', 'This browser does not support microphone capture.');
      return;
    }

    if (!navigator.permissions?.query) {
      return;
    }

    let disposed = false;
    let permissionStatus: PermissionStatus | null = null;

    const mapPermissionState = (state: PermissionState) => {
      if (state === 'granted') return 'granted';
      if (state === 'denied') return 'denied';
      return 'prompt';
    };

    const syncPermission = () => {
      if (!permissionStatus || disposed) return;
      const nextState = mapPermissionState(permissionStatus.state);
      setMicPermission(
        nextState,
        nextState === 'denied'
          ? 'Microphone access is blocked. Enable it in the browser site settings.'
          : null,
      );
    };

    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then(status => {
        if (disposed) return;
        permissionStatus = status;
        syncPermission();
        permissionStatus.onchange = syncPermission;
      })
      .catch(() => {
        // Ignore unsupported Permissions API implementations.
      });

    return () => {
      disposed = true;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, [setMicPermission]);

  const handleTranscriptScroll = () => {
    const node = scrollRef.current;
    if (!node) return;

    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    autoScrollRef.current = distanceFromBottom < 48;
  };

  // Use the live `turns` value for both the live transcript and the chat
  // drawer so the user sees their words and Beatrice's stream in real-time.
  const latestTurn = turns.at(-1);
  const isAgentDraft = latestTurn?.role === 'agent' && !latestTurn.isFinal;
  const isUserDraft = latestTurn?.role === 'user' && !latestTurn.isFinal;
  const statusLabel = connected ? (isAgentDraft ? 'Thinking' : 'Listening') : 'Idle';
  const liveTranscript =
    micPermission === 'requesting'
      ? 'Waiting for microphone permission...'
      : micPermission === 'unsupported'
        ? 'This browser does not support microphone capture.'
      : micPermission === 'denied'
      ? 'Microphone access is blocked. Tap the mic, then allow permission in your browser.'
      : latestTurn && !latestTurn.isFinal && latestTurn.text.trim()
      ? latestTurn.text
      : connected
        ? 'Speak naturally. Beatrice is listening.'
        : 'Tap the microphone to start a voice session.';
  const orbEnergy = connected ? Math.max(0.08, micLevel, volume * 0.9) : 0;
  const orbScale = connected ? 1 + orbEnergy * 0.38 : 1;
  const orbShadow = connected ? 50 + orbEnergy * 110 : 50;
  const centerOrbStyle: React.CSSProperties = {
    ...styles.centerOrb,
    transform: `scale(${orbScale.toFixed(3)})`,
    boxShadow: connected
      ? `inset 0 0 20px rgba(255,255,255,0.5), 0 0 ${orbShadow}px rgba(217,70,239,0.75), 0 0 ${orbShadow * 1.65}px rgba(126,34,206,0.42)`
      : styles.centerOrb.boxShadow,
  };

  const handleManualSend = async () => {
    const text = manualMessage.trim();
    if (!text || !connected) return;

    useLogStore.getState().addTurn({
      role: 'user',
      text,
      isFinal: true,
    });

    // Log to test store
    logConversation(addEntry, 'user', text, { 
      source: 'chat',
      timestamp: Date.now(),
    });

    const intent = VoiceCommandRouter.detectIntent(text);
    const preferredAddress = extractPreferredAddress(text);
    if (preferredAddress) {
      await submitOnboarding({
        preferred_name: profile?.preferred_name || preferredAddress,
        preferred_address: preferredAddress,
      });
    }
    if (intent.intent === 'DOCUMENT_SCAN_INTENT') {
      openScanner({
        userRequest: text,
        autoSaveLongMemory: /save|remember|long memory|permanent/i.test(text),
        saveRequested: /save|remember|long memory|permanent/i.test(text),
      });
      useLogStore.getState().addTurn({
        role: 'system',
        text: 'Opening Beatrice Document Vision from chat request.',
        isFinal: true,
      });
      addEntry('system', 'Opening Beatrice Document Vision from chat', { intent: intent.intent });
      setManualMessage('');
      return;
    }

    const relatedDocuments = currentDocument
      ? []
      : (await MemoryService.searchMemory(text, { limit: 3 })).map(item => item.document);
    const prompt = buildDocumentAwarePrompt(text, currentDocument, relatedDocuments);
    client.send([{ text: prompt }], true);
    setManualMessage('');
  };

  const requestMicrophoneAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicPermission('unsupported', 'This browser does not support microphone capture.');
      return false;
    }

    setMicPermission('requesting', 'Waiting for microphone permission...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach(track => track.stop());
      setMicPermission('granted');
      return true;
    } catch (error: any) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
      const missingDevice = error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError';
      setMicPermission(
        denied ? 'denied' : 'prompt',
        denied
          ? 'Microphone permission was denied. Allow it in the browser and try again.'
          : missingDevice
            ? 'No microphone was found on this device.'
            : 'Microphone permission could not be completed.',
      );
      return false;
    }
  };

  const handleMicToggle = async () => {
    if (connected) {
      disconnect();
      return;
    }

    const granted = await requestMicrophoneAccess();
    if (!granted) return;
    await connect();
  };

  // ─── Video Camera + Phone Photo Handlers ───
  const stopVideoStream = useCallback(() => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const captureVideoFrameDataUrl = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, []);

  const runImageDetection = useCallback(async (dataUrl: string, sourceLabel: string) => {
    const result = await ObjectDetectionService.detectDataUrl(dataUrl, sourceLabel);
    useCctvVisionStore.getState().setLastFrame(dataUrl);
    useCctvVisionStore.getState().setLastResult(result);
    return result;
  }, []);

  const runImageOcr = useCallback(async (dataUrl: string, sourceLabel: string) => {
    return OCRService.extractText({
      pages: [
        {
          id: `camera_ocr_${Date.now()}`,
          dataUrl,
          width: 0,
          height: 0,
          metadata: { sourceLabel },
        },
      ],
    });
  }, []);

  const processCapturedImage = useCallback(async (dataUrl: string, sourceLabel: string) => {
    setIsDetectingSnapshot(true);
    setIsReadingSnapshotText(true);
    try {
      const [detection, ocr] = await Promise.all([
        runImageDetection(dataUrl, sourceLabel),
        runImageOcr(dataUrl, sourceLabel).catch(error => {
          console.warn('Camera OCR failed:', error);
          return null;
        }),
      ]);
      setSnapshotDetection(detection);
      setSnapshotOcr(ocr);
      useLogStore.getState().addTurn({
        role: 'system',
        text: ocr?.cleaned_text?.trim()
          ? `Vision completed: ${detection.summary} OCR text: ${ocr.cleaned_text.slice(0, 300)}`
          : `Vision completed: ${detection.summary}`,
        isFinal: true,
      });
      return { detection, ocr };
    } catch (err) {
      console.error('Camera image analysis failed:', err);
      useLogStore.getState().addTurn({
        role: 'system',
        text: `Camera image analysis failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        isFinal: true,
      });
      return null;
    } finally {
      setIsDetectingSnapshot(false);
      setIsReadingSnapshotText(false);
    }
  }, [runImageDetection, runImageOcr]);

  const openCamera = useCallback(async (options?: { sourceLabel?: string; autoDetect?: boolean }) => {
    try {
      stopVideoStream();
      setCameraError(null);
      setCameraSourceLabel(options?.sourceLabel || 'Beatrice video camera');
      setCameraAutoDetect(options?.autoDetect ?? true);
      setShowVideoCamera(true);
      setVideoSnapshot(null);
      setSnapshotDetection(null);
      setSnapshotOcr(null);
      setLiveDetection(null);
      setLiveOcr(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support camera capture.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Failed to open camera:', err);
      setCameraError(err instanceof Error ? err.message : 'Could not open camera.');
    }
  }, [stopVideoStream]);

  const openNativePhotoCamera = useCallback((sourceLabel = 'Phone camera photo', autoDetect = true) => {
    setCameraSourceLabel(sourceLabel);
    setCameraAutoDetect(autoDetect);
    setCameraError(null);
    nativePhotoInputRef.current?.click();
  }, []);

  const closeCamera = useCallback(() => {
    setShowVideoCamera(false);
    setVideoSnapshot(null);
    setSnapshotDetection(null);
    setSnapshotOcr(null);
    setLiveDetection(null);
    setLiveOcr(null);
    setCameraError(null);
    stopVideoStream();
  }, [stopVideoStream]);

  const captureSnapshot = useCallback(() => {
    const dataUrl = captureVideoFrameDataUrl();
    if (!dataUrl) return;
    setVideoSnapshot(dataUrl);
    setSnapshotDetection(null);
    setSnapshotOcr(null);
    useCctvVisionStore.getState().setLastFrame(dataUrl);
    stopVideoStream();
  }, [captureVideoFrameDataUrl, stopVideoStream]);

  const detectSnapshotObjects = useCallback(async () => {
    if (!videoSnapshot) return null;
    const processed = await processCapturedImage(videoSnapshot, `${cameraSourceLabel} snapshot`);
    return processed?.detection || null;
  }, [cameraSourceLabel, processCapturedImage, videoSnapshot]);

  const analyzeSnapshot = useCallback(async () => {
    if (!videoSnapshot || !connected) return;
    setIsAnalyzingSnapshot(true);
    try {
      const detection = snapshotDetection || await detectSnapshotObjects();
      const ocr = snapshotOcr || (videoSnapshot ? (await runImageOcr(videoSnapshot, `${cameraSourceLabel} snapshot`).catch(() => null)) : null);
      const detectionContext = detection
        ? `\n\n[OBJECT DETECTION]: ${detection.summary}\nDetections: ${detection.detections.map(item => `${item.label} ${Math.round(item.score * 100)}% box=${Math.round(item.box.x)},${Math.round(item.box.y)},${Math.round(item.box.width)},${Math.round(item.box.height)}`).join('; ')}`
        : '';
      const ocrContext = ocr?.cleaned_text?.trim()
        ? `\n\n[OCR TEXT]: ${ocr.cleaned_text.slice(0, 3000)}`
        : '';
      // Send the snapshot as a visual analysis request to Gemini via the live session
      client.send([{
        text: `[VISUAL ANALYSIS]: Analyze this image in detail. Describe what you see, identify any objects, readable text, people, or notable elements. Be thorough and natural.${detectionContext}${ocrContext}`,
        inlineData: {
          mimeType: 'image/jpeg',
          data: videoSnapshot.split(',')[1], // Remove the data:image/jpeg;base64, prefix
        },
      }], true);
      useLogStore.getState().addTurn({
        role: 'system',
        text: 'Sent snapshot for visual analysis via voice session.',
        isFinal: true,
      });
    } catch (err) {
      console.error('Failed to analyze snapshot:', err);
    }
    setIsAnalyzingSnapshot(false);
    closeCamera();
  }, [cameraSourceLabel, videoSnapshot, connected, client, closeCamera, detectSnapshotObjects, runImageOcr, snapshotDetection, snapshotOcr]);

  const handleNativePhotoCapture = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      const sourceLabel = cameraSourceLabel || file.name || 'Phone camera photo';
      setShowVideoCamera(true);
      setVideoSnapshot(dataUrl);
      setSnapshotDetection(null);
      setSnapshotOcr(null);
      setLiveDetection(null);
      setLiveOcr(null);
      useCctvVisionStore.getState().setLastFrame(dataUrl);
      if (cameraAutoDetect) {
        await processCapturedImage(dataUrl, sourceLabel);
      }
    } catch (err) {
      console.error('Failed to process phone photo:', err);
      setCameraError(err instanceof Error ? err.message : 'Could not process the selected photo.');
    }
  }, [cameraAutoDetect, cameraSourceLabel, processCapturedImage]);

  const runLiveVisionTick = useCallback(async () => {
    if (!cameraAutoDetect || !showVideoCamera || videoSnapshot || liveVisionBusyRef.current) return;
    const frame = captureVideoFrameDataUrl();
    if (!frame) return;
    liveVisionBusyRef.current = true;
    setIsRunningLiveVision(true);
    try {
      const result = await runImageDetection(frame, `${cameraSourceLabel} live frame`);
      setLiveDetection(result);
    } catch (err) {
      console.warn('Live object detection skipped:', err);
    } finally {
      liveVisionBusyRef.current = false;
      setIsRunningLiveVision(false);
    }
  }, [cameraAutoDetect, cameraSourceLabel, captureVideoFrameDataUrl, runImageDetection, showVideoCamera, videoSnapshot]);

  const runLiveOcrTick = useCallback(async () => {
    if (!cameraAutoDetect || !showVideoCamera || videoSnapshot || liveOcrBusyRef.current) return;
    const frame = captureVideoFrameDataUrl();
    if (!frame) return;
    liveOcrBusyRef.current = true;
    setIsRunningLiveOcr(true);
    try {
      const ocr = await runImageOcr(frame, `${cameraSourceLabel} live OCR`);
      setLiveOcr(ocr);
    } catch (err) {
      console.warn('Live OCR skipped:', err);
    } finally {
      liveOcrBusyRef.current = false;
      setIsRunningLiveOcr(false);
    }
  }, [cameraAutoDetect, cameraSourceLabel, captureVideoFrameDataUrl, runImageOcr, showVideoCamera, videoSnapshot]);

  useEffect(() => {
    if (showVideoCamera && videoRef.current && videoStreamRef.current) {
      videoRef.current.srcObject = videoStreamRef.current;
    }
  }, [showVideoCamera]);

  useEffect(() => {
    if (!cameraToolMode || cameraToolRequestId === handledCameraToolRequestRef.current) return;
    handledCameraToolRequestRef.current = cameraToolRequestId;
    if (cameraToolMode === 'video') {
      void openCamera({
        sourceLabel: cameraToolSourceLabel,
        autoDetect: cameraToolAutoDetect,
      });
    } else {
      openNativePhotoCamera(cameraToolSourceLabel, cameraToolAutoDetect);
    }
    clearCameraToolRequest();
  }, [
    cameraToolAutoDetect,
    cameraToolMode,
    cameraToolRequestId,
    cameraToolSourceLabel,
    clearCameraToolRequest,
    openCamera,
    openNativePhotoCamera,
  ]);

  useEffect(() => {
    if (!showVideoCamera || videoSnapshot || !cameraAutoDetect) return;
    const firstTick = window.setTimeout(() => {
      void runLiveVisionTick();
      void runLiveOcrTick();
    }, 900);
    const visionInterval = window.setInterval(() => {
      void runLiveVisionTick();
    }, 2200);
    const ocrInterval = window.setInterval(() => {
      void runLiveOcrTick();
    }, 6500);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(visionInterval);
      window.clearInterval(ocrInterval);
    };
  }, [cameraAutoDetect, runLiveOcrTick, runLiveVisionTick, showVideoCamera, videoSnapshot]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopVideoStream();
    };
  }, [stopVideoStream]);

  // ─── Processing content for main view ───
  const {
    isProcessingTask,
    currentTaskInfo,
    processingConsole,
    processingMessages,
  } = useProcessingStore();
  const showProcessing = isGeneratingTask || isProcessingTask;

  const renderProcessingContent = () => {
    if (!showProcessing) return null;

    const consoleState = processingConsole;
    const taskInfo = currentTaskInfo;
    const serviceKeys = taskInfo ? getProcessingServiceKeys(taskInfo) : [];
    const steps = consoleState?.steps ?? [];
    const currentStep = steps.find(s => s.status === 'running');
    const completedSteps = steps.filter(s => s.status === 'done').length;
    const totalSteps = steps.length;

    return (
      <div className="workspace-processing-shell" style={{ width: 'min(580px, 90vw)', maxHeight: '60vh', overflowY: 'auto' }}>
        {/* Header */}
        <div className="workspace-processing-header">
          <div>
            <div className="workspace-processing-title">
              {taskInfo?.label || 'Processing Task'}
            </div>
            <div className="workspace-processing-subtitle">
              {totalSteps > 0 ? `${completedSteps}/${totalSteps} steps completed` : 'Working...'}
            </div>
          </div>
          <div className="workspace-processing-status">
            <span className="workspace-status-dot" />
            <span className="workspace-status-text">
              {currentStep?.label || consoleState?.currentProcess || 'Working...'}
            </span>
          </div>
        </div>

        {/* Loading bar */}
        <div className="task-loading-bar" />

        {/* Current process */}
        {currentStep && (
          <div className="workspace-current-process">
            <div className="workspace-current-process-label">Current Step</div>
            <div className="workspace-current-process-value">{currentStep.label}</div>
            {currentStep.detail && (
              <div className="workspace-current-process-note">{currentStep.detail}</div>
            )}
          </div>
        )}

        {/* Service cards */}
        {serviceKeys.length > 0 && (
          <div className="workspace-processing-grid">
            {serviceKeys.map((key) => {
              const visual = PROCESSING_SERVICE_VISUALS[key as ProcessingServiceKey];
              if (!visual) return null;
              return (
                <div key={key} className="workspace-service-card" style={{ '--service-accent': visual.accent } as React.CSSProperties}>
                  <div className="workspace-service-visual">
                    <i className={visual.icon} style={{ fontSize: '22px', color: visual.accent }}></i>
                  </div>
                  <div className="workspace-service-title">{visual.title}</div>
                  <div className="workspace-service-scope">{visual.scope}</div>
                  <div className="workspace-service-loading">{visual.loadingLabel}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Steps panel */}
        {steps.length > 0 && (
          <div className="workspace-steps-panel">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`workspace-step-row ${
                  step.status === 'running' ? 'workspace-step-running' :
                  step.status === 'done' ? 'workspace-step-done' :
                  step.status === 'skipped' ? 'workspace-step-skipped' :
                  step.status === 'error' ? 'workspace-step-error' : ''
                }`}
              >
                <div className="workspace-step-indicator" />
                <div>
                  <div className="workspace-step-label">{step.label}</div>
                  {step.detail && <div className="workspace-step-detail">{step.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Result */}
        {taskResult && (
          <div className="workspace-live-result">
            <div className="workspace-live-result-badge">✓ Task Complete</div>
            <div style={{ display: 'grid', gap: '10px', fontSize: '14px', lineHeight: 1.6 }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 600 }}>{taskResult.title}</div>
                <div style={{ color: '#cbd5e1' }}>{taskResult.message}</div>
              </div>
              {taskResult.artifactType === 'image' && (taskResult.previewData || taskResult.downloadData) && (
                <img
                  src={taskResult.previewData || taskResult.downloadData}
                  alt={taskResult.title}
                  style={{
                    width: '100%',
                    maxHeight: '260px',
                    objectFit: 'contain',
                    borderRadius: '14px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.04)',
                  }}
                />
              )}
              {taskResult.artifactType === 'video' && taskResult.previewData && (
                <a
                  href={taskResult.previewData}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: '#93c5fd',
                    textDecoration: 'none',
                    border: '1px solid rgba(147,197,253,0.25)',
                    borderRadius: '9999px',
                    padding: '8px 12px',
                    width: 'max-content',
                    maxWidth: '100%',
                  }}
                >
                  Open generated video
                </a>
              )}
              {taskResult.downloadData && (
                <a
                  href={taskResult.downloadData}
                  download={taskResult.downloadFilename}
                  target={taskResult.downloadData.startsWith('data:') ? undefined : '_blank'}
                  rel={taskResult.downloadData.startsWith('data:') ? undefined : 'noreferrer'}
                  style={{ color: '#c4b5fd', textDecoration: 'none', fontSize: '13px' }}
                >
                  {taskResult.downloadFilename ? `Download ${taskResult.downloadFilename}` : 'Open result'}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <ControlTray hidden />
      {/* Ambient Background Glows */}
      <div style={styles.ambientGlow1} />
      <div style={styles.ambientGlow2} />

      {/* Main Voice Screen */}
      <div style={styles.voiceScreen}>
        {/* Processing content (shown when task is running) */}
        {renderProcessingContent()}

        {/* Center Orb with Audio Visualizer - shown when NOT processing */}
        {!showProcessing && (
          <div style={styles.centerOrbSection}>
            <div style={styles.centerOrbWrapper}>
              <div
                className={c('glowing-orb', {
                  'animate-pulse-glow': connected,
                })}
                style={centerOrbStyle}
              />
              <div style={styles.centerOrbVisualizer}>
                <AudioVisualizer />
              </div>
            </div>
          </div>
        )}

        {/* Transcript - always shown for voice continuity */}
        <div style={styles.transcriptSection}>
          {currentDocument && !showProcessing ? (
            <div style={styles.docChip}>
              <i className="ph-fill ph-docs" style={styles.docIcon}></i>
              <div>
                <strong style={styles.docTitle}>{currentDocument.title}</strong>
                <span style={styles.docSummary}>{currentDocument.analysis.short_summary}</span>
              </div>
            </div>
          ) : null}
          <p style={styles.transcriptText}>
            {liveTranscript}
          </p>
          {connected && (
            <p style={styles.listeningText}>
              <span style={styles.pulseDot} /> Beatrice is {statusLabel.toLowerCase()}...
            </p>
          )}
        </div>
      </div>


      {/* Bottom Controls */}
      <div style={styles.bottomControls}>
        <input
          ref={nativePhotoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleNativePhotoCapture}
          style={{ display: 'none' }}
        />
        <button
          style={styles.glassCircleBtn}
          onClick={() => setSpeakerMuted(!speakerMuted)}
          title="Speaker"
        >
          <i
            className={speakerMuted ? 'ph ph-speaker-simple-x' : 'ph ph-speaker-high'}
            style={styles.icon}
          ></i>
        </button>

        <button
          style={styles.glassCircleBtn}
          onClick={() => openCamera({ sourceLabel: 'Browser video camera', autoDetect: true })}
          title="Open browser video camera with live detection and OCR"
        >
          <i className="ph ph-video-camera" style={styles.icon}></i>
        </button>

        <button
          style={styles.glassCircleBtn}
          onClick={() => openNativePhotoCamera('Phone camera photo', true)}
          title="Take image with phone camera"
        >
          <i className="ph ph-camera" style={styles.icon}></i>
        </button>

        <button
          style={styles.glassCircleBtn}
          onClick={toggleChat}
          title={isChatOpen ? 'Close conversation' : 'Open conversation'}
        >
          <i className={isChatOpen ? 'ph ph-x' : 'ph ph-chat-teardrop-text'} style={styles.icon}></i>
        </button>

        {/* Main Mic Button with Audio Visualizer */}
        <div style={styles.micButtonWrapper}>
          {connected && micLevel > 0.02 && (
            <div style={styles.micVisualizerRing}>
              <AudioVisualizer />
            </div>
          )}
          <button
            style={{
              ...styles.micFab,
              ...(micPermission === 'requesting' ? styles.micFabRequesting : {}),
            }}
            onClick={handleMicToggle}
            disabled={micPermission === 'requesting'}
            title={connected ? 'Stop session' : 'Start session'}
          >
            {micPermission === 'requesting' ? (
              <i className="ph ph-hourglass" style={styles.micIcon}></i>
            ) : (
              <i className={connected ? "ph-fill ph-stop" : "ph-fill ph-microphone"} style={styles.micIcon}></i>
            )}
          </button>
        </div>
      </div>

      {/* Chat Drawer */}
      <div
        className={c('drawer chat-drawer', { open: isChatOpen })}
        style={{
          ...styles.chatDrawer,
          transform: isChatOpen ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          opacity: isChatOpen ? 1 : 0,
          pointerEvents: isChatOpen ? 'auto' : 'none',
        }}
        aria-hidden={!isChatOpen}
      >
        <div style={styles.drawerHeader}>
          <h2 style={styles.drawerTitle}>Conversation</h2>
          <button style={styles.closeBtn} onClick={toggleChat}>
            <i className="ph ph-x" style={styles.icon}></i>
          </button>
        </div>

        <div
          style={styles.chatHistory}
          ref={scrollRef}
          onScroll={handleTranscriptScroll}
        >
          {/* Test Log Viewer Button */}
          <button
            style={styles.testLogBtn}
            onClick={() => setShowTestLogViewer(true)}
          >
            <i className="ph ph-clipboard-text" style={styles.icon}></i>
            {isLogging ? 'Recording...' : 'Test Logs'}
          </button>

          {turns.length === 0 ? (
            <div style={styles.emptyState}>Start a voice session to see the conversation here.</div>
          ) : (
            turns.map((t, i) => (
              <div
                key={i}
                style={{
                  ...styles.chatBubble,
                  ...(t.role === 'user' ? styles.userBubble : styles.assistantBubble),
                  ...(!t.isFinal ? styles.interimBubble : {}),
                }}
              >
                <div style={styles.bubbleContent}>
                  {renderContent(t.text)}
                </div>
                {/* Copy Button */}
                {t.isFinal && (
                  <button
                    style={{
                      ...styles.bubbleCopyBtn,
                      ...(copiedId === i ? styles.bubbleCopyBtnCopied : {}),
                    }}
                    onClick={async () => {
                      const success = await copyToClipboard(t.text);
                      if (success) {
                        setCopiedId(i);
                        setTimeout(() => setCopiedId(null), 2000);
                      }
                    }}
                    title="Copy message"
                  >
                    <i className={copiedId === i ? "ph-fill ph-check" : "ph ph-copy"} style={styles.smallIcon}></i>
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div style={styles.chatInputArea}>
          <input
            type="text"
            value={manualMessage}
            onChange={event => setManualMessage(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                handleManualSend();
              }
            }}
            placeholder={connected ? 'Message Beatrice...' : 'Start the session to chat'}
            disabled={!connected}
            style={styles.chatInput}
          />
          <button
            style={{
              ...styles.sendBtn,
              opacity: connected ? 1 : 0.5,
              cursor: connected ? 'pointer' : 'not-allowed',
            }}
            onClick={handleManualSend}
            disabled={!connected}
          >
            <i className="ph-fill ph-arrow-up" style={styles.sendIcon}></i>
          </button>
        </div>
      </div>

      {/* Video Camera Overlay */}
      {showVideoCamera && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Hidden canvas for capturing snapshots */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div style={{
            width: 'min(90vw, 560px)',
            marginBottom: '14px',
            color: '#e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center',
            fontSize: '12px',
          }}>
            <span>{cameraSourceLabel}</span>
            <span style={{ color: '#a7f3d0' }}>
              {cameraAutoDetect ? 'Live boxes + OCR' : 'Camera ready'}
            </span>
          </div>
          {cameraError ? (
            <div style={{
              width: 'min(90vw, 560px)',
              marginBottom: '14px',
              padding: '10px 12px',
              borderRadius: '12px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fecaca',
              fontSize: '12px',
              lineHeight: 1.5,
            }}>
              {cameraError}
            </div>
          ) : null}

          {videoSnapshot ? (
            /* Snapshot preview */
            <div style={{ textAlign: 'center' }}>
              <img
                src={snapshotDetection?.annotatedDataUrl || videoSnapshot}
                alt="Snapshot"
                style={{
                  maxWidth: 'min(90vw, 500px)',
                  maxHeight: '60vh',
                  borderRadius: '16px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  marginBottom: '24px',
                }}
              />
              {snapshotDetection ? (
                <div style={{
                  maxWidth: 'min(90vw, 500px)',
                  margin: '0 auto 18px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#e5e7eb',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  textAlign: 'left',
                }}>
                  <strong style={{ color: '#fff' }}>Object detection:</strong> {snapshotDetection.summary}
                </div>
              ) : null}
              {formatOcrPreview(snapshotOcr) ? (
                <div style={{
                  maxWidth: 'min(90vw, 500px)',
                  margin: '0 auto 18px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'rgba(14,165,233,0.12)',
                  border: '1px solid rgba(14,165,233,0.3)',
                  color: '#dbeafe',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  textAlign: 'left',
                }}>
                  <strong style={{ color: '#fff' }}>OCR:</strong> {formatOcrPreview(snapshotOcr)}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setVideoSnapshot(null); void openCamera({ sourceLabel: cameraSourceLabel, autoDetect: cameraAutoDetect }); }}
                  style={{
                    padding: '12px 24px', borderRadius: '9999px',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: 'white', fontSize: '14px', cursor: 'pointer',
                  }}
                >
                  <i className="ph ph-arrow-left" style={{ marginRight: '8px' }}></i>
                  Retake
                </button>
                <button
                  onClick={detectSnapshotObjects}
                  disabled={isDetectingSnapshot || isReadingSnapshotText}
                  style={{
                    padding: '12px 24px', borderRadius: '9999px',
                    background: 'rgba(34,197,94,0.14)',
                    border: '1px solid rgba(34,197,94,0.35)',
                    color: 'white', fontSize: '14px', cursor: isDetectingSnapshot || isReadingSnapshotText ? 'wait' : 'pointer',
                  }}
                >
                  {isDetectingSnapshot || isReadingSnapshotText ? (
                    <><i className="ph ph-spinner ph-spin" style={{ marginRight: '8px' }}></i>Reading...</>
                  ) : (
                    <><i className="ph ph-bounding-box" style={{ marginRight: '8px' }}></i>Detect + OCR</>
                  )}
                </button>
                <button
                  onClick={analyzeSnapshot}
                  disabled={isAnalyzingSnapshot || !connected}
                  style={{
                    padding: '12px 24px', borderRadius: '9999px',
                    background: isAnalyzingSnapshot ? 'rgba(217,70,239,0.5)' : 'linear-gradient(to bottom, #f0abfc, #7e22ce)',
                    border: '2px solid rgba(255,255,255,0.2)',
                    color: 'white', fontSize: '14px', cursor: 'pointer',
                    opacity: connected ? 1 : 0.5,
                  }}
                >
                  {isAnalyzingSnapshot ? (
                    <><i className="ph ph-spinner ph-spin" style={{ marginRight: '8px' }}></i>Analyzing...</>
                  ) : (
                    <><i className="ph-fill ph-magic-wand" style={{ marginRight: '8px' }}></i>Analyze with Beatrice</>
                  )}
                </button>
              </div>
              {!connected && (
                <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: '16px' }}>
                  Start a voice session first to analyze snapshots with Beatrice.
                </p>
              )}
            </div>
          ) : (
            /* Live camera view */
            <div style={{ textAlign: 'center' }}>
              <div style={{
                position: 'relative',
                width: 'min(90vw, 560px)',
                maxHeight: '60vh',
                borderRadius: '16px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.2)',
                marginBottom: '14px',
                background: '#050505',
              }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  style={{
                    display: 'block',
                    width: '100%',
                    maxHeight: '60vh',
                    objectFit: 'contain',
                  }}
                />
                {liveDetection?.annotatedDataUrl ? (
                  <img
                    src={liveDetection.annotatedDataUrl}
                    alt=""
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      opacity: 0.88,
                      pointerEvents: 'none',
                    }}
                  />
                ) : null}
                <div style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}>
                  <span style={{
                    padding: '6px 9px',
                    borderRadius: '9999px',
                    background: 'rgba(0,0,0,0.55)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: '#d1fae5',
                    fontSize: '11px',
                  }}>
                    {isRunningLiveVision ? 'Detecting...' : `${liveDetection?.detections.length || 0} boxes`}
                  </span>
                  <span style={{
                    padding: '6px 9px',
                    borderRadius: '9999px',
                    background: 'rgba(0,0,0,0.55)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: '#bfdbfe',
                    fontSize: '11px',
                  }}>
                    {isRunningLiveOcr ? 'OCR...' : (formatOcrPreview(liveOcr) ? 'Text found' : 'OCR ready')}
                  </span>
                </div>
              </div>
              {(liveDetection || formatOcrPreview(liveOcr)) ? (
                <div style={{
                  width: 'min(90vw, 560px)',
                  margin: '0 auto 18px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#e5e7eb',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  textAlign: 'left',
                }}>
                  {liveDetection ? <div><strong style={{ color: '#fff' }}>Objects:</strong> {liveDetection.summary}</div> : null}
                  {formatOcrPreview(liveOcr) ? <div style={{ marginTop: liveDetection ? '8px' : 0 }}><strong style={{ color: '#fff' }}>OCR:</strong> {formatOcrPreview(liveOcr)}</div> : null}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                <button
                  onClick={closeCamera}
                  style={{
                    padding: '12px 24px', borderRadius: '9999px',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: 'white', fontSize: '14px', cursor: 'pointer',
                  }}
                >
                  <i className="ph ph-x" style={{ marginRight: '8px' }}></i>
                  Cancel
                </button>
                <button
                  onClick={captureSnapshot}
                  style={{
                    width: '64px', height: '64px', borderRadius: '50%',
                    background: 'white',
                    border: '4px solid rgba(255,255,255,0.5)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <div style={{
                    width: '48px', height: '48px', borderRadius: '50%',
                    border: '2px solid #333',
                  }} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showPopUp && <PopUp onClose={handleClosePopUp} />}

      {/* Test Log Viewer Modal */}
      <TestLogViewer 
        isOpen={showTestLogViewer} 
        onClose={() => setShowTestLogViewer(false)} 
      />
    </>
  );
}

// Styles for glassmorphism design
const styles: Record<string, React.CSSProperties> = {
  ambientGlow1: {
    position: 'fixed',
    top: '20%',
    left: '10%',
    width: '300px',
    height: '300px',
    background: 'rgba(168, 85, 247, 0.2)',
    borderRadius: '50%',
    filter: 'blur(80px)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  ambientGlow2: {
    position: 'fixed',
    bottom: '10%',
    right: '10%',
    width: '250px',
    height: '250px',
    background: 'rgba(236, 72, 153, 0.15)',
    borderRadius: '50%',
    filter: 'blur(60px)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  topNav: {
    position: 'fixed',
    top: '24px',
    left: '24px',
    right: '24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 100,
  },
  glassCircleBtn: {
    width: '52px',
    height: '52px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    color: 'white',
  },
  icon: {
    fontSize: '22px',
    color: '#9ca3af',
  },
  brandPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '9999px',
    padding: '8px 16px',
  },
  brandText: {
    fontSize: '14px',
    fontWeight: 500,
    color: 'white',
  },
  betaBadge: {
    fontSize: '10px',
    color: '#f0abfc',
    background: 'rgba(217, 70, 239, 0.2)',
    border: '1px solid rgba(217, 70, 239, 0.3)',
    borderRadius: '9999px',
    padding: '2px 8px',
  },
  voiceScreen: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    padding: '100px 24px 200px',
  },
  orbSection: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orb: {
    width: '180px',
    height: '180px',
  },
  // Center orb styles (when not processing)
  centerOrbSection: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '200px',
  },
  centerOrbWrapper: {
    position: 'relative',
    width: '180px',
    height: '180px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerOrb: {
    width: '180px',
    height: '180px',
    position: 'absolute',
  },
  centerOrbVisualizer: {
    position: 'absolute',
    top: '-12px',
    left: '-12px',
    width: '204px',
    height: '204px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: '50%',
    opacity: 0.7,
  },
  transcriptSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    maxWidth: '500px',
    textAlign: 'center',
  },
  docChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '16px',
    padding: '12px 16px',
    fontSize: '13px',
  },
  docIcon: {
    fontSize: '20px',
    color: '#d946ef',
  },
  docTitle: {
    display: 'block',
    color: 'white',
    marginBottom: '4px',
  },
  docSummary: {
    display: 'block',
    color: '#9ca3af',
    fontSize: '12px',
  },
  transcriptText: {
    fontSize: '17px',
    lineHeight: 1.6,
    color: '#e5e7eb',
    fontWeight: 300,
  },
  listeningText: {
    fontSize: '13px',
    color: '#9ca3af',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#d946ef',
    animation: 'pulse 2s infinite',
  },
  bottomControls: {
    position: 'fixed',
    bottom: '48px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    width: 'min(92vw, 372px)',
    zIndex: 100,
  },
  micFab: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    background: 'linear-gradient(to bottom, #f0abfc, #7e22ce)',
    border: '2px solid rgba(255, 255, 255, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 0 24px rgba(217, 70, 239, 0.45)',
    transition: 'transform 0.2s ease',
  },
  micFabRequesting: {
    background: 'rgba(255, 255, 255, 0.1)',
    boxShadow: 'none',
  },
  micIcon: {
    fontSize: '22px',
    color: 'white',
  },
  // Mic button with visualizer ring
  micButtonWrapper: {
    position: 'relative',
    width: '64px',
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micVisualizerRing: {
    position: 'absolute',
    top: '-8px',
    left: '-8px',
    width: '80px',
    height: '80px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: '50%',
    opacity: 0.8,
    pointerEvents: 'none',
  },
  chatToggleBtn: {
    position: 'fixed',
    bottom: '48px',
    right: '24px',
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 100,
    color: 'white',
  },
  chatDrawer: {
    position: 'fixed',
    top: '0',
    right: '0',
    bottom: '0',
    width: 'min(420px, 100vw)',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(10, 10, 10, 0.95)',
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
    borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '-24px 0 80px rgba(0, 0, 0, 0.45)',
    transition: 'transform 0.28s ease, opacity 0.2s ease',
    zIndex: 120,
  },
  drawerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  },
  drawerTitle: {
    fontSize: '16px',
    fontWeight: 500,
    color: 'white',
  },
  closeBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'white',
  },
  chatHistory: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  chatBubble: {
    maxWidth: '85%',
    padding: '16px 20px',
    borderRadius: '20px',
    fontSize: '14px',
    lineHeight: 1.5,
  },
  userBubble: {
    alignSelf: 'flex-end',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderBottomRightRadius: '4px',
    color: 'white',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    background: 'rgba(217, 70, 239, 0.1)',
    border: '1px solid rgba(217, 70, 239, 0.2)',
    borderBottomLeftRadius: '4px',
    color: '#e5e7eb',
  },
  interimBubble: {
    opacity: 0.7,
  },
  bubbleContent: {
    flex: 1,
  },
  bubbleCopyBtn: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#9ca3af',
    marginLeft: '12px',
    alignSelf: 'flex-end',
    transition: 'all 0.2s ease',
    opacity: 0.6,
  },
  bubbleCopyBtnCopied: {
    background: '#10b981',
    color: 'white',
    opacity: 1,
  },
  smallIcon: {
    fontSize: '14px',
  },
  testLogBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '10px 16px',
    background: 'rgba(217, 70, 239, 0.2)',
    border: '1px solid rgba(217, 70, 239, 0.3)',
    borderRadius: '999px',
    color: '#f0abfc',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    alignSelf: 'center',
    marginBottom: '8px',
  },
  emptyState: {
    textAlign: 'center',
    color: '#6b7280',
    padding: '40px 20px',
  },
  chatInputArea: {
    display: 'flex',
    gap: '12px',
    padding: '16px 24px',
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  chatInput: {
    flex: 1,
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '9999px',
    padding: '12px 20px',
    color: 'white',
    fontSize: '14px',
    outline: 'none',
  },
  sendBtn: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: '#d946ef',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  sendIcon: {
    fontSize: '18px',
    color: 'white',
  },
};
