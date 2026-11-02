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

## Install

Download the installer from the Releases page, or build it yourself:

```bash
pnpm install
pnpm dist:win
```

Google and Microsoft accounts sign in with OAuth. A build can ship default client IDs via `.env` (see `.env.example`), or you paste your own in **Settings → Accounts → OAuth clients** — [docs/OAUTH-SETUP.md](docs/OAUTH-SETUP.md) walks through it in five minutes.

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
