# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vite + React 19 + TypeScript voice-interface app powered by Google's Gemini Live API. Users talk to an AI assistant ("Beatrice") through a streaming console with audio, webcam video, document scanning/OCR, and function-calling capabilities. Auth and per-user data are backed by Firebase (Auth, Firestore, Realtime DB).

## Key Commands

```
npm install         # Install dependencies
npm run dev         # Start dev server on http://0.0.0.0:3000
npm run build       # Production build to dist/ — also the pre-PR smoke test
npm run preview     # Serve the built bundle locally
```

Requires `.env.local` with `GEMINI_API_KEY=...` before running. `vite.config.ts` injects this as both `process.env.API_KEY` and `process.env.GEMINI_API_KEY` at build time.

There is **no test runner configured**. Treat `npm run build` as the required validation step and manually verify auth, sidebar, and streaming-console flows with `npm run dev`.

## Architecture

### Live API Client
`GenAILiveClient` (`lib/genai-live-client.ts`) wraps `@google/genai`'s `GoogleGenAI.live.connect()` with an `EventEmitter` for: `audio`, `content`, `toolcall`, `turncomplete`, `interrupted`, `setupcomplete`, `log`, `open`, `close`, `error`, `inputTranscription`, `outputTranscription`. The instance is provided via `contexts/LiveAPIContext.tsx`; consume it through `useLiveAPI()` from `hooks/media/use-live-api.ts` rather than pulling from context directly.

### Two-Model Tool Execution (Orchestrator + Background Agents)
Tool calls are **not handled inline** by the Live model. The flow:

1. Live model emits `toolcall` → handler immediately sends an ack `FunctionResponse` so the Live session keeps speaking.
2. `lib/tool-executor.ts` runs the real work on a separate REST Gemini model (`gemini-2.0-flash`).
3. `lib/agents/index.ts` is a registry that dispatches the tool call by exact-name or prefix match (`gmail_`, `calendar_`, `document_`, `drive_`/`docs_`, `maps_`, `video_`, etc.) to a specialized handler in `lib/agents/*-agent.ts`.
4. The result is summarized by a formatter prompt and injected back into the Live session as text.

This is why long-running work must never block the Live session — see the real-time-feedback rule in `AGENTS.md`. If you add a new tool, register it in **both** `lib/tools/<template>.ts` (declaration) and `lib/agents/index.ts` (handler dispatch).

### Conversation Context
`lib/conversation-context.ts` bundles userId, profile, recent turns, active tasks, detected intent, and document-memory context into a single `ConversationContext` object that is rebuilt for every tool dispatch. Agents read identity/memory from here instead of reaching into stores directly.

### State Management
Zustand stores in `lib/state.ts`:
- `useSettings` — system prompt, model, voice
- `useUI` — sidebar, chat, mic level/permission, camera state, task results, processing console
- `useTools` — active toolset (template-driven)
- `useLogStore` — conversation turns, tool calls, grounding chunks
- `useProcessingStore` — background-task UI state (see `lib/processing-console.ts`)

Additional persisted stores live in `lib/document/store.ts` (scan settings/session, persisted under `beatrice-document-settings`) and `lib/user-profile-store.ts`.

### Templates and Tools
`Template = 'customer-support' | 'personal-assistant' | 'navigation-system' | 'beatrice'` (`lib/state.ts:16`). Each template has a toolset under `lib/tools/` and a paired system prompt. `useTools.setTemplate()` updates **both** the active tools and `useSettings.systemPrompt` — they must change together. The Beatrice persona prompt lives at `lib/state.ts:25-35` (and `lib/prompts/beatrice.ts`).

### EburonFlix Skill
`lib/eburonflix/` (TMDB API + Zustand store) and `components/eburonflix/EburonFlixOverlay.tsx` provide a movie/TV/actor browsing experience that Beatrice can drive via voice. Tools (`eburonflix_browse`, `eburonflix_search`, `eburonflix_play`, `eburonflix_translate`, `eburonflix_close`) are declared in `lib/tools/beatrice-tools.ts` and dispatched through the `eburonflix_` prefix in the agent registry. The agent mutates the store; the overlay renders from it. Playback uses the VidSrc embed family (`vidsrc.net|in|pm|xyz`), selectable per-title.

### Document Scanning + Memory
`lib/document/` is a self-contained subsystem for camera/gallery/file/screenshot scans:
- `scanner-service.ts`, `ocr-service.ts` (tesseract.js), `document-ai-service.ts` — capture and OCR
- `memory-service.ts` — persisted scan memory consumed by `buildConversationContext()`
- `voice-command-router.ts` — routes voice commands into scan actions
- `beatrice-response-service.ts` — formats scan results back into Beatrice's voice
UI surface is `components/document/DocumentScannerModal.tsx`.

### Audio Pipeline
`lib/audio-streamer.ts` plays PCM from the model. `lib/audio-recorder.ts` captures from mic. `lib/worklets/` contains AudioWorklet processors (volume meter, general processing).

### Auth
Firebase Auth with Google provider (`lib/firebase.ts`). Google OAuth access tokens are cached in `localStorage` under `beatrice_google_oauth_token_v1` with a 55-minute TTL — agents that hit Google APIs (Gmail, Calendar, Drive, Docs, Maps) read from this cache. `components/demo/AuthScreen.tsx` is the gate.

### Build Output Chunking
`vite.config.ts` manually chunks `pdfjs-dist`, `tesseract.js`, `@google/genai`, and `firebase` into separate vendor chunks. Keep this in mind when adding heavy dependencies.

## Code Conventions

- React components: `PascalCase` in `components/`; functional components, single quotes, semicolons, explicit imports.
- Utilities/hooks: `camelCase` in `lib/`, `hooks/`. Hooks named `use-*.ts(x)`.
- `@/` alias maps to project root (configured in `tsconfig.json` and `vite.config.ts`).
- Zustand stores: `create<StoreInterface>(...)` with typed setters; persist via `zustand/middleware` for cross-session state.
- `dist/` is generated output, never edited manually.
- Real-time conversational feedback is required for any long-running/background work — route it through the background executor model so the Live session stays responsive (see `AGENTS.md`).

## Reference

- `AGENTS.md` — full project conventions (style, testing, PR guidelines, security, real-time interaction rules).
- `UI-Flow.md` — UI flow notes.
- `README.md` — quickstart.
