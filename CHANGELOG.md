# Changelog

## 1.0.1

- Fix: error dialogs after the computer sleeps. Dead connections raised an unhandled event that Electron showed as a modal box, once per error and account. Connection errors are now handled, and a safety net logs anything unexpected instead of showing a dialog.
- Sleep and resume: connections are dropped when the computer suspends and re-opened from scratch a few seconds after it wakes, instead of reusing dead sockets.
- Network problems no longer mark an account with a red "sign-in failed" banner; only real errors (wrong password, re-authentication needed, server rejections) do.
- Harden fire-and-forget work (rules on new mail, outbox delivery) so a failure is logged, never thrown.
- Fix: conversations showed the same email several times and list thread counts were roughly doubled. Gmail stores one email in several IMAP folders (INBOX, All Mail, labels); conversations, counts, search and Ask-my-mail now show each email once, keeping the copy you opened.
- Fix: archiving a Gmail message when All Mail was already synced hit a database conflict and left a duplicate until the next sync.

## 1.0.0

First release.

- Accounts: Gmail/Workspace and Outlook/M365 via OAuth 2.0 (IMAP/SMTP XOAUTH2), iCloud/Yahoo/Fastmail/Zoho/GMX/Proton Bridge and any IMAP/SMTP server with autodiscovery (provider presets, MX fingerprint, Mozilla ISPDB, autoconfig, DNS SRV, host probing)
- Sync: IMAP IDLE, CONDSTORE/QRESYNC incremental sync, UIDVALIDITY recovery, offline-first write queue, on-demand bodies and attachments
- Mail: unified inbox, threads, sanitized HTML with remote-image blocking, compose/reply/forward with TipTap, undo and scheduled send, drafts synced to the server, signatures and send-as identities
- Organize: FTS5 search with a query language and saved searches, rules engine with a builder, contacts with autocomplete and vCard import/export, snooze
- Windows: notifications, tray badge, mailto:, jump list, launch at login, auto-update
- AI: Claude and OpenAI-compatible local providers with automatic server discovery and capability probing; privacy policy; summaries, quick replies, triage/Focused, extraction, phishing checks, unsubscribe, drafting, NL rules, semantic search and ask-my-mail; assistant panel with tool confirmations
- MCP server over stdio and localhost HTTP with per-client permissions
