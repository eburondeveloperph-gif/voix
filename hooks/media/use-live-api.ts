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
import { loadHistoryContextForSession } from '@/lib/conversation-history';
import { KnowledgeBase } from '@/lib/knowledge-base';
import { CORE_BEHAVIOUR_REMINDER } from '@/lib/prompts/conversational-base';

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

type ToolExecutionPayload = {
  status: string;
  message: string;
  data?: any;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getHeyGenIds = (payload: ToolExecutionPayload) => {
  const data = payload.data || {};
  return {
    sessionId: data.sessionId || data.session_id,
    videoId: data.videoId || data.video_id,
  };
};

const isHeyGenVideoStart = (toolName: string, payload: ToolExecutionPayload) => {
  const data = payload.data || {};
  return toolName === 'video_generate' && data.provider === 'heygen' && (data.sessionId || data.session_id || data.videoId || data.video_id);
};

const buildHeyGenTaskResult = (payload: ToolExecutionPayload, message: string) => {
  const data = payload.data || {};
  const videoUrl = data.videoUrl || data.video_url;
  const videoId = data.videoId || data.video_id;
  const sessionId = data.sessionId || data.session_id;
  return {
    title: videoUrl ? 'HeyGen Video Ready' : 'HeyGen Video Rendering',
    message,
    artifactType: 'video' as const,
    ...(videoUrl ? { previewData: videoUrl } : {}),
    downloadFilename: videoUrl
      ? `heygen_${videoId || 'video'}.mp4`
      : `heygen_${sessionId || videoId || 'video_job'}.json`,
    downloadData: videoUrl || JSON.stringify(payload, null, 2),
    mimeType: videoUrl ? 'video/mp4' : 'application/json',
  };
};

async function injectToolSpeech(
  client: GenAILiveClient,
  toolName: string,
  spokenSummary: string,
  payload: ToolExecutionPayload,
) {
  client.send([{
    text: `[TOOL RESULT for ${toolName}]: Say this back naturally, in your own voice: "${spokenSummary}" Use the raw facts only if needed, and do not mention tool names. Raw facts: ${JSON.stringify(payload.data || {})}.`
  }], true);
}

async function recordSystemToolResponse(payload: ToolExecutionPayload) {
  const responseMessage = `Function call response:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
  useLogStore.getState().addTurn({ role: 'system', text: responseMessage, isFinal: true });

  try {
    await safeAddDoc('turns', {
      user_id: getRuntimeUserIdentity().userId,
      role: 'system',
      text: responseMessage,
      type: 'tool_response',
    });
  } catch (e) {
    console.error('Error saving tool response to Firebase:', e);
  }
}

async function handleHeyGenVoiceVideo(
  client: GenAILiveClient,
  apiKey: string,
  initialPayload: ToolExecutionPayload,
): Promise<void> {
  const processingStore = useProcessingStore.getState();
  const initialSpeech = await formatToolResultSpeech(apiKey, 'video_generate', initialPayload);
  await injectToolSpeech(client, 'video_generate', initialSpeech, initialPayload);
  processingStore.setGoogleServiceResult(initialSpeech);
  processingStore.addProcessingMessage({
    id: `heygen_started_${Date.now()}`,
    text: initialSpeech,
    type: 'result',
  });
  useUI.getState().setTaskResult(buildHeyGenTaskResult(initialPayload, initialSpeech));
  await recordSystemToolResponse(initialPayload);

  let { sessionId, videoId } = getHeyGenIds(initialPayload);
  const pollIntervalMs = Number(initialPayload.data?.pollIntervalMs) || 10000;
  const maxWaitMs = 12 * 60 * 1000;
  const deadline = Date.now() + maxWaitMs;
  let lastStatus = String(initialPayload.data?.status || 'generating');
  let lastProgress = Number(initialPayload.data?.progress);

  processingStore.updateProcessingConsole(prev => {
    const next = updateProcessingStep(prev, 'workspace', 'running', 'HeyGen accepted the request and is rendering the video');
    if (!next) return next;
    return {
      ...next,
      stage: 'running',
      currentProcess: 'HeyGen video render in progress',
      statusNote: initialSpeech,
    };
  });

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const statusPayload = await executeToolCall('video_status', {
      sessionId,
      videoId,
    });
    const data = statusPayload.data || {};
    sessionId = data.sessionId || data.session_id || sessionId;
    videoId = data.videoId || data.video_id || videoId;
    lastStatus = data.status || statusPayload.status || lastStatus;
    lastProgress = Number(data.progress);
    const progressText = Number.isFinite(lastProgress)
      ? `${lastProgress}%`
      : lastStatus;

    processingStore.setGoogleServiceResult(statusPayload.message);
    useUI.getState().setTaskResult(buildHeyGenTaskResult(statusPayload, statusPayload.message));
    processingStore.updateProcessingConsole(prev => {
      const next = updateProcessingStep(prev, 'workspace', 'running', `HeyGen render status: ${progressText}`);
      if (!next) return next;
      return {
        ...next,
        stage: 'running',
        currentProcess: `HeyGen render status: ${progressText}`,
        statusNote: statusPayload.message,
      };
    });

    const videoUrl = data.videoUrl || data.video_url;
    if (statusPayload.status === 'success' && videoUrl) {
      const finalSpeech = await formatToolResultSpeech(apiKey, 'video_generate', statusPayload);
      await injectToolSpeech(client, 'video_generate', finalSpeech, statusPayload);
      useUI.getState().setTaskResult(buildHeyGenTaskResult(statusPayload, finalSpeech));
      processingStore.setGoogleServiceResult(finalSpeech);
      processingStore.addProcessingMessage({
        id: `heygen_ready_${Date.now()}`,
        text: finalSpeech,
        type: 'result',
      });
      processingStore.updateProcessingConsole(prev => {
        let next = updateProcessingStep(prev, 'workspace', 'done', finalSpeech);
        next = updateProcessingStep(next, 'model', 'done', 'Final video result injected into voice conversation');
        next = updateProcessingStep(next, 'finalize', 'done', 'Video artifact is ready in the workspace panel');
        if (!next) return next;
        return {
          ...next,
          stage: 'completed',
          currentProcess: 'HeyGen video ready',
          statusNote: finalSpeech,
        };
      });
      await recordSystemToolResponse(statusPayload);
      window.setTimeout(() => {
        useProcessingStore.getState().clearProcessing();
      }, 8000);
      return;
    }

    if (statusPayload.status === 'error') {
      const failureSpeech = await formatToolResultSpeech(apiKey, 'video_generate', statusPayload);
      await injectToolSpeech(client, 'video_generate', failureSpeech, statusPayload);
      processingStore.setGoogleServiceResult(failureSpeech);
      processingStore.addProcessingMessage({
        id: `heygen_failed_${Date.now()}`,
        text: failureSpeech,
        type: 'result',
      });
      processingStore.updateProcessingConsole(prev => {
        let next = updateProcessingStep(prev, 'workspace', 'error', failureSpeech);
        next = updateProcessingStep(next, 'finalize', 'done', 'Failure reported to voice conversation');
        if (!next) return next;
        return {
          ...next,
          stage: 'failed',
          currentProcess: 'HeyGen video failed',
          statusNote: failureSpeech,
        };
      });
      await recordSystemToolResponse(statusPayload);
      window.setTimeout(() => {
        useProcessingStore.getState().clearProcessing();
      }, 8000);
      return;
    }
  }

  const timeoutPayload: ToolExecutionPayload = {
    status: 'processing',
    message: 'HeyGen is still rendering this video. The workspace panel will keep the job id so you can check it again.',
    data: {
      provider: 'heygen',
      artifactType: 'video',
      sessionId,
      session_id: sessionId,
      videoId,
      video_id: videoId,
      status: lastStatus,
      progress: Number.isFinite(lastProgress) ? lastProgress : undefined,
    },
  };
  const timeoutSpeech = await formatToolResultSpeech(apiKey, 'video_generate', timeoutPayload);
  await injectToolSpeech(client, 'video_generate', timeoutSpeech, timeoutPayload);
  processingStore.setGoogleServiceResult(timeoutSpeech);
  useUI.getState().setTaskResult(buildHeyGenTaskResult(timeoutPayload, timeoutSpeech));
  await recordSystemToolResponse(timeoutPayload);
}

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
    const onOpen = () => {
      setConnected(true);
      ensureAudioStreamer()
        .then(streamer => streamer.resume())
        .catch(err => {
          console.error('Error resuming audio output:', err);
        });
    };

    const onClose = () => {
      setConnected(false);
    };

    const stopAudioStreamer = () => {
      if (audioStreamerRef.current) {
        audioStreamerRef.current.stop();
      }
      setVolume(0);
    };

    const onAudio = (data: ArrayBuffer) => {
      ensureAudioStreamer()
        .then(streamer => {
          streamer.addPCM16(new Uint8Array(data));
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

    const onSetupComplete = () => {
      const profile = useUserProfileStore.getState().profile;

      const sendGreeting = () => {
        if (profile && !profile.onboarding_completed) {
          client.send([{
            text: 'System command: A new Jo Lernout associate has joined. Ask how they would like to be addressed in one relaxed, human sentence.',
          }], true);
        } else if (profile) {
          client.send([{
            text: `System command: Connection established. Greet "${profile.preferred_address}" like a real person on a live call. Keep it one short sentence, no assistant catchphrase. If [USER HISTORY CONTEXT] mentioned an open thread, you may briefly reference it.`,
          }], true);
        } else {
          client.send([{ text: 'System command: Connection established. Greet the user like a real person on a live call. Keep it one short sentence, no assistant catchphrase.' }], true);
        }
      };

      // 0) Re-anchor on the universal conversational base. Sent first so the
      //    AI re-reads "speak like a real human" rules at every session start,
      //    regardless of which persona is active.
      try {
        client.send([{ text: CORE_BEHAVIOUR_REMINDER }], true);
      } catch (e) {
        console.warn('Core-behaviour reminder send failed:', e);
      }

      // 1) Knowledge-base table of contents (synchronous — built from local
      //    state). Sent first so it sits at the top of Beatrice's context.
      try {
        const kbBlock = KnowledgeBase.buildContextBlock();
        if (kbBlock) {
          client.send([{ text: kbBlock }], true);
        }
      } catch (e) {
        console.warn('Knowledge-base context block failed:', e);
      }

      // 2) Load explicit fact memories AND past-conversation history in parallel,
      //    then inject both before the greeting so Beatrice opens the call with
      //    memory of who they are and what was last discussed.
      Promise.allSettled([
        ConversationMemory.loadUserContext(),
        loadHistoryContextForSession({ apiKey }),
      ]).then(([memRes, histRes]) => {
        const memoryContext = memRes.status === 'fulfilled' ? memRes.value : '';
        const historyContext = histRes.status === 'fulfilled' ? histRes.value : '';

        if (memoryContext) {
          client.send([{
            text: `[CONVERSATION MEMORY CONTEXT]: ${memoryContext}`,
          }], true);
        }

        if (historyContext) {
          client.send([{
            text: historyContext,
          }], true);
        }

        sendGreeting();
      }).catch(() => {
        // Last-resort fallback: skip context, still greet
        sendGreeting();
      });
    };
    client.on('setupcomplete', onSetupComplete);

    const onToolCall = async (toolCall: LiveServerToolCall) => {
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
        const processingTaskInfo = getProcessingTaskInfoFromToolName(fc.name ?? '');

        // Log the function call trigger
        const triggerMessage = `Triggering function call: **${fc.name}**\n\`\`\`json\n${JSON.stringify(fc.args, null, 2)}\n\`\`\``;
        useLogStore.getState().addTurn({ role: 'system', text: triggerMessage, isFinal: true });

        // Sync trigger to Firebase
        try {
          await safeAddDoc('turns', {
            user_id: getRuntimeUserIdentity().userId,
            role: 'system',
            text: triggerMessage,
            type: 'tool_trigger',
          });
        } catch (e) {
          console.error('Error saving tool trigger to Firebase:', e);
        }

        // Immediate ack — unblocks Beatrice to keep speaking
        const _userName2 = context.preferences.preferredAddress !== "User"
          ? context.preferences.preferredAddress
          : context.userDisplayName ?? undefined;
        const _openingText2 = getBeatriceOpening(detectedTaskInfo, _userName2);
        // Embed the engagement opening inside the ack so Beatrice speaks
        // only ONE natural message instead of two separate texts.
        const ackMessage = contextInstruction
          ? `${contextInstruction}\n\n${_openingText2}`
          : _openingText2;

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

      // Send ack IMMEDIATELY — Beatrice can keep talking while tools run.
      // The engagement opening is embedded inside the ack, so no separate
      // text message is needed — eliminates the duplicate-speech problem.
      client.sendToolResponse({ functionResponses: ackResponses });

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
            const toolArgs = fc.name === 'video_generate'
              ? { ...args, enableBackgroundUiPoll: false }
              : args;
            const responsePayload = await executeToolCall(fc.name, toolArgs);

            if (isHeyGenVideoStart(fc.name, responsePayload)) {
              await handleHeyGenVoiceVideo(client, apiKey, responsePayload);
              return;
            }

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
              await safeAddDoc('turns', {
                user_id: getRuntimeUserIdentity().userId,
                role: 'system',
                text: responseMessage,
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
