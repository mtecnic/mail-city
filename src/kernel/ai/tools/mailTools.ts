/**
 * Mail tools exposed to LLMs and MCP clients. Results are compact and
 * token-aware: lists return snippets, bodies are plain text and truncated with
 * an explicit marker.
 */
import { z } from 'zod'
import { defineTool, ToolRegistry, type ToolContext } from './registry'
import type { Kernel } from '../../index'
import type { MessageListItem } from '../../mail/MessageStore'
import { htmlToText } from '../../mail/text'
import { parseAddressList } from '../../mail/addresses'

const MAX_BODY = 12_000

function scopeAccounts(_k: Kernel, ctx: ToolContext, accountId?: string): string[] | undefined {
  if (accountId) {
    if (ctx.accountIds && !ctx.accountIds.includes(accountId)) throw new Error('Account not accessible in this context')
    return [accountId]
  }
  return ctx.accountIds
}

function compact(k: Kernel, m: MessageListItem) {
  const acct = k.accounts.get(m.accountId)
  const folder = k.store.getFolder(m.folderId)
  return {
    id: m.id,
    uri: `mail://msg/${m.id}`,
    threadId: m.threadId,
    account: acct?.email ?? m.accountId,
    folder: folder?.path ?? m.folderId,
    date: m.date,
    from: m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address,
    to: m.to.map((a) => a.address).join(', '),
    subject: m.subject,
    snippet: m.snippet,
    unread: !m.flags.seen,
    starred: m.flags.flagged,
    hasAttachments: m.hasAttachments,
    category: m.aiCategory ?? undefined
  }
}

export function buildMailTools(k: Kernel): ToolRegistry {
  const reg = new ToolRegistry()

  reg.register(
    defineTool({
      name: 'accounts_list',
      description: 'List the configured mail accounts (id, email, display name, type).',
      risk: 'read',
      input: z.object({}),
      handler: (_i, ctx) => k.accounts.list().filter((a) => !ctx.accountIds || ctx.accountIds.includes(a.id)).map((a) => ({ id: a.id, email: a.email, name: a.displayName, type: a.type, enabled: a.enabled }))
    }),
    defineTool({
      name: 'folders_list',
      description: 'List folders for an account (or all accounts) with unread/total counts and special-use role (inbox, sent, drafts, trash, junk, archive).',
      risk: 'read',
      input: z.object({ accountId: z.string().optional().describe('Restrict to one account') }),
      handler: (i, ctx) => {
        const scope = scopeAccounts(k, ctx, i.accountId)
        return k.store
          .listFolders(i.accountId)
          .filter((f) => !scope || scope.includes(f.accountId))
          .map((f) => ({ id: f.id, accountId: f.accountId, path: f.path, name: f.name, specialUse: f.specialUse, unread: f.unreadCount, total: f.totalCount }))
      }
    }),
    defineTool({
      name: 'mail_search',
      description:
        'Search mail. Query syntax: free text (prefix match), "exact phrase", from:, to:, subject:, has:attachment, is:unread, is:starred, in:<folder>, account:<name>, before:YYYY-MM-DD, after:YYYY-MM-DD, larger:2mb. Returns newest/most relevant first with snippets. Use mail_get_message for full bodies.',
      risk: 'read',
      input: z.object({
        query: z.string().describe('Search query'),
        accountId: z.string().optional(),
        folderId: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Default 20')
      }),
      handler: (i, ctx) => {
        const scope = scopeAccounts(k, ctx, i.accountId)
        const rows = k.search.search(i.query, { accountId: i.accountId, folderId: i.folderId, limit: i.limit ?? 20 })
        return rows.filter((m) => !scope || scope.includes(m.accountId)).map((m) => compact(k, m))
      }
    }),
    defineTool({
      name: 'mail_list',
      description: 'List recent messages in a folder or the unified inbox (newest first). Use folderId from folders_list, or specialUse (inbox, sent, drafts…) across accounts.',
      risk: 'read',
      input: z.object({
        folderId: z.string().optional(),
        specialUse: z.enum(['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive']).optional(),
        accountId: z.string().optional(),
        unreadOnly: z.boolean().optional(),
        before: z.string().optional().describe('ISO date cursor for paging'),
        limit: z.number().int().min(1).max(100).optional()
      }),
      handler: (i, ctx) => {
        const scope = scopeAccounts(k, ctx, i.accountId)
        const rows = k.store.list({ folderId: i.folderId, specialUse: i.folderId ? undefined : (i.specialUse ?? 'inbox'), accountId: i.accountId, unreadOnly: i.unreadOnly, before: i.before, limit: i.limit ?? 25 })
        return rows.filter((m) => !scope || scope.includes(m.accountId)).map((m) => compact(k, m))
      }
    }),
    defineTool({
      name: 'mail_get_thread',
      description: 'Get every message in a conversation thread, oldest first, with plain-text bodies (truncated).',
      risk: 'read',
      input: z.object({ threadId: z.string(), maxBodyChars: z.number().int().optional().describe('Per-message body limit, default 4000') }),
      handler: async (i, ctx) => {
        const items = k.mail.thread(i.threadId)
        if (ctx.accountIds && items.some((m) => !ctx.accountIds!.includes(m.accountId))) throw new Error('Thread not accessible')
        const out: (ReturnType<typeof compact> & { body: string })[] = []
        for (const m of items) {
          const d = await k.mail.get(m.id)
          out.push({ ...compact(k, m), body: truncate(d.textPlain ?? (d.textHtml ? htmlToText(d.textHtml) : ''), i.maxBodyChars ?? 4000) })
        }
        return out
      }
    }),
    defineTool({
      name: 'mail_get_message',
      description: 'Get one message with headers, recipients, plain-text body and attachment list. Downloads the body from the server if needed.',
      risk: 'read',
      input: z.object({ id: z.string().describe('Message id (from search/list) or mail://msg/<id> URI'), includeHtml: z.boolean().optional(), maxBodyChars: z.number().int().optional() }),
      handler: async (i, ctx) => {
        const id = i.id.replace(/^mail:\/\/msg\//, '')
        const d = await k.mail.get(id)
        if (ctx.accountIds && !ctx.accountIds.includes(d.accountId)) throw new Error('Message not accessible')
        const acct = k.accounts.get(d.accountId)
        return {
          id: d.id,
          uri: `mail://msg/${d.id}`,
          threadId: d.threadId,
          account: acct?.email,
          folder: d.folderPath,
          date: d.date,
          from: d.from,
          to: d.to,
          cc: d.cc,
          replyTo: d.replyTo,
          subject: d.subject,
          flags: d.flags,
          messageId: d.messageId,
          listUnsubscribe: d.listUnsubscribe,
          body: truncate(d.textPlain ?? (d.textHtml ? htmlToText(d.textHtml) : ''), i.maxBodyChars ?? MAX_BODY),
          html: i.includeHtml ? truncate(d.textHtml ?? '', i.maxBodyChars ?? MAX_BODY) : undefined,
          attachments: d.attachments.filter((a) => !a.isInline).map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size }))
        }
      }
    }),
    defineTool({
      name: 'mail_set_flags',
      description: 'Mark messages read/unread, starred/unstarred.',
      risk: 'write',
      input: z.object({ ids: z.array(z.string()).min(1).max(200), seen: z.boolean().optional(), flagged: z.boolean().optional() }),
      summarize: (i) => `Mark ${i.ids.length} message(s)${i.seen !== undefined ? ` ${i.seen ? 'read' : 'unread'}` : ''}${i.flagged !== undefined ? ` ${i.flagged ? 'starred' : 'unstarred'}` : ''}`,
      handler: (i, ctx) => {
        guard(k, ctx, i.ids)
        k.mail.setFlags(i.ids, { ...(i.seen !== undefined ? { seen: i.seen } : {}), ...(i.flagged !== undefined ? { flagged: i.flagged } : {}) })
        return { ok: true, count: i.ids.length }
      }
    }),
    defineTool({
      name: 'mail_archive',
      description: 'Archive messages (remove from inbox).',
      risk: 'write',
      input: z.object({ ids: z.array(z.string()).min(1).max(200) }),
      summarize: (i) => `Archive ${i.ids.length} message(s)`,
      handler: (i, ctx) => {
        guard(k, ctx, i.ids)
        k.mail.archive(i.ids)
        return { ok: true, count: i.ids.length }
      }
    }),
    defineTool({
      name: 'mail_move',
      description: 'Move messages to a folder (same account). Get folder ids from folders_list.',
      risk: 'write',
      input: z.object({ ids: z.array(z.string()).min(1).max(200), toFolderId: z.string() }),
      summarize: (i) => `Move ${i.ids.length} message(s) to ${k.store.getFolder(i.toFolderId)?.path ?? i.toFolderId}`,
      handler: (i, ctx) => {
        guard(k, ctx, i.ids)
        k.mail.move(i.ids, i.toFolderId)
        return { ok: true }
      }
    }),
    defineTool({
      name: 'mail_delete',
      description: 'Move messages to Trash (or permanently delete if already in Trash/Junk).',
      risk: 'destructive',
      input: z.object({ ids: z.array(z.string()).min(1).max(200) }),
      summarize: (i) => `Delete ${i.ids.length} message(s)`,
      handler: (i, ctx) => {
        guard(k, ctx, i.ids)
        k.mail.delete(i.ids)
        return { ok: true }
      }
    }),
    defineTool({
      name: 'mail_snooze',
      description: 'Hide messages until a date/time, then bring them back unread.',
      risk: 'write',
      input: z.object({ ids: z.array(z.string()).min(1).max(100), until: z.string().describe('ISO 8601 date-time') }),
      summarize: (i) => `Snooze ${i.ids.length} message(s) until ${i.until}`,
      handler: (i, ctx) => {
        guard(k, ctx, i.ids)
        const d = new Date(i.until)
        if (Number.isNaN(d.getTime())) throw new Error('Invalid date')
        k.snooze.snooze(i.ids, d)
        return { ok: true }
      }
    }),
    defineTool({
      name: 'mail_create_draft',
      description: 'Create a draft (new message, or a reply/forward when inReplyToMessageId is set). Does NOT send. Returns the draft id; the user can open it in the compose window.',
      risk: 'write',
      input: z.object({
        accountId: z.string(),
        to: z.array(z.string()).describe('Email addresses, optionally "Name <addr>"'),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string(),
        body: z.string().describe('Plain text body'),
        inReplyToMessageId: z.string().optional(),
        replyMode: z.enum(['reply', 'replyAll', 'forward']).optional()
      }),
      summarize: (i) => `Create draft "${i.subject}" to ${i.to.join(', ')}`,
      handler: async (i, ctx) => {
        scopeAccounts(k, ctx, i.accountId)
        const identity = k.identities.defaultFor(i.accountId)
        const html = `<p>${escapeHtml(i.body).replace(/\n/g, '<br>')}</p>`
        const d = k.drafts.save({
          accountId: i.accountId,
          identityId: identity?.id ?? null,
          to: parseAddressList(i.to.join(', ')),
          cc: parseAddressList((i.cc ?? []).join(', ')),
          bcc: parseAddressList((i.bcc ?? []).join(', ')),
          subject: i.subject,
          html,
          text: i.body,
          inReplyToMessageId: i.inReplyToMessageId ?? null,
          replyMode: i.replyMode ?? (i.inReplyToMessageId ? 'reply' : null)
        })
        k.events.emit('draftCreated', d.id)
        return { draftId: d.id, uri: `mail://draft/${d.id}` }
      }
    }),
    defineTool({
      name: 'mail_send',
      description: 'Send a message immediately (new, or reply when inReplyToMessageId is set). Requires user confirmation. Prefer mail_create_draft unless the user explicitly asked to send.',
      risk: 'destructive',
      input: z.object({
        accountId: z.string(),
        to: z.array(z.string()).min(1),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string(),
        body: z.string(),
        inReplyToMessageId: z.string().optional(),
        replyMode: z.enum(['reply', 'replyAll', 'forward']).optional()
      }),
      summarize: (i) => `Send "${i.subject}" to ${i.to.join(', ')}${i.cc?.length ? ` (cc ${i.cc.join(', ')})` : ''}`,
      handler: async (i, ctx) => {
        scopeAccounts(k, ctx, i.accountId)
        const identity = k.identities.defaultFor(i.accountId)
        const d = k.drafts.save({
          accountId: i.accountId,
          identityId: identity?.id ?? null,
          to: parseAddressList(i.to.join(', ')),
          cc: parseAddressList((i.cc ?? []).join(', ')),
          bcc: parseAddressList((i.bcc ?? []).join(', ')),
          subject: i.subject,
          html: `<p>${escapeHtml(i.body).replace(/\n/g, '<br>')}</p>`,
          text: i.body,
          inReplyToMessageId: i.inReplyToMessageId ?? null,
          replyMode: i.replyMode ?? (i.inReplyToMessageId ? 'reply' : null)
        })
        const item = await k.outbox.send(d)
        return { outboxId: item.id, status: item.status, undoUntil: item.undoUntil }
      }
    }),
    defineTool({
      name: 'contacts_search',
      description: 'Find people by name or email address, ranked by how often the user corresponds with them.',
      risk: 'read',
      input: z.object({ query: z.string(), limit: z.number().int().max(25).optional() }),
      handler: (i) => k.contacts.suggest(i.query, i.limit ?? 10).map((c) => ({ name: c.name, email: c.address }))
    }),
    defineTool({
      name: 'rules_create',
      description: 'Create a mail rule. Conditions match on from/to/subject/body/listId; actions move/archive/markRead/flag/junk/delete/mute. Use folders_list for folder ids.',
      risk: 'write',
      input: z.object({
        name: z.string(),
        match: z.enum(['all', 'any']).default('all'),
        conditions: z.array(z.object({ field: z.enum(['from', 'to', 'cc', 'anyRecipient', 'subject', 'body', 'listId', 'hasAttachment', 'aiCategory']), op: z.enum(['contains', 'notContains', 'equals', 'startsWith', 'endsWith', 'regex', 'isTrue', 'isFalse']), value: z.string().default('') })).min(1),
        actions: z
          .array(
            z.discriminatedUnion('type', [
              z.object({ type: z.literal('move'), folderId: z.string() }),
              z.object({ type: z.literal('archive') }),
              z.object({ type: z.literal('markRead') }),
              z.object({ type: z.literal('flag') }),
              z.object({ type: z.literal('junk') }),
              z.object({ type: z.literal('delete') }),
              z.object({ type: z.literal('mute') }),
              z.object({ type: z.literal('setCategory'), category: z.string() })
            ])
          )
          .min(1),
        accountIds: z.array(z.string()).optional(),
        applyToExisting: z.boolean().optional().describe('Also run against cached mail now')
      }),
      summarize: (i) => `Create rule "${i.name}" (${i.actions.map((a) => a.type).join(', ')})`,
      handler: async (i) => {
        const r = k.rules.save({ name: i.name, conditions: { match: i.match, items: i.conditions }, actions: i.actions, accountIds: i.accountIds ?? [] })
        const affected = i.applyToExisting ? await k.rules.applyToExisting({ ruleId: r.id }) : 0
        return { ruleId: r.id, affected }
      }
    })
  )
  return reg
}

function guard(k: Kernel, ctx: ToolContext, ids: string[]) {
  if (!ctx.accountIds) return
  for (const id of ids) {
    const m = k.store.getMessage(id)
    if (m && !ctx.accountIds.includes(m.accountId)) throw new Error(`Message ${id} is not accessible in this context`)
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}
