/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly GEMINI_API_KEY?: string;
  readonly VITE_DEEPGRAM_API_KEY?: string;
  readonly DEEPGRAM_API_KEY?: string;
  readonly VITE_HEYGEN_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
