# Mail City

An AI-native desktop mail client for people who live in many inboxes at once — Gmail / Google Workspace, Outlook / Microsoft 365, iCloud, Yahoo and any custom-domain IMAP/SMTP account — in one unified, local-first, Windows-first Electron app.

**Status: early development.** See `docs/ARCHITECTURE.md` for the design and the phase-by-phase build plan.

## Highlights (planned)

- Unified inbox across every account, with per-account views, folders, flags, rules, contacts and signatures
- Local SQLite cache with full-text and semantic search; everything works offline and replays when you reconnect
- Compose/reply/forward with attachments, signatures, undo send and scheduled send
- Windows integration: toast notifications, tray badge, `mailto:` handler, auto-update
- **AI-native**: one typed "mail kernel" exposes every mail action as a tool. The same tool registry feeds the built-in assistant (Claude or a local model via Ollama / vLLM / llama.cpp / LM Studio) and a built-in MCP server so Claude Desktop, Claude Code or any MCP client can read and act on your mail — with privacy modes and confirmation for anything destructive.

## Development

```bash
pnpm install
pnpm dev
```

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Build a Windows installer:

```bash
pnpm dist:win
```

Copy `.env.example` to `.env` to bake in default Google / Microsoft OAuth client IDs; users can also paste their own in Settings (see `docs/OAUTH-SETUP.md`).

## License

MIT
