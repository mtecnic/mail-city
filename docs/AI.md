# AI in Mail City

Mail City is "AI-native": every mail capability is a typed tool in `src/kernel/ai/tools`, and the same registry drives the in-app assistant, background features, and the MCP server. Nothing is bolted on through the UI.

## Providers

| Kind | What | Where content goes |
|---|---|---|
| Claude (Anthropic) | `claude-opus-5-5` by default; Sonnet/Haiku selectable per feature. Adaptive thinking, server-side refusal fallbacks (`fallbacks: "default"`), prompt caching on the system prompt, strict tool schemas, structured outputs. | api.anthropic.com |
| Local / OpenAI-compatible | Ollama, vLLM, llama.cpp `llama-server`, LM Studio, LocalAI, LiteLLM, text-generation-webui, KoboldCpp, anything with `/v1/chat/completions`. Tool calling, JSON-schema output and embeddings are used when the server supports them and degraded gracefully otherwise. | your machine / LAN |

### Adding a local server

Settings → AI → **Local server**. Type a host, IP or URL — or click **Scan this machine**. Mail City:

1. normalizes the input (adds `http://`, strips `/v1`),
2. probes the usual ports in parallel (11434 Ollama, 8000 vLLM, 8080 llama.cpp, 1234 LM Studio, 5000/5001, 4000 LiteLLM, …) with ~2.5 s timeouts,
3. fingerprints the server (`/api/version`, `/props`, `/version`, `/info`, `/v1/models`, …) to learn its kind and version and whether it wants an API key,
4. lists models with family / parameter size / quantization / context length where the server exposes them (Ollama `/api/show`, vLLM `max_model_len`, llama.cpp `/props`),
5. lets you **probe** any model live: tool calling, JSON-schema output, vision, embeddings and a quick tokens/sec measurement,
6. suggests roles (largest tools-capable model → chat/drafting, smallest → triage, embedding model → embeddings) and can pull recommended Ollama models with progress.

No subnet sweeps — only the host you typed (or localhost) is probed.

## Privacy

- **Local only** (the default): no mail content ever leaves the PC. Features routed to Claude fall back to a local model, or are unavailable if there is none.
- **Cloud allowed**: Claude may receive the content of the messages a feature works on. Adding a Claude key asks you to choose explicitly, and whether new mail should be triaged automatically.
- Per-account overrides, e.g. keep a work account local-only. Overrides are enforced everywhere, including where no account is selected: the assistant, Ask-my-mail retrieval and the semantic indexer first resolve the model they will use, then restrict themselves to the accounts that model may see. A cloud-routed assistant simply cannot read a local-only account.
- A provider counts as local when its host is loopback, link-local, an RFC 1918 address, Docker's host alias, a single-label name or a `.local` / `.lan` / `.internal` name. Public IPs and domains are cloud.
- Every call is logged (feature, model, tokens, duration, estimated cost) in Settings → AI → Usage log. Message bodies are never logged there. Assistant conversations are stored locally (SQLite) including the tool results the model saw; delete a conversation to remove them.

## Tools

See `src/kernel/ai/tools/mailTools.ts`. Each tool declares a risk level:

- `read` – always allowed (search, list, read).
- `write` – flags, move, archive, snooze, drafts, rules: the assistant and MCP clients must get confirmation unless the tool is auto-approved in Settings.
- `destructive` – delete, send: same, and never auto-approved for MCP unless you opt in explicitly.

Tool results are compact and token-aware (snippets by default, bodies truncated with a marker).

## MCP

See `docs/MCP.md`.
