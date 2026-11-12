# Changelog

All notable changes to this project are documented here. The project is
built in small stages; each stage is one entry.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Stage 1 — Project architecture
#### Added
- npm-workspaces monorepo: `apps/api` (Worker), `apps/web` (Pages PWA),
  `packages/engine` (deterministic engine), `packages/shared` (API types).
- `docs/ARCHITECTURE.md`: system overview, request flows, security model,
  roadmap and decision log.
- API Worker skeleton (Hono) with `GET /api/status` and JSON 404/500 handlers.
- Pages Function that forwards `/api/*` to the API Worker over a service
  binding; the API Worker has no public URL.
- Vite + Preact web skeleton with dev proxy to the local Worker.
- TypeScript (strict) and Vitest across all workspaces; GitHub Actions CI.
