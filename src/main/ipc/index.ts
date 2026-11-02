import { app, shell, dialog, BrowserWindow, Notification } from 'electron'
import { takePendingMailto } from '../protocol'
import { currentUpdateStatus, checkForUpdates, installUpdateNow } from '../updater'
import { readFile, copyFile } from 'node:fs/promises'
import type { Kernel } from '@kernel/index'
import type { AppSettingsPatch } from '@shared/schemas/settings'
import type { AiSettingsPatch } from '@shared/schemas/ai'
import type { StreamDelta } from '@kernel/ai/llm/types'
import { summarizeThread, smartReplies, extractFromMessage, eventToIcs, draftEmail, ruleFromText, explainPhishing, localPhishingHeuristics, unsubscribeOptions, oneClickUnsubscribe } from '@kernel/ai/features'
import { askMail } from '@kernel/ai/features/askMail'
import type { McpHttpServer } from '../mcpHttp'
import { getMcpSettings, setMcpSettings } from '@kernel/ai/mcp/McpBridge'
import type { McpSettingsPatch } from '@shared/schemas/mcp'
import { handle, emit } from './router'
import { SavedSearchesSchema } from '@shared/ipc'

const DANGEROUS_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|pif)$/i

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  txt: 'text/plain', csv: 'text/csv', html: 'text/html', json: 'application/json', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', mp4: 'video/mp4', mov: 'video/quicktime', ics: 'text/calendar', eml: 'message/rfc822'
}
function mimeFromName(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

let mcpHttp: McpHttpServer | null = null
export function setMcpHttp(s: McpHttpServer): void {
  mcpHttp = s
}
export function getMcpHttp(): McpHttpServer | null {
  return mcpHttp
}

export function registerIpc(kernel: Kernel): void {
  handle('app.version', () => ({ version: app.getVersion(), electron: process.versions.electron ?? '' }))
  handle('app.openExternal', async ({ url }) => {
    if (!/^https?:/i.test(url)) throw new Error('Only http(s) URLs can be opened')
    await shell.openExternal(url)
  })

  handle('settings.get', () => kernel.settings.get())
  handle('settings.set', (patch) => kernel.settings.set(patch as AppSettingsPatch))
  kernel.settings.on('changed', (s) => emit('settings.changed', s))

  handle('accounts.list', () => kernel.accounts.list())
  handle('accounts.discover', ({ email }) => kernel.discover(email))
  handle('accounts.test', (req) => kernel.testAccount(req))
  handle('accounts.create', (req) => kernel.createAccount(req))
  handle('accounts.get', ({ id }) => kernel.accountDetail(id))
  handle('accounts.update', ({ id, patch }) => kernel.updateAccount(id, patch))
  handle('accounts.setPassword', ({ id, password }) => kernel.setAccountPassword(id, password))
  handle('accounts.reauth', ({ id, ticket }) => kernel.reauthAccount(id, ticket))
  handle('accounts.testExisting', ({ id }) => kernel.testExistingAccount(id))
  handle('accounts.reorder', ({ ids }) => kernel.accounts.reorder(ids))
  handle('accounts.remove', async ({ id }) => {
    await kernel.sync.restart(id).catch(() => {})
    kernel.accounts.remove(id)
  })
  kernel.accounts.on('changed', () => emit('accounts.changed', undefined))

  handle('oauth.start', ({ provider, loginHint }) => kernel.oauth.start(provider, loginHint))
  handle('oauth.config.get', () => ({ user: kernel.oauthConfig.getUserConfig(), hasGoogle: kernel.oauthConfig.hasGoogle(), hasMicrosoft: kernel.oauthConfig.hasMicrosoft() }))
  handle('oauth.config.set', (cfg) => kernel.oauthConfig.setUserConfig(cfg))

  // ---- mail --------------------------------------------------------------
  handle('folders.list', ({ accountId }) => kernel.store.listFolders(accountId))
  handle('folders.sync', ({ accountId, folderId }) => kernel.sync.requestFolderSync(accountId, folderId))
  handle('folders.create', ({ accountId, name, parentId }) => kernel.folders.create(accountId, name, parentId))
  handle('folders.rename', ({ id, name }) => kernel.folders.rename(id, name))
  handle('folders.delete', ({ id }) => kernel.folders.delete(id))
  handle('folders.markAllRead', ({ id }) => ({ count: kernel.folders.markAllRead(id) }))
  handle('folders.empty', ({ id }) => ({ count: kernel.folders.empty(id) }))
  handle('messages.source', ({ id }) => kernel.messageSource(id))
  handle('messages.saveSource', async ({ id }) => {
    const src = await kernel.messageSource(id)
    if (!src) return { ok: false }
    const m = kernel.store.getMessage(id)
    const r = await dialog.showSaveDialog({ defaultPath: `${(m?.subject || 'message').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.eml`, filters: [{ name: 'Email', extensions: ['eml'] }] })
    if (r.canceled || !r.filePath) return { ok: false }
    await copyFile(src.path, r.filePath)
    return { ok: true, path: r.filePath }
  })

  handle('messages.list', (q) => kernel.mail.list(q))
  handle('messages.thread', ({ threadId }) => kernel.mail.thread(threadId))
  handle('messages.get', ({ id, fetchBody }) => kernel.mail.get(id, { fetchBody }))
  handle('messages.setFlags', ({ ids, flags }) => kernel.mail.setFlags(ids, flags))
  handle('messages.move', ({ ids, toFolderId }) => kernel.mail.move(ids, toFolderId))
  handle('messages.archive', ({ ids }) => kernel.mail.archive(ids))
  handle('messages.delete', ({ ids }) => kernel.mail.delete(ids))
  handle('messages.junk', ({ ids, junk }) => kernel.mail.markJunk(ids, junk))
  handle('messages.unreadCount', ({ accountId }) => kernel.store.unreadTotal(accountId))

  handle('attachments.open', async ({ id }) => {
    const a = await kernel.mail.attachmentPath(id)
    if (!a) return { ok: false, error: 'Attachment is not available' }
    if (DANGEROUS_EXT.test(a.filename)) {
      const r = await dialog.showMessageBox({ type: 'warning', buttons: ['Cancel', 'Open anyway'], defaultId: 0, cancelId: 0, message: `"${a.filename}" is an executable file`, detail: 'Files of this type can harm your computer. Only open it if you trust the sender.' })
      if (r.response !== 1) return { ok: false }
    }
    const err = await shell.openPath(a.path)
    return err ? { ok: false, error: err } : { ok: true }
  })
  handle('attachments.saveAs', async ({ id }) => {
    const a = await kernel.mail.attachmentPath(id)
    if (!a) return { ok: false }
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const r = await dialog.showSaveDialog(win as never, { defaultPath: a.filename })
    if (r.canceled || !r.filePath) return { ok: false }
    await copyFile(a.path, r.filePath)
    return { ok: true, path: r.filePath }
  })
  handle('attachments.dataUrl', async ({ id }) => {
    const a = await kernel.mail.attachmentPath(id)
    if (!a || !/^image\//.test(a.mimeType)) return null
    const buf = await readFile(a.path)
    if (buf.length > 15 * 1024 * 1024) return null
    return `data:${a.mimeType};base64,${buf.toString('base64')}`
  })

  handle('sync.now', ({ accountId }) => kernel.sync.syncNow(accountId))

  // ---- compose -----------------------------------------------------------
  handle('compose.replyTemplate', ({ messageId, mode }) => kernel.compose.replyTemplate(messageId, mode))
  handle('compose.pickAttachments', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const r = await dialog.showOpenDialog(win as never, { properties: ['openFile', 'multiSelections'] })
    if (r.canceled) return []
    const { stat } = await import('node:fs/promises')
    const { basename } = await import('node:path')
    return Promise.all(
      r.filePaths.map(async (p) => {
        const s = await stat(p)
        return kernel.compose.importAttachment(p, basename(p), s.size, mimeFromName(p))
      })
    )
  })
  handle('compose.send', async ({ draft, scheduledAt }) => {
    const saved = kernel.drafts.save(draft)
    return kernel.outbox.send(saved, { scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined })
  })
  handle('drafts.list', ({ accountId }) => kernel.drafts.list(accountId))
  handle('drafts.get', ({ id }) => kernel.drafts.get(id) ?? null)
  handle('drafts.save', (d) => kernel.drafts.save(d))
  handle('drafts.syncToServer', ({ id }) => kernel.compose.syncDraftToServer(id))
  handle('drafts.discard', ({ id }) => kernel.compose.discardDraft(id))
  handle('outbox.list', () => kernel.outbox.list())
  handle('outbox.cancel', ({ id }) => kernel.outbox.cancel(id))
  handle('outbox.retry', ({ id }) => kernel.outbox.retry(id))
  handle('identities.list', ({ accountId }) => kernel.identities.list(accountId))
  handle('identities.create', (i) => kernel.identities.create(i))
  handle('identities.update', ({ id, patch }) => kernel.identities.update(id, patch))
  handle('identities.remove', ({ id }) => kernel.identities.remove(id))
  handle('signatures.list', () => kernel.identities.listSignatures())
  handle('signatures.save', (s) => kernel.identities.saveSignature(s))
  handle('signatures.delete', ({ id }) => kernel.identities.deleteSignature(id))
  // ---- search / contacts / rules / snooze ----------------------------------
  handle('search.run', ({ query, ...opts }) => kernel.search.search(query, opts))
  handle('search.saved.list', () => kernel.settings.getValue('savedSearches', SavedSearchesSchema))
  handle('search.saved.set', (list) => kernel.settings.setValue('savedSearches', list))
  handle('contacts.list', () => kernel.contacts.list())
  handle('contacts.suggest', ({ prefix, limit }) => kernel.contacts.suggest(prefix, limit))
  handle('contacts.save', (c) => kernel.contacts.save(c))
  handle('contacts.remove', ({ id }) => kernel.contacts.remove(id))
  handle('contacts.merge', ({ ids }) => kernel.contacts.merge(ids) ?? null)
  handle('contacts.duplicates', () => kernel.contacts.duplicates())
  handle('contacts.import', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'vCard', extensions: ['vcf', 'vcard'] }] })
    if (r.canceled || !r.filePaths[0]) return { imported: 0 }
    const text = await readFile(r.filePaths[0], 'utf8')
    return { imported: kernel.contacts.importVcf(text) }
  })
  handle('contacts.export', async () => {
    const r = await dialog.showSaveDialog({ defaultPath: 'contacts.vcf', filters: [{ name: 'vCard', extensions: ['vcf'] }] })
    if (r.canceled || !r.filePath) return { ok: false }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(r.filePath, kernel.contacts.exportVcf(), 'utf8')
    return { ok: true, path: r.filePath }
  })
  handle('rules.list', () => kernel.rules.list())
  handle('rules.save', (r) => kernel.rules.save(r))
  handle('rules.remove', ({ id }) => kernel.rules.remove(id))
  handle('rules.reorder', ({ ids }) => kernel.rules.reorder(ids))
  handle('rules.applyNow', async (o) => ({ affected: await kernel.rules.applyToExisting(o) }))
  handle('messages.snooze', ({ ids, until }) => kernel.snooze.snooze(ids, new Date(until)))
  handle('messages.unsnooze', ({ ids }) => kernel.snooze.unsnooze(ids))
  kernel.rules.on('changed', () => emit('rules.changed', undefined))
  kernel.rules.on('applied', () => emit('messages.changed', { accountId: '', folderId: '' }))
  kernel.snooze.on('woke', (ids) => {
    emit('snooze.woke', { ids })
    emit('messages.changed', { accountId: '', folderId: '' })
  })

  // ---- app integration -----------------------------------------------------
  handle('app.pendingMailto', () => takePendingMailto())
  handle('app.showNotificationTest', () => {
    const n = new Notification({ title: 'Mail City', body: 'Notifications are working.' })
    n.show()
  })
  handle('update.status', () => currentUpdateStatus())
  handle('update.check', () => checkForUpdates())
  handle('update.install', () => installUpdateNow())
  handle('app.openLogs', async () => {
    await shell.openPath(app.getPath('logs'))
  })

  // ---- AI ------------------------------------------------------------------
  handle('ai.settings.get', () => kernel.ai.get())
  handle('ai.settings.set', (patch) => kernel.ai.set(patch as AiSettingsPatch))
  handle('ai.provider.upsert', ({ apiKey, ...cfg }) => {
    const p = kernel.ai.upsertProvider(cfg)
    if (apiKey !== undefined) kernel.ai.setApiKey(p.id, apiKey || null)
    return kernel.ai.get().providers.find((x) => x.id === p.id) ?? p
  })
  handle('ai.provider.remove', ({ id }) => kernel.ai.removeProvider(id))
  handle('ai.provider.setKey', ({ id, apiKey }) => kernel.ai.setApiKey(id, apiKey))
  handle('ai.provider.health', ({ id }) => kernel.ai.healthcheck(id))
  handle('ai.models.list', ({ providerId }) => kernel.ai.listModels(providerId))
  handle('ai.models.probe', ({ providerId, model }) => kernel.ai.probeModel(providerId, model))
  handle('ai.models.pull', ({ providerId, model }) => {
    void kernel.ai.pullModel(providerId, model).catch(() => {})
  })
  handle('ai.discoverLocal', ({ input, apiKey }) => kernel.ai.discoverLocal(input, apiKey))
  handle('ai.suggestRoutes', ({ providerId }) => kernel.ai.suggestRoutes(providerId))
  handle('ai.runs.list', ({ limit }) => ({ runs: kernel.ai.runs(limit), totals: kernel.ai.runTotals() }))
  handle('ai.tools.list', () => kernel.tools.list().map((t) => ({ name: t.name, description: t.description, risk: t.risk })))
  // ---- AI features ----------------------------------------------------------
  const streamTo = (streamId?: string) => (streamId ? (delta: StreamDelta) => emit('ai.stream', { streamId, delta }) : undefined)
  handle('ai.summarize', async ({ messageId }) => ({ summary: await summarizeThread(kernel, messageId) }))
  handle('ai.smartReplies', ({ messageId }) => smartReplies(kernel, messageId))
  handle('ai.extract', ({ messageId }) => extractFromMessage(kernel, messageId))
  handle('ai.extract.saveIcs', async ({ messageId, index }) => {
    const m = kernel.store.getMessage(messageId)
    const ev = (m?.aiExtract as { events?: Parameters<typeof eventToIcs>[0][] } | null)?.events?.[index]
    if (!ev) return { ok: false }
    const r = await dialog.showSaveDialog({ defaultPath: `${ev.title.replace(/[\\/:*?"<>|]/g, '_')}.ics`, filters: [{ name: 'Calendar', extensions: ['ics'] }] })
    if (r.canceled || !r.filePath) return { ok: false }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(r.filePath, eventToIcs(ev, `${messageId}-${index}`), 'utf8')
    return { ok: true, path: r.filePath }
  })
  handle('ai.draft', async ({ streamId, ...req }) => ({ text: await draftEmail(kernel, req, streamTo(streamId)) }))
  handle('ai.ruleFromText', ({ text, accountId }) => ruleFromText(kernel, text, accountId))
  handle('ai.phishing', async ({ messageId }) => {
    const d = await kernel.mail.get(messageId)
    const links = [...(d.textHtml ?? '').matchAll(/href="(https?:[^"]+)"/gi)].map((x) => x[1]!)
    const heuristics = localPhishingHeuristics(d, links)
    try {
      return { ...(await explainPhishing(kernel, messageId)), heuristics }
    } catch {
      return { risk: (heuristics.length >= 2 ? 'medium' : 'low') as 'medium' | 'low', reasons: heuristics, advice: 'AI analysis unavailable; showing automated checks only.', heuristics }
    }
  })
  handle('ai.unsubscribe.options', async ({ messageId }) => unsubscribeOptions(await kernel.mail.get(messageId)))
  handle('ai.unsubscribe.run', async ({ messageId, url }) => {
    const d = await kernel.mail.get(messageId)
    const opt = unsubscribeOptions(d).find((o) => o.url === url)
    if (!opt) return { ok: false, method: 'none' }
    if (opt.kind === 'one-click') return { ok: await oneClickUnsubscribe(opt.url), method: 'one-click' }
    if (opt.kind === 'mailto' && opt.to) {
      const identity = kernel.identities.defaultFor(d.accountId)
      const draft = kernel.drafts.save({ accountId: d.accountId, identityId: identity?.id ?? null, to: [{ name: '', address: opt.to }], subject: opt.subject ?? 'unsubscribe', html: '<p>unsubscribe</p>', text: 'unsubscribe' })
      await kernel.outbox.send(draft)
      return { ok: true, method: 'mailto' }
    }
    await shell.openExternal(opt.url)
    return { ok: true, method: 'link' }
  })
  handle('ai.askMail', ({ question, accountId, streamId }) => askMail(kernel, question, { accountId }, streamTo(streamId)))
  handle('ai.triage.backlog', async () => ({ triaged: await kernel.triage.backlog() }))
  handle('ai.index.status', () => kernel.indexer.status())
  handle('ai.index.run', async () => ({ indexed: await kernel.indexer.tick(64) }))
  handle('ai.semanticSearch', ({ query, limit }) => kernel.indexer.hybrid(query, limit ?? 30))
  kernel.indexer.on('progress', (s) => emit('ai.index.progress', { indexed: s.indexed, pending: s.pending, running: s.running, lastError: s.lastError }))
  kernel.events.on('triaged', (ids) => {
    emit('messages.triaged', { ids })
    emit('messages.changed', { accountId: '', folderId: '' })
  })

  // ---- assistant --------------------------------------------------------------
  handle('agent.sessions.list', () => kernel.agent.list())
  handle('agent.session.create', (ctx) => {
    const s = kernel.agent.create(ctx)
    return { id: s.id, title: s.title, transcript: s.transcript, context: s.context, createdAt: s.createdAt, updatedAt: s.updatedAt }
  })
  handle('agent.session.get', ({ id }) => {
    const s = kernel.agent.get(id)
    return s ? { id: s.id, title: s.title, transcript: s.transcript, context: s.context, createdAt: s.createdAt, updatedAt: s.updatedAt } : null
  })
  handle('agent.session.remove', ({ id }) => kernel.agent.remove(id))
  handle('agent.send', ({ sessionId, text }) => {
    void kernel.agent.send(sessionId, text)
  })
  handle('agent.cancel', ({ sessionId }) => kernel.agent.cancel(sessionId))
  handle('agent.confirm', ({ id, ok }) => kernel.agent.resolveConfirmation(id, ok))
  kernel.agent.on('event', (sessionId, event) => emit('agent.event', { sessionId, event }))
  kernel.agent.on('delta', (sessionId, delta) => emit('agent.delta', { sessionId, delta }))
  kernel.agent.on('done', (sessionId) => emit('agent.done', { sessionId }))
  kernel.agent.on('confirm', (sessionId, req) => emit('agent.confirm', { sessionId, ...req }))

  // ---- MCP ---------------------------------------------------------------------
  handle('mcp.settings.get', () => getMcpSettings(kernel))
  handle('mcp.settings.set', async (patch) => {
    const next = setMcpSettings(kernel, patch as McpSettingsPatch)
    if (mcpHttp) {
      if (next.httpEnabled && !mcpHttp.running) await mcpHttp.start()
      if (!next.httpEnabled && mcpHttp.running) await mcpHttp.stop()
    }
    emit('mcp.status', mcpHttp?.status() ?? { httpRunning: false, url: null, sessions: 0, stdioCommand: `${process.execPath} --mcp`, hasToken: false })
    return next
  })
  handle('mcp.status', () => mcpHttp?.status() ?? { httpRunning: false, url: null, sessions: 0, stdioCommand: `${process.execPath} --mcp`, hasToken: false })
  handle('mcp.token.reveal', () => mcpHttp?.token() ?? '')
  handle('mcp.token.regenerate', () => mcpHttp?.regenerateToken() ?? '')
  handle('mcp.confirm', ({ id, answer }) => mcpHttp?.broker.resolve(id, answer))
  handle('mcp.configSnippets', () => {
    const exe = process.execPath.replace(/\\/g, '\\\\')
    const url = mcpHttp?.url()
    const token = mcpHttp?.token() ?? ''
    return {
      claudeDesktopStdio: JSON.stringify({ mcpServers: { 'mail-city': { command: process.execPath, args: ['--mcp'] } } }, null, 2),
      claudeCodeStdio: `claude mcp add mail-city -- "${process.execPath}" --mcp`,
      claudeCodeHttp: url ? `claude mcp add --transport http mail-city ${url} --header "Authorization: Bearer ${token}"` : '',
      genericHttp: url ? JSON.stringify({ mcpServers: { 'mail-city': { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2) : '',
      exePath: exe
    }
  })

  kernel.ai.on('changed', (s) => emit('ai.settings.changed', s))
  kernel.ai.on('pullProgress', (p) => emit('ai.pullProgress', p))
  kernel.events.on('draftCreated', (id) => emit('drafts.created', { id }))

  kernel.outbox.on('changed', () => emit('outbox.changed', undefined))
  kernel.outbox.on('sent', (id) => emit('outbox.sent', { id }))
  kernel.outbox.on('failed', (id, error) => emit('outbox.failed', { id, error }))

  kernel.sync.on('status', (accountId, state, detail) => emit('sync.status', { accountId, state, detail }))
  kernel.sync.on('foldersChanged', (accountId) => emit('folders.changed', { accountId }))
  kernel.sync.on('messagesChanged', (accountId, folderId) => emit('messages.changed', { accountId, folderId }))
  kernel.sync.on('newMessages', (accountId, folderId, ids) => emit('messages.new', { accountId, folderId, ids }))
  kernel.sync.on('bodyFetched', (id) => emit('messages.bodyFetched', { id }))
}
