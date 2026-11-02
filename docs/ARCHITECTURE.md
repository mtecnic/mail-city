# Architecture

## Processes

```
┌────────────────────────── Electron main ──────────────────────────┐
│  src/main      windows, tray, notifications, protocol, updater     │
│  src/main/ipc  zod-validated IPC router  ◄──────────────┐         │
│                                                          │         │
│  src/kernel  ─ the "mail kernel" (pure Node, no Electron)│         │
│     accounts · auth · providers(imap/smtp) · sync · mail │         │
│     search · rules · contacts · ai(llm, tools, mcp)      │         │
│                                                          │         │
│  utilityProcess per account: src/main/workers/sync-worker│         │
└──────────────────────────────────────────────────────────┼─────────┘
                                                           │ contextBridge (src/preload)
┌──────────────────────────── renderer ─────────────────────┴─────────┐
│  React + Tailwind + TanStack Query + Zustand                        │
│  talks only to `window.mail.invoke(channel, input)` and events      │
└─────────────────────────────────────────────────────────────────────┘
```

### The kernel is a library

`src/kernel` has **no Electron imports**. It is constructed by:

- the main process (with Electron `safeStorage` as the secret cipher),
- the headless MCP stdio entry point (`mail-city --mcp`),
- the test-suite (`:memory:` SQLite, plaintext cipher).

Everything the UI can do, an LLM can do, because both go through the same kernel services and the same tool registry (`src/kernel/ai/tools`).

### IPC

`src/shared/ipc.ts` declares every request/response channel and every main→renderer event with zod schemas. The main process validates input and output, the preload only forwards known channels, and the renderer gets full type inference. Adding a feature = add a channel there, a handler in `src/main/ipc`, and a hook in the renderer.

### Security

- `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP.
- Message HTML is sanitized with DOMPurify and rendered inside a sandboxed iframe; remote images are blocked by default.
- Secrets are encrypted with the OS keystore (DPAPI on Windows) before they touch SQLite. Logs are redacted.
- Navigation and `window.open` are intercepted and sent to the OS browser.

### Data

SQLite (WAL) via `better-sqlite3` + drizzle. Hand-written forward-only SQL migrations in `src/kernel/db/migrations.ts` (FTS5 and `sqlite-vec` virtual tables can't be expressed in drizzle). Schema is in `src/kernel/db/schema.ts`.

### Sync model

One `AccountSyncer` per account (`src/kernel/sync/AccountSyncer.ts`) owns a single reconnecting IMAP connection. It syncs the folder list, eagerly caches a date window of INBOX/Sent/Drafts headers, keeps the rest lazy, uses CONDSTORE `CHANGEDSINCE` for flag deltas and a UID diff for deletions, IDLEs on INBOX between passes and polls other folders. User actions are written to SQLite first and queued in `pending_ops`, then replayed in order; optimistic moves use negative placeholder UIDs until the server's COPYUID map (or the next folder sync) assigns the real one. Syncers currently run in the main process; the class has no Electron dependency and can be moved into a `utilityProcess` without API changes.

### AI layer

`src/kernel/ai`: `llm/` (provider interface, Anthropic + OpenAI-compatible implementations, local-server discovery), `tools/` (the registry every consumer shares), `features/` (summaries, triage, drafting, extraction, …), `embeddings/` (sqlite-vec index + hybrid search), `agent/` (the assistant loop) and `mcp/` (MCP bridge). `AiService` resolves a provider+model per feature under the privacy policy and logs every run.

## Testing

- `pnpm test` — unit + integration (vitest): kernel on in-memory SQLite, sync engine against an in-memory IMAP double (`tests/unit/fakeImap.ts`), outbox against a real in-process SMTP server, MCP bridge over an in-memory transport, sanitizer XSS corpus (jsdom), parsers and query language.
- `pnpm test:e2e` — Playwright drives the built Electron app (welcome, wizard, settings, bridge isolation).

## Build phases (all complete)

1. Scaffold — electron-vite, React, Tailwind, IPC, SQLite, CI, electron-builder
2. Accounts & auth — autodiscovery, Google/Microsoft OAuth, password accounts
3. IMAP provider + sync engine + 3-pane UI
4. Compose & send — SMTP, MIME, drafts, outbox with undo
5. Search, contacts, rules, snooze
6. Notifications, tray, Windows integration, onboarding, updater
7. AI foundation — provider abstraction (Claude + local OpenAI-compatible), local-server auto-discovery, tool registry, privacy modes
8. AI features — summarize, triage, drafting, extraction, NL rules, ask-my-mail, agent panel
9. MCP server — stdio + localhost HTTP
10. Hardening & release — integration/e2e tests, docs, 1.0.0
