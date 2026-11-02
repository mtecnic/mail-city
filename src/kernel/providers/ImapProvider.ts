import { ImapFlow, type FetchMessageObject, type ListResponse, type MailboxObject } from 'imapflow'
import { simpleParser, type ParsedMail, type SimpleParserOptions } from 'mailparser'
import type { ServerConfig } from '@shared/schemas/account'
import type { Credentials } from '../accounts/connectionTest'
import { imapClientOptions, describeImapError } from '../accounts/connectionTest'
import { createLogger, type Logger } from '../utils/logger'
import { TypedEmitter } from '../utils/emitter'

export interface FolderInfo {
  path: string
  name: string
  delimiter: string | null
  specialUse: string | undefined
  subscribed: boolean
  flags: string[]
}

export interface HeaderRecord {
  uid: number
  modseq: bigint | undefined
  flags: Set<string>
  labels: Set<string> | undefined
  threadId: string | undefined
  size: number
  internalDate: Date
  envelope: NonNullable<FetchMessageObject['envelope']>
  bodyStructure: FetchMessageObject['bodyStructure']
  headers: Record<string, string>
}

export interface OpenedMailbox {
  path: string
  uidValidity: bigint
  uidNext: number
  exists: number
  highestModseq: bigint | undefined
}

export type ProviderEvents = {
  exists: [path: string, count: number, prevCount: number]
  expunge: [path: string, uid: number | undefined, seq: number]
  flags: [path: string, uid: number | undefined, flags: Set<string>]
  close: []
  error: [Error]
}

const HEADER_FIELDS = ['list-unsubscribe', 'list-id', 'references', 'x-priority', 'auto-submitted', 'precedence']

/**
 * Thin, reconnecting wrapper over one ImapFlow connection. The sync engine
 * owns the lifecycle; this class only knows IMAP.
 */
export class ImapProvider extends TypedEmitter<ProviderEvents> {
  private client: ImapFlow | null = null
  private readonly log: Logger
  private connecting: Promise<void> | null = null

  constructor(
    readonly accountId: string,
    private readonly server: ServerConfig,
    private readonly getCredentials: (forceRefresh: boolean) => Promise<Credentials>,
    scope = 'imap'
  ) {
    super()
    this.log = createLogger(`${scope}:${accountId}`)
  }

  get connected(): boolean {
    return !!this.client?.usable
  }

  get capabilities(): Map<string, boolean | number> {
    return this.client?.capabilities ?? new Map()
  }

  get supportsCondstore(): boolean {
    return this.capabilities.has('CONDSTORE')
  }

  get supportsMove(): boolean {
    return this.capabilities.has('MOVE')
  }

  get isGmail(): boolean {
    return this.capabilities.has('X-GM-EXT-1')
  }

  get currentMailbox(): MailboxObject | false {
    return this.client?.mailbox ?? false
  }

  async connect(): Promise<void> {
    if (this.connected) return
    if (this.connecting) return this.connecting
    this.connecting = this.doConnect().finally(() => (this.connecting = null))
    return this.connecting
  }

  private async doConnect(): Promise<void> {
    let forceRefresh = false
    for (let attempt = 0; attempt < 2; attempt++) {
      const creds = await this.getCredentials(forceRefresh)
      const client = new ImapFlow(
        imapClientOptions(this.server, creds, {
          qresync: true,
          maxIdleTime: 25 * 60_000,
          socketTimeout: 10 * 60_000
        })
      )
      client.on('exists', (e) => this.emit('exists', e.path, e.count, e.prevCount ?? 0))
      client.on('expunge', (e) => this.emit('expunge', e.path, e.uid, e.seq ?? 0))
      client.on('flags', (e) => this.emit('flags', e.path, e.uid, e.flags))
      client.on('close', () => {
        if (this.client === client) {
          this.client = null
          this.emit('close')
        }
      })
      client.on('error', (err) => {
        this.log.warn('connection error', { message: err.message })
        this.emit('error', err)
      })
      try {
        await client.connect()
        this.client = client
        this.log.info('connected', { caps: [...client.capabilities.keys()].slice(0, 20) })
        return
      } catch (e) {
        const err = e as { authenticationFailed?: boolean }
        if (err?.authenticationFailed && 'accessToken' in creds && attempt === 0) {
          this.log.info('auth failed with cached token; refreshing')
          forceRefresh = true
          continue
        }
        throw new Error(describeImapError(e))
      }
    }
  }

  async disconnect(): Promise<void> {
    const c = this.client
    this.client = null
    if (!c) return
    try {
      await c.logout()
    } catch {
      c.close()
    }
  }

  private async c(): Promise<ImapFlow> {
    await this.connect()
    if (!this.client) throw new Error('IMAP connection unavailable')
    return this.client
  }

  async listFolders(): Promise<FolderInfo[]> {
    const client = await this.c()
    const list: ListResponse[] = await client.list()
    return list
      .filter((f) => !f.flags.has('\\Noselect') && !f.flags.has('\\NonExistent'))
      .map((f) => ({
        path: f.path,
        name: f.name,
        delimiter: f.delimiter ?? null,
        specialUse: f.specialUse,
        subscribed: f.subscribed,
        flags: [...f.flags]
      }))
  }

  async open(path: string, opts: { readOnly?: boolean; changedSince?: bigint; uidValidity?: bigint } = {}): Promise<OpenedMailbox> {
    const client = await this.c()
    const mb = await client.mailboxOpen(path, { readOnly: opts.readOnly ?? false, changedSince: opts.changedSince, uidValidity: opts.uidValidity })
    return { path: mb.path, uidValidity: mb.uidValidity, uidNext: mb.uidNext, exists: mb.exists, highestModseq: mb.highestModseq }
  }

  async status(path: string): Promise<{ messages: number; unseen: number; uidNext?: number; uidValidity?: bigint; highestModseq?: bigint } | null> {
    const client = await this.c()
    const s = await client.status(path, { messages: true, unseen: true, uidNext: true, uidValidity: true, highestModseq: true })
    if (!s) return null
    return { messages: s.messages ?? 0, unseen: s.unseen ?? 0, uidNext: s.uidNext, uidValidity: s.uidValidity, highestModseq: s.highestModseq }
  }

  /** All UIDs in the currently open mailbox. */
  async allUids(): Promise<number[]> {
    const client = await this.c()
    const r = await client.search({ all: true }, { uid: true })
    return r ? r : []
  }

  async uidsSince(date: Date): Promise<number[]> {
    const client = await this.c()
    const r = await client.search({ since: date }, { uid: true })
    return r ? r : []
  }

  /** Fetch headers for a UID range/set in the open mailbox. */
  async *fetchHeaders(range: string | number[], opts: { changedSince?: bigint } = {}): AsyncGenerator<HeaderRecord> {
    const client = await this.c()
    const r = Array.isArray(range) ? range.join(',') : range
    if (!r) return
    for await (const m of client.fetch(
      r,
      { uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true, size: true, labels: this.isGmail, threadId: true, headers: HEADER_FIELDS },
      { uid: true, changedSince: opts.changedSince }
    )) {
      if (!m.envelope) continue
      yield {
        uid: m.uid,
        modseq: m.modseq,
        flags: m.flags ?? new Set(),
        labels: m.labels,
        threadId: m.threadId,
        size: m.size ?? 0,
        internalDate: m.internalDate ? new Date(m.internalDate) : new Date(),
        envelope: m.envelope,
        bodyStructure: m.bodyStructure,
        headers: parseHeaderBuffer(m.headers)
      }
    }
  }

  /** Flags only (for incremental CONDSTORE sync). */
  async *fetchFlags(range: string, opts: { changedSince?: bigint } = {}): AsyncGenerator<{ uid: number; flags: Set<string>; labels: Set<string> | undefined; modseq: bigint | undefined }> {
    const client = await this.c()
    for await (const m of client.fetch(range, { uid: true, flags: true, labels: this.isGmail }, { uid: true, changedSince: opts.changedSince })) {
      yield { uid: m.uid, flags: m.flags ?? new Set(), labels: m.labels, modseq: m.modseq }
    }
  }

  async fetchSource(uid: number, maxBytes?: number): Promise<Buffer | null> {
    const client = await this.c()
    const dl = await client.download(String(uid), undefined, { uid: true, maxBytes })
    if (!dl.content) return null
    const chunks: Buffer[] = []
    for await (const chunk of dl.content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return Buffer.concat(chunks)
  }

  async fetchParsed(uid: number): Promise<{ parsed: ParsedMail; raw: Buffer } | null> {
    const raw = await this.fetchSource(uid)
    if (!raw) return null
    const parsed: ParsedMail = await simpleParser(raw, { skipImageLinks: false, keepCidLinks: true } as SimpleParserOptions)
    return { parsed, raw }
  }

  async downloadPart(uid: number, part: string): Promise<{ content: Buffer; contentType?: string; filename?: string } | null> {
    const client = await this.c()
    const dl = await client.download(String(uid), part, { uid: true })
    if (!dl.content) return null
    const chunks: Buffer[] = []
    for await (const chunk of dl.content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return { content: Buffer.concat(chunks), contentType: dl.meta.contentType, filename: dl.meta.filename }
  }

  async addFlags(uids: number[], flags: string[]): Promise<void> {
    const client = await this.c()
    await client.messageFlagsAdd(uids.join(','), flags, { uid: true, silent: true })
  }

  async removeFlags(uids: number[], flags: string[]): Promise<void> {
    const client = await this.c()
    await client.messageFlagsRemove(uids.join(','), flags, { uid: true, silent: true })
  }

  async addLabels(uids: number[], labels: string[]): Promise<void> {
    const client = await this.c()
    await client.messageFlagsAdd(uids.join(','), labels, { uid: true, useLabels: true, silent: true })
  }

  async removeLabels(uids: number[], labels: string[]): Promise<void> {
    const client = await this.c()
    await client.messageFlagsRemove(uids.join(','), labels, { uid: true, useLabels: true, silent: true })
  }

  /** Move messages out of the open mailbox. Returns new UIDs when the server reports them. */
  async move(uids: number[], destination: string): Promise<Map<number, number> | undefined> {
    const client = await this.c()
    const r = await client.messageMove(uids.join(','), destination, { uid: true })
    return r && typeof r === 'object' ? r.uidMap : undefined
  }

  async copy(uids: number[], destination: string): Promise<void> {
    const client = await this.c()
    await client.messageCopy(uids.join(','), destination, { uid: true })
  }

  async deletePermanently(uids: number[]): Promise<void> {
    const client = await this.c()
    await client.messageDelete(uids.join(','), { uid: true })
  }

  async append(path: string, mime: Buffer, flags: string[] = [], date?: Date): Promise<number | undefined> {
    const client = await this.c()
    const r = await client.append(path, mime, flags, date)
    return r && typeof r === 'object' ? r.uid : undefined
  }

  async createFolder(path: string): Promise<void> {
    const client = await this.c()
    await client.mailboxCreate(path)
  }

  async renameFolder(path: string, newPath: string): Promise<void> {
    const client = await this.c()
    await client.mailboxRename(path, newPath)
  }

  async deleteFolder(path: string): Promise<void> {
    const client = await this.c()
    await client.mailboxDelete(path)
  }

  async noop(): Promise<void> {
    const client = await this.c()
    await client.noop()
  }

  /** Start IDLE on the open mailbox; resolves when IDLE ends (server event or command). */
  async idle(): Promise<void> {
    const client = await this.c()
    await client.idle()
  }
}

function parseHeaderBuffer(buf: Buffer | undefined): Record<string, string> {
  if (!buf) return {}
  const out: Record<string, string> = {}
  const text = buf.toString('utf8').replace(/\r?\n[ \t]+/g, ' ')
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const val = line.slice(i + 1).trim()
    out[key] = out[key] ? `${out[key]}, ${val}` : val
  }
  return out
}
