# Mail City

An AI-native desktop mail client for people who live in many inboxes at once — Gmail / Google Workspace, Outlook / Microsoft 365, iCloud, Yahoo and any custom-domain IMAP/SMTP account — in one unified, local-first, Windows-first Electron app.

## What it does

**Mail**
- Unified inbox, Focused view, starred, snoozed; per-account folder trees with unread counts
- Fast local cache (SQLite, FTS5) — search, read and triage offline; actions replay when you reconnect
- Threaded conversations, sanitized HTML with remote-image blocking, inline images and attachments
- Compose / reply / forward with a rich editor, attachments, signatures, send-as identities, undo send and scheduled send
- Rules (conditions → move / archive / flag / junk / delete / mute / forward), contacts with autocomplete and vCard import/export
- Search language: `from:` `to:` `subject:` `has:attachment` `is:unread` `in:` `account:` `before:` `after:` `larger:`
- Windows integration: toasts with actions, tray + taskbar badge, `mailto:` handler, jump list, launch at login, auto-update

**AI-native** (see [docs/AI.md](docs/AI.md))
- Works with Claude (Anthropic API) **and** local models — Ollama, vLLM, llama.cpp, LM Studio, LocalAI, LiteLLM, … Type a host or click *Scan this machine*; ports, server type, models and their capabilities (tools / JSON / vision / embeddings / speed) are detected automatically
- Privacy policy: local-only or cloud-allowed, per account; every call logged with tokens and estimated cost
- Summaries, quick replies, triage (category + priority → Focused view), extraction (events → .ics, tracking, amounts, tasks), phishing analysis, one-click unsubscribe, draft/rewrite/translate in the composer, natural-language rules, semantic *ask my mail* with citations
- Assistant side panel (`Ctrl+J`): a multi-step agent over the same tool registry, with confirmation cards for anything that changes mail

**Agent interop** (see [docs/MCP.md](docs/MCP.md))
- Built-in MCP server: stdio (`MailCity --mcp`) for Claude Desktop / Claude Code, or localhost HTTP with a bearer token while the app runs; per-client tool allowlists and account scoping

## Getting started on Windows

### Prerequisites (one time)

1. **Node.js 22 LTS** — <https://nodejs.org> (the project requires ≥ 22.12).
2. **pnpm** — run `corepack enable` after installing Node; the repo pins `pnpm@10.28.0` and corepack picks it up. (If `corepack` is missing: `npm i -g pnpm`.)
3. **C++ build tools** — `better-sqlite3` is a native module that is compiled for Electron during install. Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **"Desktop development with C++"** workload (it can add Python 3 too, which node-gyp also needs). An existing Visual Studio with the C++ workload is fine.

### Run from source

```bash
pnpm install
```

```bash
pnpm dev
```

The first install takes a few minutes (downloads Electron, compiles SQLite). `pnpm dev` starts the app with hot reload.

### Build an installer

```bash
pnpm dist:win
```

Produces `release\Mail City-Setup-1.0.0.exe` (NSIS) and a portable `.exe`. Builds are unsigned, so SmartScreen shows "unknown publisher" the first time — *More info → Run anyway*. For an unpacked build without an installer, `pnpm dist:dir` → `release\win-unpacked\MailCity.exe`.

### First run

- Add an account from the welcome screen. iCloud, Yahoo, Fastmail, Zoho and plain IMAP accounts work right away with an app password; server settings are detected automatically.
- **Gmail and Outlook sign in with OAuth and need a client ID.** Paste your own in **Settings → Accounts → OAuth clients** ([docs/OAUTH-SETUP.md](docs/OAUTH-SETUP.md), five minutes), bake defaults into a build via `.env` (see `.env.example`), or use a Gmail *App Password* as a shortcut.
- AI is optional. **Settings → AI → Scan this machine** finds a running Ollama / LM Studio / llama.cpp server, or add a Claude API key. Everything else works without any model configured.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm install` fails mentioning `node-gyp`, `MSBuild` or `better_sqlite3` | C++ Build Tools missing — install them, open a new terminal, run `pnpm install` again |
| App exits immediately with `NODE_MODULE_VERSION` in the error | Native module built for the wrong runtime: `pnpm rebuild` |
| Blank window | Check the terminal; main-process logs are in `%APPDATA%\mail-city\logs\main.log` |

## Develop

```bash
pnpm install
pnpm dev
```

```bash
pnpm typecheck && pnpm lint && pnpm test
```

```bash
pnpm build && xvfb-run -a pnpm test:e2e   # Playwright-Electron smoke test (Linux); run without xvfb on Windows/macOS
```

Architecture, data model and security notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT
