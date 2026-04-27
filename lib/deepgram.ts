import { DeepgramClient } from '@deepgram/sdk';

export const getDeepgramClient = () => {
  const apiKey = import.meta.env.VITE_DEEPGRAM_API_KEY || import.meta.env.DEEPGRAM_API_KEY || '6330d8d2cf4c9f1343f306f1ebc00cb36780089c';
  return new DeepgramClient({ apiKey });
};

export const createDeepgramLive = async (client: any) => {
  const apiKey = import.meta.env.VITE_DEEPGRAM_API_KEY || import.meta.env.DEEPGRAM_API_KEY || '6330d8d2cf4c9f1343f306f1ebc00cb36780089c';
  const connection = await client.listen.v1.connect({
    model: 'nova-3',
    language: 'nl-BE', // Flemish/Dutch
    smart_format: true,
    interim_results: true,
    endpointing: 300,
    Authorization: `Token ${apiKey}`,
  });

  return connection;
};
