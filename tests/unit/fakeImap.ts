/**
 * In-memory IMAP server double with the ImapProvider surface, for sync-engine tests.
 */
import { ImapProvider, type FolderInfo, type HeaderRecord, type OpenedMailbox } from '@kernel/providers/ImapProvider'

export interface FakeMessage {
  uid: number
  subject: string
  from: string
  date: Date
  flags: Set<string>
  body?: string
  messageId?: string
}

export class FakeMailbox {
  uidValidity = 1n
  uidNext = 1
  modseq = 1n
  messages = new Map<number, FakeMessage>()
  constructor(readonly path: string, readonly specialUse?: string) {}
  add(m: Omit<FakeMessage, 'uid' | 'flags'> & { flags?: string[] }): FakeMessage {
    const msg: FakeMessage = { ...m, uid: this.uidNext++, flags: new Set(m.flags ?? []), messageId: m.messageId ?? `<${this.path}-${this.uidNext}@fake>` }
    this.messages.set(msg.uid, msg)
    this.modseq++
    return msg
  }
}

export class FakeImapProvider extends ImapProvider {
  mailboxes = new Map<string, FakeMailbox>()
  open_: FakeMailbox | null = null
  ops: string[] = []
  caps = new Map<string, boolean | number>([['CONDSTORE', true], ['MOVE', true]])

  constructor(accountId = 'acct') {
    super(accountId, { host: 'fake', port: 993, tls: 'tls' }, async () => ({ user: 'u', pass: 'p' }))
    this.mailboxes.set('INBOX', new FakeMailbox('INBOX', '\\Inbox'))
    this.mailboxes.set('Sent', new FakeMailbox('Sent', '\\Sent'))
    this.mailboxes.set('Trash', new FakeMailbox('Trash', '\\Trash'))
    this.mailboxes.set('Archive', new FakeMailbox('Archive', '\\Archive'))
  }
  box(path: string): FakeMailbox {
    const b = this.mailboxes.get(path)
    if (!b) throw new Error(`NONEXISTENT mailbox ${path}`)
    return b
  }
  override get connected() {
    return true
  }
  override get capabilities() {
    return this.caps
  }
  override get currentMailbox() {
    return this.open_ ? ({ path: this.open_.path } as never) : (false as const)
  }
  override async connect() {}
  override async disconnect() {}
  override async listFolders(): Promise<FolderInfo[]> {
    return [...this.mailboxes.values()].map((b) => ({ path: b.path, name: b.path, delimiter: '/', specialUse: b.specialUse, subscribed: true, flags: [] }))
  }
  override async open(path: string): Promise<OpenedMailbox> {
    const b = this.box(path)
    this.open_ = b
    return { path, uidValidity: b.uidValidity, uidNext: b.uidNext, exists: b.messages.size, highestModseq: b.modseq }
  }
  override async allUids() {
    return [...this.open_!.messages.keys()]
  }
  override async uidsSince(date: Date) {
    return [...this.open_!.messages.values()].filter((m) => m.date >= date).map((m) => m.uid)
  }
  private rec(m: FakeMessage): HeaderRecord {
    return { uid: m.uid, modseq: this.open_!.modseq, flags: new Set(m.flags), labels: undefined, threadId: undefined, size: 100, internalDate: m.date, bodyStructure: undefined, headers: {}, envelope: { subject: m.subject, messageId: m.messageId, from: [{ name: '', address: m.from }], to: [{ address: 'me@test' }], date: m.date } }
  }
  private range(r: string | number[]): FakeMessage[] {
    const all = [...this.open_!.messages.values()].sort((a, b) => a.uid - b.uid)
    if (Array.isArray(r)) return all.filter((m) => r.includes(m.uid))
    const [from, to] = r.split(':')
    const lo = Number(from)
    const hi = to === '*' ? Infinity : Number(to)
    return all.filter((m) => m.uid >= lo && m.uid <= hi)
  }
  override async *fetchHeaders(range: string | number[]) {
    for (const m of this.range(range)) yield this.rec(m)
  }
  override async *fetchFlags(range: string) {
    for (const m of this.range(range)) yield { uid: m.uid, flags: new Set(m.flags), labels: undefined, modseq: this.open_!.modseq }
  }
  override async fetchParsed(uid: number) {
    const m = this.open_!.messages.get(uid)
    if (!m) return null
    const raw = Buffer.from(`From: ${m.from}\r\nTo: me@test\r\nSubject: ${m.subject}\r\nMessage-ID: ${m.messageId}\r\nDate: ${m.date.toUTCString()}\r\nContent-Type: text/plain\r\n\r\n${m.body ?? ''}`)
    const { simpleParser } = await import('mailparser')
    return { parsed: await simpleParser(raw), raw }
  }
  override async addFlags(uids: number[], flags: string[]) {
    this.ops.push(`addFlags ${uids} ${flags}`)
    for (const u of uids) flags.forEach((f) => this.open_!.messages.get(u)?.flags.add(f))
    this.open_!.modseq++
  }
  override async removeFlags(uids: number[], flags: string[]) {
    this.ops.push(`removeFlags ${uids} ${flags}`)
    for (const u of uids) flags.forEach((f) => this.open_!.messages.get(u)?.flags.delete(f))
    this.open_!.modseq++
  }
  override async move(uids: number[], destination: string) {
    this.ops.push(`move ${uids} -> ${destination}`)
    const dest = this.box(destination)
    const map = new Map<number, number>()
    for (const u of uids) {
      const m = this.open_!.messages.get(u)
      if (!m) continue
      this.open_!.messages.delete(u)
      const nm = dest.add({ subject: m.subject, from: m.from, date: m.date, body: m.body, messageId: m.messageId, flags: [...m.flags] })
      map.set(u, nm.uid)
    }
    return map
  }
  override async deletePermanently(uids: number[]) {
    this.ops.push(`delete ${uids}`)
    for (const u of uids) this.open_!.messages.delete(u)
  }
  override async append(path: string, mime: Buffer, flags: string[] = []) {
    this.ops.push(`append ${path}`)
    const subject = mime.toString().match(/^Subject: (.*)$/m)?.[1] ?? ''
    return this.box(path).add({ subject, from: 'me@test', date: new Date(), flags, body: '' }).uid
  }
  override async idle() {}
  override async noop() {}
}
