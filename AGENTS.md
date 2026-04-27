# Repository Guidelines

## Project Structure & Module Organization
This repository is a Vite + React + TypeScript app. The runtime entrypoints are `index.tsx` and `App.tsx`. UI lives in `components/`, with demo flows under `components/demo/` and console controls under `components/console/`. Shared state and providers live in `contexts/` and `lib/state.ts`. Audio, Gemini, Firebase, and tool integrations live in `lib/` and `hooks/`, including `lib/worklets/` for audio processing helpers. Static HTML assets are served from `public/`; `cue/` appears to hold matching source/reference files. Production output is generated into `dist/`.

## Build, Test, and Development Commands
- `npm install`: install project dependencies.
- `npm run dev`: start the Vite dev server on `http://0.0.0.0:3000`.
- `npm run build`: create a production bundle in `dist/`; use this as the current smoke test.
- `npm run preview`: serve the built bundle locally for final verification.

Create `.env.local` with `GEMINI_API_KEY=...` before running the app.

## Coding Style & Naming Conventions
Follow the existing TypeScript/React style: functional components, single quotes, semicolons, and explicit imports. Use `PascalCase` for React components (`Header.tsx`), `camelCase` for utilities and state helpers (`audio-streamer.ts`, `state.ts`), and `use-*.ts` or `use-*.tsx` for hooks. Keep shared logic in `lib/` or `hooks/` rather than inside UI components. Match the existing relative/`@/` import pattern from `tsconfig.json` and `vite.config.ts`.

## Testing Guidelines
There is no dedicated test runner configured yet. Until one is added, treat `npm run build` as the required pre-PR validation step and manually verify the main auth, sidebar, and streaming console flows with `npm run dev`. If you add tests, keep them close to the feature or under a small `tests/` folder and name them `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines
This checkout does not include `.git` history, so no repository-specific commit convention can be verified here. Use short, imperative commit subjects and prefer Conventional Commit prefixes when helpful, for example `feat: add Deepgram fallback` or `fix: guard missing Gemini key`. PRs should include a concise summary, affected paths, setup/env changes, manual validation steps, and screenshots or recordings for UI changes.

## Security & Configuration Tips
Keep secrets in `.env.local`; do not hardcode new API keys in client code. Treat `dist/` as generated output and avoid manual edits there. ## Conversational AI & Real-Time Interaction
- For long-running or background tasks (e.g., API polling, service checks), ensure continuous conversational feedback to prevent the user from perceiving a stalled session.
- When implementing background polling or state fetching, route this process through a dedicated Gemini model instance to manage state and conversational flow without blocking the user experience.
- Always strive for real-time feedback, especially for user input transcription, to maintain a seamless and responsive dialogue flow.
