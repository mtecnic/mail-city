# MCP: let other agents use your mail

Mail City hosts a [Model Context Protocol](https://modelcontextprotocol.io) server so Claude Desktop, Claude Code, or any MCP client can search, read, draft and file your mail — through exactly the same tool registry the built-in assistant uses (`src/kernel/ai/tools`).

## Two transports

| | stdio (`MailCity.exe --mcp`) | Localhost HTTP |
|---|---|---|
| When | Client launches Mail City headless on demand | While the app is running |
| Setup | Copy the command from Settings → MCP | Enable in Settings → MCP; copy URL + bearer token |
| Confirmations | No window → write/destructive tools run **only** if allow-listed for the client | Confirmation cards appear in the app ("Allow once / Always for <client> / Deny") |
| Concurrency | Opens the same SQLite DB (WAL); queued changes are applied by the running app or on next launch | Same process as the app |

The HTTP endpoint binds to `127.0.0.1` only, requires `Authorization: Bearer <token>` (token lives in the OS keystore), uses the SDK's DNS-rebinding protection, and creates one MCP session per client with the client's own name used for permissions.

### Claude Code

```bash
claude mcp add mail-city -- "C:\Program Files\Mail City\MailCity.exe" --mcp
```

or, with the app running and HTTP enabled:

```bash
claude mcp add --transport http mail-city http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{ "mcpServers": { "mail-city": { "command": "C:\\Program Files\\Mail City\\MailCity.exe", "args": ["--mcp"] } } }
```

## What's exposed

**Tools** (names, risk): `accounts_list` (read), `folders_list` (read), `mail_search` (read), `mail_list` (read), `mail_get_thread` (read), `mail_get_message` (read), `contacts_search` (read), `mail_set_flags` (write), `mail_archive` (write), `mail_move` (write), `mail_snooze` (write), `mail_create_draft` (write), `rules_create` (write), `mail_delete` (destructive), `mail_send` (destructive).

**Resources**: `mail://inbox` (recent unified inbox listing), `mail://msg/{id}`, `mail://thread/{id}`.

**Prompts**: `summarize-thread`, `draft-reply`, `triage-inbox`.

## Scoping

Settings → MCP lets you restrict clients to specific accounts (e.g. share only your personal account, never work). Tool results are compact: snippets by default, bodies truncated with an explicit marker.
