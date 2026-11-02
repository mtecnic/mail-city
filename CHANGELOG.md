# Changelog

## 1.0.0

First release.

- Accounts: Gmail/Workspace and Outlook/M365 via OAuth 2.0 (IMAP/SMTP XOAUTH2), iCloud/Yahoo/Fastmail/Zoho/GMX/Proton Bridge and any IMAP/SMTP server with autodiscovery (provider presets, MX fingerprint, Mozilla ISPDB, autoconfig, DNS SRV, host probing)
- Sync: IMAP IDLE, CONDSTORE/QRESYNC incremental sync, UIDVALIDITY recovery, offline-first write queue, on-demand bodies and attachments
- Mail: unified inbox, threads, sanitized HTML with remote-image blocking, compose/reply/forward with TipTap, undo and scheduled send, drafts synced to the server, signatures and send-as identities
- Organize: FTS5 search with a query language and saved searches, rules engine with a builder, contacts with autocomplete and vCard import/export, snooze
- Windows: notifications, tray badge, mailto:, jump list, launch at login, auto-update
- AI: Claude and OpenAI-compatible local providers with automatic server discovery and capability probing; privacy policy; summaries, quick replies, triage/Focused, extraction, phishing checks, unsubscribe, drafting, NL rules, semantic search and ask-my-mail; assistant panel with tool confirmations
- MCP server over stdio and localhost HTTP with per-client permissions
