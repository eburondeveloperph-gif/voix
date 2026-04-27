/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GenAILiveClient } from '../../lib/genai-live-client';
import { LiveConnectConfig, Modality, LiveServerToolCall } from '@google/genai';
import { AudioStreamer } from '../../lib/audio-streamer';
import { audioContext } from '../../lib/utils';
import VolMeterWorket from '../../lib/worklets/vol-meter';
import { useLogStore, useProcessingStore, useSettings, useUI } from '@/lib/state';
import { db } from '../../lib/firebase';
import { serverTimestamp } from 'firebase/firestore';
import { safeAddDoc } from '@/lib/firestore-safe';
import { useUserProfileStore } from '@/lib/user-profile-store';
import { getRuntimeUserIdentity } from '@/lib/user-profile';
import {
  executeToolCall,
  formatToolResultSpeech,
} from '@/lib/tool-executor';
import {
  PROCESSING_SERVICE_VISUALS,
  createProcessingConsole,
  getProcessingTaskInfoFromToolName,
  updateProcessingStep,
} from '@/lib/processing-console';
import { buildConversationContext, contextToSystemInstruction } from '@/lib/conversation-context';
import { getBeatriceOpening, type TaskInfo } from '@/lib/task-engagement';
import { ConversationMemory } from '@/lib/conversation-memory';

export type UseLiveApiResults = {
  client: GenAILiveClient;
  setConfig: (config: LiveConnectConfig) => void;
  config: LiveConnectConfig;

  connect: () => Promise<void>;
  disconnect: () => void;
  connected: boolean;

  volume: number;
  speakerMuted: boolean;
  setSpeakerMuted: (muted: boolean) => void;
};

export function useLiveApi({
  apiKey,
}: {
  apiKey: string;
}): UseLiveApiResults {
  const { model } = useSettings();
  const client = useMemo(() => new GenAILiveClient(apiKey, model), [apiKey, model]);

  const audioStreamerRef = useRef<AudioStreamer | null>(null);

  const [volume, setVolume] = useState(0);
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<LiveConnectConfig>({});
  const [speakerMuted, setSpeakerMuted] = useState(false);

  const ensureAudioStreamer = useCallback(async () => {
    if (audioStreamerRef.current) {
      return audioStreamerRef.current;
    }

    const audioCtx = await audioContext({ id: 'audio-out' });
    const streamer = new AudioStreamer(audioCtx);
    streamer.gainNode.gain.setValueAtTime(
      speakerMuted ? 0 : 1,
      audioCtx.currentTime,
    );

    await streamer.addWorklet<any>('vumeter-out', VolMeterWorket, (ev: any) => {
      setVolume(ev.data.volume);
    });

    audioStreamerRef.current = streamer;
    return streamer;
  }, [speakerMuted]);

  // register audio for streaming server -> speakers
  useEffect(() => {
    ensureAudioStreamer().catch(err => {
      console.error('Error preparing audio output:', err);
    });
  }, [ensureAudioStreamer]);

  useEffect(() => {
    if (!audioStreamerRef.current) return;
    audioStreamerRef.current.gainNode.gain.setValueAtTime(
      speakerMuted ? 0 : 1,
      audioStreamerRef.current.context.currentTime,
    );
  }, [speakerMuted, connected]);

  useEffect(() => {
    let silenceTimer: ReturnType<typeof setInterval> | null = null;
    let lastActivityTime = Date.now();

    const resetSilenceTimer = () => {
      lastActivityTime = Date.now();
    };

    const onOpen = () => {
      setConnected(true);
      ensureAudioStreamer()
        .then(streamer => streamer.resume())
        .catch(err => {
          console.error('Error resuming audio output:', err);
        });
      resetSilenceTimer();
      silenceTimer = setInterval(() => {
        if (Date.now() - lastActivityTime > 45000) {
          client.send([{
            text: 'System command: There has been a long pause. If it feels socially useful, check in with one short natural sentence. If the silence feels intentional, stay quiet.',
          }], true);
          resetSilenceTimer();
        }
      }, 1000);
    };

    const onClose = () => {
      setConnected(false);
      if (silenceTimer) clearInterval(silenceTimer);
    };

    const stopAudioStreamer = () => {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.stop();
      }
      setVolume(0);
      resetSilenceTimer();
    };

    const onAudio = (data: ArrayBuffer) => {
      ensureAudioStreamer()
        .then(streamer => {
          streamer.addPCM16(new Uint8Array(data));
          resetSilenceTimer();
        })
        .catch(err => {
          console.error('Error handling output audio:', err);
        });
    };

    // Bind event listeners
    client.on('open', onOpen);
    client.on('close', onClose);
    client.on('interrupted', stopAudioStreamer);
    client.on('audio', onAudio);
    client.on('turncomplete', resetSilenceTimer);
    client.on('inputTranscription', resetSilenceTimer);
    client.on('outputTranscription', resetSilenceTimer);
    client.on('content', resetSilenceTimer);

    const onSetupComplete = () => {
      const profile = useUserProfileStore.getState().profile;

      // Load conversation memories asynchronously and inject them
      ConversationMemory.loadUserContext().then(memoryContext => {
        if (memoryContext) {
          client.send([{
            text: `[CONVERSATION MEMORY CONTEXT]: ${memoryContext}`,
          }], true);
        }

        // Then send the greeting
        if (profile && !profile.onboarding_completed) {
          client.send([{
            text: 'System command: A new Jo Lernout associate has joined. Ask how they would like to be addressed in one relaxed, human sentence.',
          }], true);
        } else if (profile) {
          client.send([{
            text: `System command: Connection established. Greet "${profile.preferred_address}" like a real person on a live call. Keep it one short sentence, no assistant catchphrase.`,
          }], true);
        } else {
          client.send([{ text: 'System command: Connection established. Greet the user like a real person on a live call. Keep it one short sentence, no assistant catchphrase.' }], true);
        }
      }).catch(() => {
        // Fallback: send greeting without memory context
        if (profile && !profile.onboarding_completed) {
          client.send([{
            text: 'System command: A new Jo Lernout associate has joined. Ask how they would like to be addressed in one relaxed, human sentence.',
          }], true);
        } else if (profile) {
          client.send([{
            text: `System command: Connection established. Greet "${profile.preferred_address}" like a real person on a live call. Keep it one short sentence, no assistant catchphrase.`,
          }], true);
        } else {
          client.send([{ text: 'System command: Connection established. Greet the user like a real person on a live call. Keep it one short sentence, no assistant catchphrase.' }], true);
        }
      });
      resetSilenceTimer();
    };
    client.on('setupcomplete', onSetupComplete);

    const onToolCall = async (toolCall: LiveServerToolCall) => {
      resetSilenceTimer();
      const { setGeneratingTask } = useUI.getState();
      const processingStore = useProcessingStore.getState();

      // ── Build ConversationContext before ack so Beatrice knows the full state ──
      const functionCalls = toolCall.functionCalls ?? [];
      const firstToolName = functionCalls[0]?.name ?? '';
      const firstArgs = (functionCalls[0]?.args ?? {}) as Record<string, any>;
      const context = await buildConversationContext(
        undefined, // no latest user message available here
        firstToolName,
        firstArgs,
      );
      const contextInstruction = contextToSystemInstruction(context);
      const detectedTaskInfo: TaskInfo = context.detectedIntent;

      // ── PHASE 1: Send immediate ack so Beatrice keeps talking ──
      const ackResponses: any[] = [];
      const backgroundJobs: { fc: any; args: Record<string, any>; processingTaskInfo: any }[] = [];

      for (const fc of functionCalls) {
        const args = (fc.args ?? {}) as Record<string, any>;
        const processingTaskInfo = getProcessingTaskInfoFromToolName(fc.name);

        // Log the function call trigger
        const triggerMessage = `Triggering function call: **${fc.name}**\n\`\`\`json\n${JSON.stringify(fc.args, null, 2)}\n\`\`\``;
        useLogStore.getState().addTurn({ role: 'system', text: triggerMessage, isFinal: true });

        // Sync trigger to Firebase
        try {
          await safeAddDoc(db, 'turns', {
            user_id: getRuntimeUserIdentity().userId,
            role: 'system',
            text: triggerMessage,
            timestamp: serverTimestamp(),
            type: 'tool_trigger',
          });
        } catch (e) {
          console.error('Error saving tool trigger to Firebase:', e);
        }

        // Immediate ack — unblocks Beatrice to keep speaking
        // Inject context instructions so Beatrice knows about active tasks and memory
        const ackMessage = contextInstruction
          ? `${contextInstruction}\n\nI'm on it. Let me check that now.`
          : `I'm on it. Let me check that now.`;

        ackResponses.push({
          id: fc.id,
          name: fc.name,
          response: {
            status: 'processing',
            message: ackMessage,
          },
        });

        backgroundJobs.push({ fc, args, processingTaskInfo });
      }

      // Send ack IMMEDIATELY — Beatrice can keep talking while tools run
      client.sendToolResponse({ functionResponses: ackResponses });

      // ── Engagement: Send one short Beatrice opening while the tool processes ──
      const userName = context.preferences.preferredAddress !== 'User'
        ? context.preferences.preferredAddress
        : context.userDisplayName ?? undefined;
      const openingText = getBeatriceOpening(detectedTaskInfo, userName);

      client.send([{
        text: `[ENGAGEMENT]: ${openingText}`
      }], true);

      // ── PHASE 2: Execute tools in background, inject result back ──
      // apiKey is already available from the hook parameter

      for (const { fc, args, processingTaskInfo } of backgroundJobs) {
        const initialProcessingConsole = createProcessingConsole(processingTaskInfo);
        processingStore.setCurrentTaskInfo(processingTaskInfo);
        processingStore.setProcessingConsole(initialProcessingConsole);
        processingStore.setIsProcessingTask(true);
        processingStore.setGoogleServiceResult(null);
        processingStore.setProcessingMessages([
          {
            id: `voice_tool_${fc.id}_opening`,
            text: `Running ${processingTaskInfo.label.toLowerCase()} from the live voice session.`,
            type: 'opening',
          },
        ]);
        processingStore.updateProcessingConsole(prev => {
          const next = updateProcessingStep(prev, 'route', 'done', `Matched voice tool: ${fc.name}`);
          if (!next) return next;
          return {
            ...next,
            currentProcess: `Executing voice tool ${fc.name.replace(/_/g, ' ')}`,
            statusNote: `Preparing ${next.activeServiceKeys.map(key => PROCESSING_SERVICE_VISUALS[key].title).join(' + ')}`,
          };
        });

        // Fire-and-forget: run the tool in the background
        (async () => {
          try {
            processingStore.updateProcessingConsole(prev => {
              const next = updateProcessingStep(prev, 'workspace', 'running', `Executing ${fc.name.replace(/_/g, ' ')} via background tool executor`);
              if (!next) return next;
              return {
                ...next,
                currentProcess: `Background execution: ${fc.name.replace(/_/g, ' ')}`,
                statusNote: 'Tool executor is running the API call in the background',
              };
            });

            // Execute the actual tool call via the background executor
            const responsePayload = await executeToolCall(fc.name, args);

            // Format the result into natural speech using a secondary Gemini model
            const spokenSummary = await formatToolResultSpeech(apiKey, fc.name, responsePayload);

            // Inject the formatted result back into the live session as a text message
            // This causes Beatrice to speak the result naturally
            client.send([{
              text: `[TOOL RESULT for ${fc.name}]: Say this back naturally, in your own voice: "${spokenSummary}" Use the raw facts only if needed, and do not mention tool names. Raw facts: ${JSON.stringify(responsePayload.data || {})}.`
            }], true);

            // Update processing UI
            processingStore.setGoogleServiceResult(spokenSummary);
            processingStore.updateProcessingConsole(prev => {
              let next = updateProcessingStep(prev, 'workspace', responsePayload.status === 'error' ? 'error' : 'done', spokenSummary);
              next = updateProcessingStep(next, 'model', 'done', 'Secondary model formatted result for speech');
              next = updateProcessingStep(next, 'finalize', 'done', 'Result injected into live session');
              if (!next) return next;
              return {
                ...next,
                stage: responsePayload.status === 'error' ? 'failed' : 'completed',
                currentProcess: responsePayload.status === 'error'
                  ? `Tool failed: ${fc.name.replace(/_/g, ' ')}`
                  : `Tool completed: ${fc.name.replace(/_/g, ' ')}`,
                statusNote: spokenSummary,
              };
            });
            processingStore.addProcessingMessage({
              id: `voice_tool_${fc.id}_result`,
              text: spokenSummary,
              type: 'result',
            });

            // UI result payload for the task result panel
            const resultData = responsePayload.data || {};
            const uiResultPayload: any = resultData.imageDataUrl
              ? {
                  title: 'AI Image Generated',
                  message: spokenSummary,
                  artifactType: 'image',
                  previewData: resultData.imageDataUrl,
                  downloadData: resultData.imageDataUrl,
                  downloadFilename: resultData.filename || 'generated-image.png',
                  mimeType: resultData.mimeType || 'image/png',
                }
              : {
                  title: `Task Completed: ${fc.name.replace(/_/g, ' ')}`,
                  message: spokenSummary,
                  downloadFilename: `task_${fc.name}_result.json`,
                  downloadData: JSON.stringify(responsePayload, null, 2),
                };
            useUI.getState().setTaskResult(uiResultPayload);

            // Log the response
            const responseMessage = `Function call response:\n\`\`\`json\n${JSON.stringify(responsePayload, null, 2)}\n\`\`\``;
            useLogStore.getState().addTurn({ role: 'system', text: responseMessage, isFinal: true });

            try {
              await safeAddDoc(db, 'turns', {
                user_id: getRuntimeUserIdentity().userId,
                role: 'system',
                text: responseMessage,
                timestamp: serverTimestamp(),
                type: 'tool_response',
              });
            } catch (e) {
              console.error('Error saving tool response to Firebase:', e);
            }

            // Clear processing state after a short delay
            const randomCueId = Math.floor(Math.random() * 6) + 1;
            setGeneratingTask(true, `/cue/${randomCueId}.html`);
            setGeneratingTask(false);
            window.setTimeout(() => {
              useProcessingStore.getState().clearProcessing();
            }, 2200);
          } catch (err) {
            console.error('Background tool execution failed:', err);
            processingStore.updateProcessingConsole(prev => {
              const next = updateProcessingStep(prev, 'workspace', 'error', `Background execution failed: ${err}`);
              if (!next) return next;
              return { ...next, stage: 'failed', statusNote: 'Tool execution error' };
            });
            // Still inject an error message so Beatrice can tell the user
            client.send([{
              text: `The ${fc.name.replace(/_/g, ' ')} task encountered an error. Please let the user know something went wrong and suggest they try again.`
            }], true);
            window.setTimeout(() => {
              useProcessingStore.getState().clearProcessing();
            }, 2200);
          }
        })();
      }
    };

    client.on('toolcall', onToolCall);

    return () => {
      // Clean up event listeners
      client.off('open', onOpen);
      client.off('close', onClose);
      client.off('interrupted', stopAudioStreamer);
      client.off('audio', onAudio);
      client.off('setupcomplete', onSetupComplete);
      client.off('toolcall', onToolCall);
      client.off('turncomplete', resetSilenceTimer);
      client.off('inputTranscription', resetSilenceTimer);
      client.off('outputTranscription', resetSilenceTimer);
      client.off('content', resetSilenceTimer);
      if (silenceTimer) clearInterval(silenceTimer);
    };
  }, [client, ensureAudioStreamer]);

  const connect = useCallback(async () => {
    if (!config) {
      throw new Error('config has not been set');
    }
    const streamer = await ensureAudioStreamer();
    await streamer.resume();
    client.disconnect();
    await client.connect(config);
  }, [client, config, ensureAudioStreamer]);

  const disconnect = useCallback(async () => {
    client.disconnect();
    setConnected(false);
  }, [setConnected, client]);

  return {
    client,
    config,
    setConfig,
    connect,
    connected,
    disconnect,
    volume,
    speakerMuted,
    setSpeakerMuted,
  };
}
