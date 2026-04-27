import { DeepgramClient } from '@deepgram/sdk';

export type DeepgramTranscriptPayload = {
  text: string;
  isFinal: boolean;
};

export type DeepgramRealtimeSession = {
  sendBase64Pcm: (base64: string) => void;
  close: () => void;
};

type DeepgramRealtimeOptions = {
  onTranscript: (payload: DeepgramTranscriptPayload) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (error: Error | Event) => void;
  model?: string;
  language?: string;
};

const getEnv = (name: string) => {
  return (import.meta.env as Record<string, string | undefined>)[name];
};

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function createDeepgramRealtimeSession({
  onTranscript,
  onOpen,
  onClose,
  onError,
  model = getEnv('VITE_DEEPGRAM_MODEL') || 'nova-3',
  language = getEnv('VITE_DEEPGRAM_LANGUAGE') || 'multi',
}: DeepgramRealtimeOptions): Promise<DeepgramRealtimeSession> {
  const apiKey = getEnv('VITE_DEEPGRAM_API_KEY') || getEnv('DEEPGRAM_API_KEY');
  if (!apiKey) {
    throw new Error('Set VITE_DEEPGRAM_API_KEY in .env.local for Deepgram realtime STT.');
  }

  const deepgram = new DeepgramClient({ apiKey });

  // Connect to Deepgram realtime using the @deepgram/sdk v5
  const connection = await deepgram.listen.v1.createConnection({
    model,
    language,
    smart_format: true,
    interim_results: true,
    endpointing: getEnv('VITE_DEEPGRAM_ENDPOINTING_MS')
      ? Number(getEnv('VITE_DEEPGRAM_ENDPOINTING_MS'))
      : 500,
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    punctuate: true,
    vad_events: true,
  });

  let finalSegments: string[] = [];
  let opened = false;

  const emitFinalIfNeeded = () => {
    const finalText = finalSegments.join(' ').replace(/\s+/g, ' ').trim();
    if (finalText) {
      onTranscript({ text: finalText, isFinal: true });
      finalSegments = [];
    }
  };

  return new Promise<DeepgramRealtimeSession>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Deepgram SDK realtime connection timed out.'));
    }, 7000);

    connection.on('open', () => {
      window.clearTimeout(timeout);
      opened = true;
      onOpen?.();
      resolve({
        sendBase64Pcm(base64: string) {
          if (!opened) return;
          try {
            connection.send(decodeBase64ToArrayBuffer(base64));
          } catch (e) {
            // Connection may have closed
          }
        },
        close() {
          emitFinalIfNeeded();
          try {
            connection.finish();
          } catch (e) {
            // Already closed
          }
        },
      });
    });

    connection.on('error', (err: Error) => {
      window.clearTimeout(timeout);
      onError?.(err);
      reject(err);
    });

    connection.on('close', () => {
      window.clearTimeout(timeout);
      emitFinalIfNeeded();
      onClose?.(new CloseEvent('close'));
    });

    connection.on('Results', (data: any) => {
      const transcript = String(data.channel?.alternatives?.[0]?.transcript || '').trim();
      if (!transcript) return;

      const isFinalSegment = data.is_final === true;
      const speechFinal = data.speech_final === true;

      if (isFinalSegment) {
        finalSegments.push(transcript);
      }

      const displayText = (isFinalSegment ? finalSegments : [...finalSegments, transcript])
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (displayText) {
        onTranscript({ text: displayText, isFinal: speechFinal });
      }

      if (speechFinal) {
        finalSegments = [];
      }
    });

    connection.on('UtteranceEnd', () => {
      emitFinalIfNeeded();
    });

    connection.on('Warning', (warning: string) => {
      console.warn('Deepgram warning:', warning);
    });

    connection.on('Metadata', (metadata: any) => {
      // Deepgram metadata events — ignore for transcription purposes
    });
  });
}
