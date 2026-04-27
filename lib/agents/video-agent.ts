/**
 * Video Agent — Handles AI video generation via HeyGen
 */
import { useUI } from '@/lib/state';
import type { AgentHandler, AgentResult } from './types';

export const handle: AgentHandler = async (toolName, args, _ctx): Promise<AgentResult> => {
  switch (toolName) {
    case 'video_generate': {
      try {
        const prompt = String(args.prompt || args.text || args.description || '').trim();
        if (!prompt) {
          return { status: 'error', message: 'Video generation needs a prompt.' };
        }

        const heygenApiKey = import.meta.env.VITE_HEYGEN_API_KEY;
        if (!heygenApiKey) {
          return { status: 'error', message: 'HeyGen API key is missing. Set VITE_HEYGEN_API_KEY to generate video.' };
        }
        const resp = await fetch('https://api.heygen.com/v3/video-agents', {
          method: 'POST',
          headers: { 'x-api-key': heygenApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        if (!resp.ok) {
          return { status: 'error', message: `HeyGen video request failed: ${resp.status} ${resp.statusText}` };
        }
        const { data } = await resp.json();
        const videoId = data.video_id;

        // Background poll for completion
        const poll = async () => {
          let completed = false;
          while (!completed) {
            await new Promise(r => setTimeout(r, 10000));
            try {
              const pollResp = await fetch(`https://api.heygen.com/v3/videos/${videoId}`, {
                headers: { 'x-api-key': heygenApiKey },
              });
              const pollData = await pollResp.json();
              if (pollData.data.status === 'completed') {
                completed = true;
                useUI.getState().setTaskResult({
                  title: 'AI Video Generated',
                  message: 'Your video is ready.',
                  artifactType: 'video',
                  previewData: pollData.data.video_url,
                  downloadFilename: `video_${videoId}.mp4`,
                  downloadData: pollData.data.video_url,
                });
              } else if (pollData.data.status === 'failed') {
                completed = true;
              }
            } catch {
              // retry on network error
            }
          }
        };
        poll();

        return { status: 'processing', message: "Video generation started. I'll notify you when it's ready.", data: { video_id: videoId, prompt } };
      } catch {
        return { status: 'error', message: 'Failed to initiate video generation.' };
      }
    }

    default:
      return { status: 'error', message: `Video agent does not support tool: ${toolName}` };
  }
};
