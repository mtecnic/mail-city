/**
 * Folder management + bulk folder actions. Local cache is updated first,
 * then an op is queued for the server (same pattern as MessageService).
 */
import { and, eq, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { messages } from '../db/schema'
import type { MessageStore } from './MessageStore'
import type { SyncEngine } from '../sync/SyncEngine'
import { KernelError } from '../utils/result'

const SPECIAL_PROTECTED = new Set(['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'all'])

export class FolderService {
  constructor(
    private readonly db: DB,
    private readonly store: MessageStore,
    private readonly sync: SyncEngine
  ) {}

  create(accountId: string, name: string, parentId?: string | null): void {
    const clean = name.trim()
    if (!clean || /[\\/]/.test(clean) && !parentId) throw new KernelError('BAD_NAME', 'Folder names cannot contain slashes')
    let path = clean
    if (parentId) {
      const parent = this.store.getFolder(parentId)
      if (!parent || parent.accountId !== accountId) throw new KernelError('NOT_FOUND', 'Parent folder not found')
      path = `${parent.path}${parent.delimiter ?? '/'}${clean}`
    }
    if (this.store.folderByPath(accountId, path)) throw new KernelError('EXISTS', 'A folder with that name already exists')
    this.sync.enqueue(accountId, { kind: 'createFolder', path })
  }

  rename(folderId: string, name: string): void {
    const f = this.store.getFolder(folderId)
    if (!f) throw new KernelError('NOT_FOUND', 'Folder not found')
    if (f.specialUse && SPECIAL_PROTECTED.has(f.specialUse)) throw new KernelError('PROTECTED', 'System folders cannot be renamed')
    const clean = name.trim()
    if (!clean || /[\\/]/.test(clean)) throw new KernelError('BAD_NAME', 'Invalid folder name')
    const delim = f.delimiter ?? '/'
    const idx = f.path.lastIndexOf(delim)
    const newPath = idx >= 0 ? `${f.path.slice(0, idx + 1)}${clean}` : clean
    this.store.updateFolder(folderId, { path: newPath, name: clean })
    this.sync.enqueue(f.accountId, { kind: 'renameFolder', path: f.path, newPath })
  }

  delete(folderId: string): void {
    const f = this.store.getFolder(folderId)
    if (!f) throw new KernelError('NOT_FOUND', 'Folder not found')
    if (f.specialUse && SPECIAL_PROTECTED.has(f.specialUse)) throw new KernelError('PROTECTED', 'System folders cannot be deleted')
    this.store.deleteFolder(folderId)
    this.sync.enqueue(f.accountId, { kind: 'deleteFolder', path: f.path })
  }

  /** Mark every cached unread message in the folder as read (one server op). */
  markAllRead(folderId: string): number {
    const f = this.store.getFolder(folderId)
    if (!f) throw new KernelError('NOT_FOUND', 'Folder not found')
    const rows = this.db
      .select({ id: messages.id, uid: messages.uid })
      .from(messages)
      .where(and(eq(messages.folderId, folderId), sql`json_extract(${messages.flags}, '$.seen') = 0`))
      .all()
    if (!rows.length) return 0
    this.store.setLocalFlags(rows.map((r) => r.id), { seen: true })
    const uids = rows.map((r) => r.uid).filter((u) => u > 0)
    if (uids.length) this.sync.enqueue(f.accountId, { kind: 'setFlags', folderPath: f.path, uids, add: ['\\Seen'], remove: [] })
    this.store.refreshFolderCounts(folderId)
    return rows.length
  }

  /** Permanently delete everything in Trash or Junk. */
  empty(folderId: string): number {
    const f = this.store.getFolder(folderId)
    if (!f) throw new KernelError('NOT_FOUND', 'Folder not found')
    if (f.specialUse !== 'trash' && f.specialUse !== 'junk') throw new KernelError('NOT_ALLOWED', 'Only Trash and Junk can be emptied')
    const rows = this.db.select({ id: messages.id, uid: messages.uid }).from(messages).where(eq(messages.folderId, folderId)).all()
    this.store.deleteByIds(rows.map((r) => r.id))
    const uids = rows.map((r) => r.uid).filter((u) => u > 0)
    if (uids.length) this.sync.enqueue(f.accountId, { kind: 'delete', folderPath: f.path, uids })
    this.store.refreshFolderCounts(folderId)
    return rows.length
  }
}
