<h1 align="center">Mail City</h1>

<p align="center"><strong>One desktop client for every inbox you own. Built AI-native, runs fine with no AI at all.</strong></p>

<p align="center">
Gmail &amp; Google Workspace · Outlook &amp; Microsoft 365 · iCloud · Yahoo / AOL · Fastmail · Zoho · GMX · Proton (Bridge) · any IMAP/SMTP<br/>
Claude · Ollama · vLLM · llama.cpp · LM Studio · LocalAI · LiteLLM · KoboldCpp · text-generation-webui · TGI · any OpenAI-compatible server
</p>

<p align="center">
<a href="#why-mail-city">Why</a> ·
<a href="#feature-tour">Feature tour</a> ·
<a href="#ai-native-by-design">AI</a> ·
<a href="#let-other-agents-use-your-mail-mcp">MCP</a> ·
<a href="#keyboard-shortcuts">Shortcuts</a> ·
<a href="#getting-started-on-windows">Install</a> ·
<a href="#architecture-in-one-screen">Architecture</a> ·
<a href="#audit-status-and-known-gaps">Audit &amp; known gaps</a>
</p>

---

Mail City is a Windows-first Electron mail client for people who live in many inboxes at once. It keeps a local SQLite cache of every account, works offline, and exposes every mail capability as a typed tool that the built-in assistant, background AI features, and external agents (via MCP) all share. Nothing in the AI layer is bolted on through the UI, and nothing in the mail client depends on a model being configured.

Every claim in this README was checked against the code in a line-by-line audit. Where something is partial or missing, it says so in [Audit status and known gaps](#audit-status-and-known-gaps) and in [docs/AUDIT.md](docs/AUDIT.md).

## Why Mail City

- **Many accounts, one place.** Nine or ten inboxes feel like one. Unified inbox, unified sent and drafts, starred and snoozed views across every account, plus a per-account folder tree.
- **Local-first.** Headers sync into SQLite with FTS5 full-text search. Read, search, triage, archive and file mail offline. Changes queue and replay when you reconnect.
- **AI you control.** Point it at Claude, or at a model running on your own PC. A privacy policy decides, per account, whether mail content may ever leave the machine. Every call is logged with token counts and estimated cost.
- **Agent-ready.** The same tool registry powers an in-app assistant and a Model Context Protocol server, so Claude Desktop, Claude Code or any MCP client can search, read, draft and file your mail with explicit permission gates.
- **Secure by construction.** Sandboxed renderer, strict Content Security Policy, dependency-free preload, zod-validated IPC, OS-keystore-encrypted secrets, and message HTML sanitized with DOMPurify inside a sandboxed iframe. OAuth tokens and API keys never reach the UI process.

## Feature tour

### Accounts

| | |
|---|---|
| **Account types** | Gmail / Google Workspace, Outlook.com / Microsoft 365, iCloud, Yahoo (and AOL), Fastmail, Zoho, GMX, Proton Mail via Proton Bridge, and any custom IMAP/SMTP server |
| **Sign-in** | OAuth 2.0 for Google (PKCE + loopback redirect) and Microsoft (MSAL); passwords or app passwords for everything else. An OAuth account can be switched to an app password and back |
| **Autodiscovery** | Seven-step chain: provider presets → MX lookup (catches Workspace, M365 and iCloud custom domains) → Mozilla ISPDB → `autoconfig.<domain>` and `.well-known/autoconfig` → DNS SRV (RFC 6186) → common host-name guessing with a live TLS greeting probe → manual entry |
| **Wizard** | Type an address, see where the settings came from, sign in, test IMAP and SMTP separately with per-protocol results, done |
| **Editing** | Edit dialog with General (name, color, sync window, pause), Servers (hosts, ports, TLS mode, re-detect, save & test) and Sign-in (re-authenticate, switch auth method, test current credentials) tabs |
| **Secrets** | Passwords, refresh tokens and the MSAL cache are encrypted with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux) |
| **Organising** | Rename, recolor, reorder, pause/resume sync, and a "Sign-in failed, click to fix" banner that opens the right tab |

### Sync engine

- One persistent IMAP connection per account using **imapflow**, with **IDLE** on the inbox for push-style delivery and a configurable poll interval for other folders.
- **CONDSTORE** flag deltas (`CHANGEDSINCE`) when the server supports it. **XOAUTH2** for Google and Microsoft with automatic token refresh and one forced retry on a stale token.
- **Windowed initial sync** (default 90 days, configurable) in batches of 500, then incremental `UID NEXT` fetches. Inbox, Sent and Drafts sync eagerly; other folders sync the first time you open them.
- **Bodies on demand.** Opening a message downloads the full RFC 822 source, parses it, extracts attachments to disk and indexes the text for search.
- **Durable offline op queue.** Flag changes, moves, deletes, appends and folder create/rename/delete are written to SQLite first, applied optimistically in the UI, then replayed in order with exponential backoff. Optimistic moves get placeholder UIDs that are reconciled from `COPYUID` or by Message-ID on the next pass.
- Handles `UIDVALIDITY` changes (cache wipe and resync), Gmail labels and `X-GM-THRID` threading, special-use folders (RFC 6154), and reconnects after sleep, screen unlock or network loss.

### Reading mail

- **Three-pane layout**: sidebar, virtualized message list, reading pane, plus an optional assistant panel.
- **Views**: All inboxes, Focused (AI triage), Starred, All sent, All drafts, Snoozed, Outbox & local drafts, saved searches, and every folder of every account with unread counts.
- **Message list**: sender avatars, thread counts, attachment and AI badges (urgent, category, needs reply), hover-to-star, row checkboxes, select-all, Ctrl/Shift-click multi-select, a bulk toolbar (mark read, archive, move, junk, delete) and **drag & drop** onto folders.
- **Conversation view**: a thread opens as a stack of messages, oldest first, with the selected and unread messages expanded and the rest collapsed to one line. Click a header or press `Enter` to expand or collapse; the toolbar and shortcuts act on the highlighted message.
- **Reading pane**: sanitized HTML in a sandboxed iframe with its own CSP, inline (`cid:`) images resolved locally, **remote images blocked by default** with a one-click load, plain-text messages linkified, attachment chips with open / save-as / copy-image, raw source viewer with "Save .eml", snooze presets, and auto mark-as-read.
- **Actions**: reply, reply-all, forward, archive, delete (to Trash, or permanently from Trash/Junk), junk / not junk, star, read / unread, move, snooze (later today, tomorrow, this weekend, next week, or pick a date & time), copy link, view source.
- **Folder management**: create subfolders, rename, delete (system folders protected), mark all read, empty Trash / Junk, sync now.
- **Right-click everything**: accounts, folders, messages (single or multi-selection), attachments, saved searches. Menus support submenus (Move to…, Snooze…), keyboard navigation, danger styling and shortcut hints.

### Compose and send

- **Rich-text editor** (TipTap): bold, italic, underline, bullet and numbered lists, block quotes, links, clear formatting.
- **Docked compose windows**, several at once, minimizable, with autosaved local drafts and "close and keep" that also appends the draft to the server's Drafts folder.
- **Addressing**: contact autocomplete with ranked suggestions, chips, paste a comma- or semicolon-separated list, Cc/Bcc on demand, From picker across the account's identities.
- **Identities & signatures**: multiple send-as aliases per account with their own name, Reply-To and signature. Replies automatically pick the identity the message was addressed to.
- **Reply / forward** with proper quoting, `In-Reply-To` / `References` threading headers, reply-all de-duplication that drops your own addresses, and re-attached forwards.
- **Attachments** via file picker, with size display; outgoing MIME built by nodemailer's `MailComposer`.
- **Undo send** (configurable 0 to 60 second window) and **scheduled send** at a chosen date and time, both backed by a durable outbox with retry, cancel-and-edit and failure notifications.
- Sent mail is appended to the Sent folder on servers that need it (Gmail and Outlook do this themselves).

### Search

Full-text search over subject, sender, recipients and downloaded bodies, powered by SQLite FTS5 with BM25 ranking and a recency boost. Trash and Junk are excluded unless you ask for them.

```text
from:alice to:bob cc:carol subject:"quarterly report"
has:attachment is:unread is:starred in:inbox account:work
before:2026-01-01 after:30d larger:5m smaller:100k "exact phrase"
```

Dates accept `YYYY-MM-DD` or relative `7d`, `2w`, `3m`, `1y`. Any search can be saved to the sidebar. When AI is configured, an **Ask my mail** card above the results answers questions with citations (see below).

### Rules

A rules engine with **conditions** on From, To, Cc, any recipient, Subject, Body, List-Id, attachment presence, size and AI category (contains, equals, starts/ends with, regex, greater/less than, is set); **match all or any**; and **actions** to move, archive, delete, mark junk, mark read, star, mute the notification, set the AI category, or forward. Rules can be scoped to one account, ordered, and told to stop processing. They run on new mail automatically and can be applied to existing mail on demand, or written in plain English and converted by the AI.

### Contacts

Harvested automatically from every message you receive and send, ranked for autocomplete by how often you write to them and how recently. Edit names and notes, merge duplicates, and import or export vCard.

### Windows integration

Toast notifications for new inbox mail (single or grouped, with a sound option, muted by rules), system tray with a menu and unread-aware icon, taskbar badge, close-to-tray, launch at login, a `mailto:` protocol handler, a jump list (New message, Inbox), single-instance enforcement, and automatic updates via GitHub Releases (checked on launch and every six hours, installed on quit). Light, dark and system themes.

## AI-native by design

Mail City treats AI as a first-class part of the architecture rather than a feature. Every mail capability is a typed, risk-classified tool in `src/kernel/ai/tools`. The assistant panel, the background features, and the MCP server all call the same registry, so anything you can do in the UI an agent can do too, with the same permission gates. **AI is entirely optional:** with no provider configured every AI surface hides itself and the client behaves like a conventional mail app.

### Providers

| Provider | What you get |
|---|---|
| **Claude (Anthropic API)** | `claude-opus-5-5` by default, with Sonnet and Haiku selectable per feature. Adaptive thinking on the streaming path, server-side fallbacks, prompt caching on system prompts, strict tool schemas, structured JSON output validated with zod, vision, refusal detection, and configurable effort (low to max). |
| **Local / OpenAI-compatible** | Ollama, vLLM, llama.cpp `llama-server`, LM Studio, LocalAI, LiteLLM, KoboldCpp, text-generation-webui, Hugging Face TGI, or anything with `/v1/chat/completions`. Streaming, tool calling, JSON-schema output, vision and embeddings are used when the server supports them. |

The local provider **degrades gracefully**: if a server rejects tools it retries without them and tells the model so; if it rejects `response_format` it writes the schema into the prompt and extracts JSON from the reply; reasoning tokens stream as "thinking". Nothing breaks on a small model, you just get fewer capabilities.

### Local server discovery

Type a hostname, IP or URL, or click **Scan this machine**, and Mail City figures out the rest:

1. **Normalizes** the input (adds `http://`, strips `/v1` or `/api`, respects an explicit port, adds `https` for public domains).
2. **Probes the usual ports in parallel** with 2.5 second timeouts: 11434 (Ollama), 8000 (vLLM), 8080 (llama.cpp), 1234 (LM Studio), 5000 (text-generation-webui), 5001 (KoboldCpp), 4000 (LiteLLM), 8081 (LocalAI), plus 8001, 3000, 3001 and 9000 for generic servers. Only the host you typed (or localhost) is probed, never the subnet.
3. **Fingerprints** each server by its native endpoints (`/api/version`, `/props`, `/api/v1/info/version`, `/version`, `/info`, `/health/liveliness`, `/readyz`, `/api/v1/model`, `/v1/models`) to learn its kind, version, and whether it wants an API key.
4. **Lists models** with family, parameter size, quantization, file size and context length wherever the server exposes them (Ollama `/api/show`, vLLM `max_model_len`, llama.cpp `/props`).
5. **Probes any model live** for tool calling, JSON-schema output, vision, embeddings, time-to-first-token and tokens per second, and shows capability badges.
6. **Suggests routing**: the largest tool-capable model for chat and drafting, the smallest for triage and summaries, an embedding model for semantic search. Recommended Ollama models can be pulled from inside the app with progress.

### Privacy policy

- **Local only** (the default) or **Cloud allowed**, globally and per account. An account can only be made stricter than the global default, so a work account can be pinned to local models while personal accounts use Claude. Adding a Claude key asks you to choose explicitly, including whether new mail may be triaged automatically.
- Overrides hold everywhere. The assistant, Ask-my-mail and the semantic indexer resolve the model first and then restrict themselves to the accounts that model may see, so a cloud-routed assistant cannot read a local-only account even from the unified inbox.
- A provider is "local" when it resolves to loopback, link-local, an RFC 1918 range, Docker's host alias, a single-label hostname or a `.local` / `.lan` / `.internal` name. Public IPs and public domains are treated as cloud.
- Every call is written to the **usage log** with feature, provider, model, input and output tokens, cache hits, estimated cost (for Anthropic models) and duration. Message bodies are never logged there.
- API keys and the MCP bearer token are stored encrypted in the OS keystore and are never exposed to the renderer.

### Routing

Six roles, each assignable to any provider and model: **Assistant** (chat), **Drafting & replies**, **Summaries**, **Triage & categories**, **Extraction**, **Semantic search embeddings**. A role with no explicit route falls back to the chat route, then to the first enabled provider the privacy policy allows. Quick replies ride on the summaries route; phishing analysis and natural-language rules ride on extraction.

### What the AI does for you

| Feature | Where | What happens |
|---|---|---|
| **Summarize thread** | Reading pane | Two to five bullets over the last twelve messages of the conversation, cached on the thread |
| **Quick replies** | Reading pane | One to three short reply suggestions, one click to open a prefilled reply |
| **Triage** | Background, Focused view | New inbox mail is classified in batches of 20 into `primary`, `needs_reply`, `newsletter`, `notification`, `promotion`, `receipt`, `social` or `spam_like`, with priority 0 to 3 and up to three action items. Priority 3 shows an **urgent** badge; the Focused view keeps primary, needs-reply and priority 2+ mail. A backlog pass covers the last 200 untriaged messages |
| **Extract** | Reading pane | Events (saved straight to `.ics`), tasks, tracking numbers, amounts and links |
| **Phishing check** | Reading pane | Local heuristics (Reply-To domain mismatch, brand-name spoofing, raw-IP links, link-domain spread, urgency wording, SPF/DKIM/DMARC failures) combined with a model verdict of low / medium / high risk, reasons and advice. The heuristics work without any model |
| **Unsubscribe** | Reading pane | Reads `List-Unsubscribe`, prefers RFC 8058 one-click POST, falls back to mailto (sent through the outbox) or the unsubscribe link in the body |
| **Composer AI bar** | Compose window | Draft a reply, fix grammar, shorten, expand, make formal, make friendlier, translate, or give a free-text instruction; the result replaces or inserts into the editor |
| **Plain-English rules** | Settings → Rules | "Move everything from the bank to Finance and mark it read" becomes a previewed, editable rule |
| **Ask my mail** | Search | Hybrid retrieval (BM25 full-text fused with vector search via reciprocal rank fusion) over your downloaded messages, answered with numbered citations that open the source message |
| **Assistant** (`Ctrl+J`) | Side panel | A multi-step agent (up to 12 tool calls per turn) over the whole tool registry, streaming, with session history and knowledge of the message you have open |

### Semantic index

Downloaded message bodies are chunked (1,800 characters with 200 overlap, up to 12 chunks per message, each prefixed with subject and sender), embedded with the embeddings route, and stored in a **sqlite-vec** table sized to the model's dimension. Changing the embedding model rebuilds the index. Indexing runs in small background batches and can be forced from Settings → AI.

### Tool registry and permissions

Fifteen tools, each with a risk level. Read tools always run. Write tools and destructive tools require a confirmation card in the assistant (Allow / Deny, red for destructive) unless you auto-approve them in Settings → AI → Tool permissions.

| Risk | Tools |
|---|---|
| read | `accounts_list`, `folders_list`, `mail_search`, `mail_list`, `mail_get_thread`, `mail_get_message`, `contacts_search` |
| write | `mail_set_flags`, `mail_archive`, `mail_move`, `mail_snooze`, `mail_create_draft`, `rules_create` |
| destructive | `mail_delete`, `mail_send` |

Tool results are compact and token-aware: snippets by default, bodies truncated with a marker, thread bodies capped per message.

Full details: [docs/AI.md](docs/AI.md).

## Let other agents use your mail (MCP)

Mail City hosts a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the same fifteen tools, three resources (`mail://inbox`, `mail://msg/{id}`, `mail://thread/{id}`) and three prompts (`summarize-thread`, `draft-reply`, `triage-inbox`).

| | stdio | localhost HTTP |
|---|---|---|
| **How** | The client launches `MailCity.exe --mcp` headless on demand | Enabled in Settings → MCP while the app runs; bound to `127.0.0.1` |
| **Auth** | Process ownership | `Authorization: Bearer <token>`, 24 random bytes, stored in the OS keystore, constant-time compared, DNS-rebinding protection on |
| **Confirmations** | No window, so write and destructive tools run **only** if allow-listed for the client | Confirmation cards appear in the app: Allow once / Always for this client / Deny |
| **Scoping** | Per-client tool allowlists and an account allowlist (share all accounts, or only some); every tool, including rules, contacts, move targets and reply lookups, stays inside the shared accounts | Same, keyed by the client's reported name |

Settings → MCP generates ready-to-paste config for Claude Code and Claude Desktop:

```bash
claude mcp add mail-city -- "C:\Program Files\Mail City\MailCity.exe" --mcp
```

```json
{ "mcpServers": { "mail-city": { "command": "C:\\Program Files\\Mail City\\MailCity.exe", "args": ["--mcp"] } } }
```

Full details: [docs/MCP.md](docs/MCP.md).

## Keyboard shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| `c` | Compose | `r` / `a` / `f` | Reply / reply all / forward |
| `/` | Focus search | `e` | Archive |
| `Enter` | Expand / collapse message in a conversation | | |
| `j` / `k` | Next / previous message (list focused) | `#` or `Delete` | Delete |
| `x` | Toggle selection of the current message | `s` | Star |
| `v` | Move to folder… | `u` / `Shift+I` | Mark unread / read |
| `z` | Snooze… | `!` | Mark as junk |
| `Ctrl+J` | Toggle assistant | `Esc` | Deselect, or clear search |
| `?` | Shortcut help | Right-click | Context menu anywhere |

## Settings at a glance

- **Accounts**: list with status, Fix sign-in, Edit, Remove, Add; OAuth client IDs for Google and Microsoft (your own, or baked into the build via `.env`).
- **AI**: enable, privacy policy (global and per account), providers (add Claude or a local server, scan, probe, pull), routing per role, Claude effort, auto-triage, background indexing, tool auto-approval, usage log with totals.
- **MCP / agents**: stdio snippets, HTTP toggle with token reveal / regenerate, shared accounts, per-client allowlists.
- **Identities & signatures**: aliases per account, default identity, signatures.
- **Rules**: natural-language box, ordered rule list with enable / apply-now, full condition and action editor.
- **Contacts**: search, edit, merge duplicates, vCard import / export.
- **General**: theme, initial sync window, poll interval, undo-send window, tray, launch at login, notifications and sound, remote-image policy, check for updates, open log folder.

## Getting started on Windows

### Prerequisites (one time)

1. **Node.js 22 LTS** from <https://nodejs.org> (the project requires ≥ 22.12).
2. **pnpm**: run `corepack enable` after installing Node; the repo pins `pnpm@10.28.0`. If `corepack` is missing or blocked, `npm i -g pnpm` works too.
3. **C++ build tools**: `better-sqlite3` is a native module compiled for Electron during install. Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload and let it add Python 3, which node-gyp also needs. An existing Visual Studio with the C++ workload is fine.

### Run from source

```bash
pnpm install
```

```bash
pnpm dev
```

The first install takes a few minutes (it downloads Electron and compiles SQLite). `pnpm dev` starts the app with hot reload.

### Build an installer

```bash
pnpm dist:win
```

Produces `release\Mail City-Setup-1.0.0.exe` (NSIS, per-user, choosable install directory, desktop and Start-menu shortcuts) and a portable `.exe`. Builds are unsigned, so SmartScreen shows "unknown publisher" the first time: *More info → Run anyway*. For an unpacked build without an installer, `pnpm dist:dir` writes `release\win-unpacked\MailCity.exe`. Signing and publishing are covered in [docs/RELEASING.md](docs/RELEASING.md).

### First run

- Add an account from the welcome screen. iCloud, Yahoo, Fastmail, Zoho, GMX, Proton Bridge and plain IMAP accounts work right away with a password or app password; server settings are detected automatically.
- **Gmail and Outlook sign in with OAuth and need a client ID.** Paste your own in **Settings → Accounts → OAuth clients** ([docs/OAUTH-SETUP.md](docs/OAUTH-SETUP.md), about five minutes), bake defaults into a build via `.env` (see `.env.example`), or use a Gmail *App Password* as a shortcut. Google Workspace admins must have IMAP enabled for the domain.
- AI is optional. **Settings → AI → Scan this machine** finds a running Ollama, LM Studio, llama.cpp or similar server, or add a Claude API key. Everything else works without any model configured.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `corepack enable` fails with `EPERM` | Run the terminal as administrator once, or skip corepack and `npm i -g pnpm` |
| `pnpm install` fails mentioning `node-gyp`, `Python`, `MSBuild` or `better_sqlite3` | C++ Build Tools or Python missing. Install them, open a new terminal, run `pnpm install` again |
| `pnpm dev` ends with `Error: Electron uninstall` | The Electron binary download was interrupted. Run `node node_modules\electron\install.js`, then `pnpm dev` |
| App exits immediately with `NODE_MODULE_VERSION` in the error | Native module built for the wrong runtime: `pnpm rebuild` |
| Google Workspace account says *Invalid credentials* | Use an App Password (needs 2-Step Verification) or OAuth with your own client ID, and confirm IMAP is enabled in the Google Admin console |
| Blank window | Check the terminal; main-process logs are in `%APPDATA%\mail-city\logs\main.log` (also *Settings → General → Open log folder*) |

Your accounts, cache and secrets live in `%APPDATA%\mail-city\data\`. Pulling a new version of the source and re-running never touches them; schema migrations run automatically on launch.

## Architecture in one screen

```text
┌──────────────────────────── Electron main ────────────────────────────┐
│ src/main      windows · tray · notifications · mailto · jump list      │
│               updater · OAuth loopback · safeStorage cipher            │
│ src/main/ipc  zod-validated router for every channel in src/shared/ipc │
│                                                                        │
│ src/kernel    the mail kernel: pure Node, zero Electron imports        │
│   accounts/auth/providers  autodiscovery · Google & MS OAuth · IMAP/SMTP│
│   sync                     per-account syncer · IDLE · op queue        │
│   mail/search/rules        threading · compose · outbox · FTS5 · rules │
│   ai                       providers · discovery · tools · agent · RAG │
│   ai/mcp                   MCP server (stdio + HTTP)                   │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ contextBridge: window.mail.invoke / on
┌───────────────────────────────┴────────────────────────────────────────┐
│ src/renderer  React 19 · Tailwind 4 · TanStack Query · Zustand         │
│               sandboxed, no Node, strict CSP, typed IPC only           │
└────────────────────────────────────────────────────────────────────────┘
```

- The kernel is a library. It is constructed by the main process, by the headless `--mcp` entry point, and by the test suite with an in-memory database, so every feature is testable without Electron.
- Storage is SQLite (better-sqlite3 + drizzle) in WAL mode with versioned migrations, an FTS5 index and a sqlite-vec vector table.
- The preload script is CommonJS with no runtime dependencies and exposes exactly three functions.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```bash
pnpm install && pnpm dev
```

```bash
pnpm typecheck && pnpm lint && pnpm test
```

```bash
pnpm build && xvfb-run -a pnpm test:e2e   # Playwright-Electron smoke test (Linux); drop xvfb on Windows/macOS
```

**Tests**: 53 unit and integration tests across 13 files, including a fake IMAP provider for the sync engine, an in-process SMTP server for the outbox, an in-memory MCP transport, the autodiscovery chain, the search parser, the sanitizer under jsdom, and AI discovery / tool-registry behaviour. Four Playwright-Electron end-to-end tests boot the built app. CI runs lint, typecheck, unit tests, the e2e suite under xvfb and a Windows packaging job on every push; tagging `v*` builds and publishes a signed-or-unsigned release.

## Audit status and known gaps

The whole codebase was audited against this README. Everything above exists and is wired up. The audit's highest-priority findings (per-account privacy enforcement, MCP account scoping, cloud-first defaults, the conversation view, duplicated server drafts and local-only snooze wake-up) have been fixed. These are the remaining honest gaps, with the full list and severity in [docs/AUDIT.md](docs/AUDIT.md):

- **Labels are read-only.** Gmail labels are synced and displayed; adding or removing them from the app is not implemented yet.
- **No print and no cross-account move.** Printing a message and dragging a message between accounts are not implemented.
- **Density setting and the "contacts" remote-image mode** are stored but have no effect yet.
- **macOS** has no `mailto:` handler and **Linux** has no launch-at-login; Windows is the primary target.
- **Servers without UIDPLUS** cannot report the UID of an appended draft, so on those servers "close and keep" may still leave an older copy in Drafts.
- **Assistant transcripts** are stored locally with the tool results the model saw; delete a conversation to remove them.
- **Upgrade note.** The privacy default changed to *Local only*. If you added a Claude key before this change and never set a policy, switch Settings → AI → Privacy back to *Cloud allowed* to keep using Claude for mail content.

## License

MIT
