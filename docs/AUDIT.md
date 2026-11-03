# Code audit (November 2026)

A line-by-line review of `src/`, `tests/`, the build config and the docs, done while rewriting the README so that every feature it claims is backed by code. Three reviewers covered the mail kernel and main process, the AI and MCP layer, and the renderer. There are no `TODO` / `FIXME` markers in the codebase; every finding below comes from reading the code.

**Legend.** Severity: **High** (data loss, privacy or security), **Medium** (a visible feature does not work as described), **Low** (polish, dead code, docs). Status: **Fixed** in the same change as this document, or **Open**.

## Fixed in this change

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | Medium | Four features used `window.prompt()`, which Electron does not implement, so **save search, custom snooze date, schedule send and insert link** silently did nothing | Replaced with the in-app `promptDialog` (`src/renderer/src/components/dialogs.tsx`) with validation and sensible defaults |
| F2 | Medium | "Load images" and "Always load remote images" could not actually load `http(s)` images: the message iframe uses `srcdoc`, which inherits the app's CSP, and `img-src` excluded remote origins | `img-src` in `src/renderer/index.html` now allows `https:` and `http:`; the sanitizer still strips remote images unless the user opts in |
| F3 | High | `OpenAICompatProvider.isLocal` treated any host without a letter TLD as local, so a **public IP** server passed the *Local only* privacy policy, while `.lan` / `.local` names counted as cloud | Rewritten to parse the hostname and accept only loopback, link-local, RFC 1918, Docker host alias, single-label names and `.local` / `.lan` / `.internal` / `.home` / `.localdomain` (`src/kernel/ai/llm/openaiCompat.ts`) |
| F4 | Low | `docs/AI.md` ended with a leftover development note ("Phase 9") | Removed |
| F5 | Low | README overstated or omitted several things: "toasts with actions" (notifications are click-only), per-provider help links, search operators, rule actions, and the real list of providers | README rewritten from the audited inventory |

## Open findings

### Privacy and security

| # | Severity | Finding | Where |
|---|---|---|---|
| S1 | High | **Per-account privacy overrides are bypassed in the unified view.** `Agent.send` only passes account IDs when a session has `context.accountId`; with none, `cloudAllowed([])` checks the global mode only, so the assistant can read mail from a local-only account and send it to Claude | `src/kernel/ai/agent/Agent.ts`, `src/kernel/ai/AiService.ts` |
| S2 | High | **Embeddings and Ask-my-mail retrieval ignore per-account privacy.** `Indexer.tick`, `Indexer.semantic` and `askMail` call `routeFor('embeddings')` without account IDs | `src/kernel/ai/embeddings/Indexer.ts`, `src/kernel/ai/features/askMail.ts` |
| S3 | Medium | **Regenerating the MCP token does not disconnect clients.** `McpHttpServer.start()` captures the token once; the old token keeps working and the new one is rejected until HTTP is toggled off and on. The UI says "Regenerate (disconnects clients)" | `src/main/mcpHttp.ts`, `src/renderer/src/features/settings/McpSettings.tsx` |
| S4 | Medium | The MCP token is masked in one field but shown in plain text inside the config snippets, and `mcp.configSnippets` creates a token even when HTTP is off | `src/main/ipc/index.ts`, `McpSettings.tsx` |
| S5 | Medium | **MCP account scoping leaks**: `rules_create` ignores `ctx.accountIds` (can create all-account rules and apply them), `contacts_search` returns contacts from all accounts, `mail_move` does not check the destination folder's account, `mail_create_draft` / `mail_send` do not check the account of `inReplyToMessageId` | `src/kernel/ai/tools/mailTools.ts` |
| S6 | Medium | **Risky defaults**: `enabled`, `autoTriage` and `autoIndex` default to true and privacy defaults to `cloud-allowed`. Adding a Claude key fills every empty route except embeddings, so sender, subject and snippet of every new inbox message go to the API with no further prompt | `src/shared/schemas/ai.ts`, `AiSettings.tsx` (`AddClaude`) |
| S7 | Low | Unsubscribe by `mailto:` sends immediately with no confirmation (the undo-send window still applies) | `src/kernel/ai/features/unsubscribe.ts`, `MessageAiPanel.tsx` |
| S8 | Low | Quick-reply text is interpolated into HTML unescaped (`<p>${text}</p>`); the composer AI bar does escape | `MessageAiPanel.tsx` `useReply` |
| S9 | Low | Assistant sessions persist tool results (mail content) in `ai_sessions`; docs only promise that the usage log has no bodies | `src/kernel/ai/agent/Agent.ts`, `docs/AI.md` |
| S10 | Low | MCP allowlists are keyed by the client's self-reported name, so a client holding the token can claim another client's allowlist | `src/main/mcpHttp.ts` |
| S11 | Low | The dev-server `connect-src ws: http://localhost:* http://127.0.0.1:*` allowance ships in production builds | `src/renderer/index.html` |
| S12 | Low | The preload only checks channel names against a regex; per-channel validation happens in main. Works, but `src/shared/ipc.ts` and ARCHITECTURE.md describe it as "only forwards channels listed here" | `src/preload/index.ts` |
| S13 | Low | If OS encryption is unavailable (Linux without a keyring), adding an account or saving an API key throws instead of explaining | `src/main/cipher.ts` |

### Mail features

| # | Severity | Finding | Where |
|---|---|---|---|
| M1 | Medium | **No conversation view.** `useThread` exists but is unused; the reading pane shows one message. Thread counts and thread summaries work | `src/renderer/src/features/mail/hooks.ts:56`, `ReadingPane.tsx` |
| M2 | Medium | **Server drafts duplicate.** `syncDraftToServer` never records the server UID (`setServerLocation(id, folder.id, null)`), so every close-and-keep appends a new copy; discard and send never remove server copies | `src/kernel/mail/ComposeService.ts` |
| M3 | Medium | **Snooze wake is local only.** Waking sets unread locally without queueing a `setFlags` op; a later flag sync can undo it | `src/kernel/mail/Snooze.ts` |
| M4 | Medium | **Reading-pane Star / Mark-unread buttons go stale.** They read from the `['message', id]` cache, which `useMailActions` does not invalidate, so the icon does not change and a second click resends the same value | `hooks.ts:62-66`, `ReadingPane.tsx` |
| M5 | Medium | **Inline images are lost on reply / forward**: quoted HTML is sanitized with `cid: {}` and forward drops inline parts | `src/renderer/src/features/compose/Editor.tsx:18`, `src/kernel/mail/compose.ts` |
| M6 | Low | Gmail **labels are read-only**: `setLabels` op and `addLabels` / `removeLabels` exist but nothing queues them and there is no IPC channel | `src/kernel/sync/OpQueue.ts`, `MessageStore.ts` |
| M7 | Low | QRESYNC is enabled on the connection but `open()` never passes `changedSince` / `uidValidity`, so deletions are found by a full `UID SEARCH ALL` per folder per pass | `src/kernel/providers/ImapProvider.ts` |
| M8 | Low | Without CONDSTORE only the newest 1000 cached UIDs get flag refreshes | `src/kernel/sync/AccountSyncer.ts` |
| M9 | Low | Special-use folders are detected only from RFC 6154 flags; no name heuristics ("Sent Items" without `\Sent` is treated as a plain folder) | `src/kernel/mail/folders.ts` |
| M10 | Low | Rules run automatically only on new mail in INBOX or folders without a special use; `rules.applyNow` caps at 500 messages | `src/kernel/index.ts` `wireEvents`, `RulesEngine.ts` |
| M11 | Low | Failed ops stay in `pending_ops` forever with no UI to see or retry them | `OpQueue.ts` |
| M12 | Low | No print, no move between accounts, `mailto:` always uses the first account, "Copy link" copies a `mail://` URL that nothing outside the app can open | `ReadingPane.tsx`, `Sidebar.tsx`, `AppEvents.tsx:258`, `menus.ts` |
| M13 | Low | Composer: cannot switch the From account (identities only), signatures are invisible until send, no drag-files-to-attach, no plain-text mode, no `Ctrl+Enter` to send | `ComposeWindow.tsx`, `src/kernel/mail/Outbox.ts:87` |
| M14 | Low | Reading pane header omits Reply-To, Bcc and a full-headers toggle | `ReadingPane.tsx` |

### Settings and UI

| # | Severity | Finding | Where |
|---|---|---|---|
| U1 | Medium | **Settings with no effect**: `density`; per-account `syncSettings.initialWindowDays` (editable, but `SyncEngine` passes only the global value); `privacy.loadRemoteImages = 'contacts'` (in the schema, not in the UI, not handled); `indexWindowDays` has no UI; `launchAtLogin` is a no-op on Linux | `GeneralSettings.tsx`, `EditAccountDialog.tsx`, `SyncEngine.ts`, `ReadingPane.tsx:178`, `protocol.ts` |
| U2 | Medium | `autoApproveTools` says it applies to "the assistant and MCP clients", but only the assistant uses it; MCP uses per-client allowlists | `AiSettings.tsx`, `src/shared/schemas/ai.ts` |
| U3 | Medium | **Global shortcuts fire while modals are open** (confirm dialogs, shortcut help, context menus): `e`, `#`, `Delete` act on the selection underneath | `MailView.tsx:54` |
| U4 | Low | `Enter` is listed in the shortcut help but has no handler; `s` always stars and never un-stars; `Shift+K` does not extend the selection; `Shift+J` builds duplicate IDs; `j` / `k` need the list focused | `MailView.tsx`, `MessageList.tsx:94`, `Welcome.tsx` |
| U5 | Low | "Check for updates" gives no feedback (only *downloading* and *downloaded* states render) and does nothing in unpackaged builds | `AppEvents.tsx` 302-320, `updater.ts` |
| U6 | Low | Number fields in General settings save on every keystroke; an emptied field becomes 0, fails validation silently and snaps back | `GeneralSettings.tsx` |
| U7 | Low | `UndoSendToast` computes a "sent" state but never renders it | `OutboxView.tsx` |
| U8 | Low | Reading-pane `⋯` and right-click do nothing when the message is not in the loaded list (opened from a notification) | `ReadingPane.tsx:24,91` |
| U9 | Low | Accessibility: `Dialog` has no Escape handling, focus trap, focus restore or `aria-labelledby`; message rows are unlabelled `div`s; context menus lack `role="menu"`; several icon-only buttons rely on `title`; `SnoozeMenu` closes on mouse-leave and is not keyboard reachable | `ui.tsx:66`, `MessageList.tsx`, `ContextMenu.tsx`, `SnoozeMenu.tsx` |
| U10 | Low | `AddAccountDialog.tsx` re-declares `ServerFields` and `TestLine`, which `EditAccountDialog.tsx` already exports | `src/renderer/src/features/accounts/` |

### AI layer

| # | Severity | Finding | Where |
|---|---|---|---|
| A1 | Medium | The Ask-AI card, the plain-English rule box, the Focused view and the `Ctrl+J` button are not hidden when no provider is enabled (the reading-pane AI panel and composer bar are); the assistant placeholder checks for zero providers rather than zero *enabled* providers | `SearchBar.tsx`, `RulesSettings.tsx`, `Sidebar.tsx`, `AssistantPanel.tsx` |
| A2 | Low | `Indexer.vacuum()` is never called, so vectors for deleted messages remain | `Indexer.ts` |
| A3 | Low | `Indexer.semantic()` can drop the whole index if the embedding model changed but the table is not marked ready; an empty-body message embeds its header chunk twice | `Indexer.ts` |
| A4 | Low | OpenAI-compatible streaming: 429 is not mapped to a rate-limit error, the 120 s timeout covers the whole stream, and `pullModel` does not send the API key | `openaiCompat.ts`, `discovery.ts` |
| A5 | Low | The assistant's cached system prompt embeds the date and the open message, so prompt caching only partly hits | `src/kernel/ai/agent/prompts.ts` |
| A6 | Low | `ai.summarize` never streams and thinking deltas are never shown in the UI | `src/main/ipc/index.ts`, `MessageAiPanel.tsx` |
| A7 | Low | `ANTHROPIC_PRICES` should be re-checked before cost figures are relied on; `claude-fable-5-1` has a price entry but is not in the default model list | `src/shared/schemas/ai.ts` |
| A8 | Low | Dead code: `KNOWN_PORTS` name hints, `RECOMMENDED_OLLAMA_MODELS` (UI hardcodes three), `host.docker.internal` in `LOCAL_HOSTS` is never probed, `ai.semanticSearch` IPC is never called, `askMail` and the rule box never pass `accountId` | `discovery.ts`, `AiSettings.tsx`, `SearchBar.tsx`, `RulesSettings.tsx` |

### Dead code and unused schema

- Tables never written: `threads`, `sync_log`. Columns never written: `contacts.avatar_path`, `message_bodies.raw_path`. `folders.sync_enabled` is never set false; `folders.subscribed` is unused.
- Unused: `ImapProvider.downloadPart` / `.copy` / `.status` / `.noop` / `.supportsMove`, `utils/retry.retry()`, `flags.applyFlagPatch`, `Snooze.snoozePreset`, `OpQueue.pendingCount`.
- IPC channels the renderer never calls: `app.version` (used by e2e only), `messages.unreadCount`, `messages.unsnooze`, `ai.semanticSearch`. Events emitted but never consumed: `messages.new`, `outbox.sent`, `outbox.failed`, `rules.changed`, `snooze.woke`, `unread.changed`, `messages.triaged`.
- `src/main/workers/sync-worker.ts` is a ping/pong stub; syncers run in the main process. `docs/ARCHITECTURE.md`'s diagram still shows a utility process per account.

### Test coverage

53 unit / integration tests and 4 end-to-end tests. Gaps: no renderer component tests; e2e covers neither the composer, reading pane, context menus nor shortcuts; no test for the privacy policy (`cloudAllowed`, `isLocal`) or for the MCP account scoping.

## Suggested order of work

1. **S1, S2, S5**: pass account IDs through the agent, indexer and MCP tool contexts, and make every tool check `ctx.accountIds`. Add tests for `cloudAllowed` and `isLocal`.
2. **S6**: default privacy to *Local only* or ask on first Claude key; confirm before enabling auto-triage with a cloud route.
3. **M2, M3, M4**: record the server UID for drafts and delete the old copy; queue a `setFlags` op on snooze wake; invalidate `['message', id]` in `useMailActions`.
4. **S3, S4**: re-read the token per request; stop returning it in snippets unless revealed.
5. **M1**: a conversation view in the reading pane using the existing `useThread` and `messages.thread`.
6. **U1, U2, U3**: either wire the dead settings or remove them; fix the auto-approve label; suspend shortcuts while any dialog or menu is open.
7. Everything marked Low as time allows.
