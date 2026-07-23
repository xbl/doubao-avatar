# Repository Guidelines

## Project Structure & Module Organization

This is a Vue 3 + TypeScript + Vite proof of concept for Doubao realtime voice and the iFlytek Avatar SDK.

- `src/App.vue`, `src/main.ts`, and `src/style.css` contain the UI entry point and global styling.
- `src/modules/` holds domain integrations: `doubao/`, `iflytek/`, and `audio/`.
- `src/session/` coordinates microphone, realtime dialog, and avatar lifecycles.
- `src/config/` resolves environment settings and stores default persona prompts.
- `src/libs/avatar-sdk-web/` contains the checked-in vendor SDK bundles and type declarations.
- Tests are colocated with implementation files as `*.test.ts`; design notes and plans live under `docs/superpowers/`.

## Build, Test, and Development Commands

Run these commands from the repository root:

```bash
npm install       # Install locked dependencies
cp .env.example .env
npm run dev       # Start the Vite development server
npm test          # Run the Vitest suite once
npm run build     # Type-check through Vite and create a production build
npm run preview   # Serve the production build locally
```

Populate `.env` with Doubao and iFlytek credentials before using the realtime workflow. The Vite development proxy injects Doubao headers; do not expose those values through `VITE_*` variables.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, single-quoted strings, trailing commas where the surrounding code uses them, and semicolon-free formatting. Prefer small, explicit classes and functions that match the existing module boundaries. Use `PascalCase` for Vue components and classes, `camelCase` for functions and variables, and descriptive lowercase directory names. Keep the `@` alias for imports from `src/`.

## Testing Guidelines

Vitest is the test framework. Add or update a colocated `*.test.ts` whenever behavior changes, especially for audio framing, protocol payloads, configuration, and lifecycle ordering. Use descriptive `describe` blocks and behavior-focused `it` names. Run `npm test` and `npm run build` before submitting changes.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `Add Doubao realtime voice ...`. Follow that style and keep each commit focused. Pull requests should explain the user-visible or integration change, list verification commands, link relevant issues or design docs, and include screenshots or a short recording for UI changes. Never commit `.env`, API keys, or generated build output.
