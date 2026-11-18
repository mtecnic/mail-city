import { useEffect } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { invoke, onEvent } from '@renderer/lib/api'
import type { MailboxSelection } from '@renderer/store/ui'
import type { ChannelInput } from '@shared/ipc'
import type { Folder, MessageFlags, MessageListItem } from '@shared/schemas/mail'
import { toast } from '@renderer/components/toast'
import { confirmDialog } from '@renderer/components/dialogs'

export function useFolders() {
  const qc = useQueryClient()
  useEffect(() => onEvent('folders.changed', () => qc.invalidateQueries({ queryKey: ['folders'] })), [qc])
  return useQuery({ queryKey: ['folders'], queryFn: () => invoke('folders.list', {}) })
}

export function listQueryFor(sel: MailboxSelection): ChannelInput<'messages.list'> {
  if (sel.kind === 'unified') {
    if (sel.specialUse === 'flagged') return { flaggedOnly: true, specialUse: 'inbox' }
    if (sel.specialUse === 'focused') return { focusedOnly: true, specialUse: 'inbox' }
    return { specialUse: sel.specialUse }
  }
  if (sel.kind === 'folder') return { accountId: sel.accountId, folderId: sel.folderId }
  if (sel.kind === 'snoozed') return { snoozedOnly: true }
  return { limit: 1, folderId: '__none__' }
}

const PAGE = 60

export function useMessageList(sel: MailboxSelection) {
  const qc = useQueryClient()
  const base = listQueryFor(sel)
  const key = ['messages', base] as const
  useEffect(
    () =>
      onEvent('messages.changed', (e) => {
        if (sel.kind !== 'folder' || e.folderId === sel.folderId) void qc.invalidateQueries({ queryKey: ['messages'] })
      }),
    [qc, sel]
  )
  const isSearch = sel.kind === 'search'
  // A search started inside a folder stays inside that folder.
  const scope = isSearch && sel.within?.kind === 'folder' ? { accountId: sel.within.accountId, folderId: sel.within.folderId } : {}
  return useInfiniteQuery({
    queryKey: isSearch ? ['messages', 'search', sel.query, scope] : key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      isSearch
        ? invoke('search.run', { query: sel.query, ...scope, limit: PAGE, offset: pageParam ? Number(pageParam) : 0 })
        : invoke('messages.list', { ...base, before: pageParam, limit: PAGE }),
    getNextPageParam: (last, pages) => (last.length < PAGE ? undefined : isSearch ? String(pages.length * PAGE) : last[last.length - 1]?.date),
    // Keep rows on screen while a refetch or the next keystroke's search is in flight.
    placeholderData: keepPreviousData
  })
}

export function useMessage(id: string | null, enabled = true) {
  const qc = useQueryClient()
  useEffect(() => onEvent('messages.bodyFetched', (e) => qc.invalidateQueries({ queryKey: ['message', e.id] })), [qc])
  return useQuery({ queryKey: ['message', id], queryFn: () => invoke('messages.get', { id: id! }), enabled: !!id && enabled, staleTime: 60_000 })
}

/** Every message of a conversation, oldest first. */
export function useThread(threadId: string | null | undefined, preferId?: string | null) {
  const qc = useQueryClient()
  useEffect(() => onEvent('messages.changed', () => qc.invalidateQueries({ queryKey: ['thread'] })), [qc])
  useEffect(() => onEvent('messages.bodyFetched', () => qc.invalidateQueries({ queryKey: ['thread'] })), [qc])
  return useQuery({
    queryKey: ['thread', threadId, preferId ?? null],
    // `preferId` keeps the copy the user opened when one email is stored in several folders.
    queryFn: async () => (await invoke('messages.thread', { threadId: threadId!, preferId: preferId ?? undefined })).slice().sort((a, b) => a.date.localeCompare(b.date)),
    enabled: !!threadId
  })
}

/** Where each message lives right now, read from whatever the UI already has cached. */
export function folderOfCached(qc: QueryClient, ids: string[]): Map<string, string> {
  const want = new Set(ids)
  const out = new Map<string, string>()
  const take = (m: { id?: string; folderId?: string } | null | undefined) => {
    if (m?.id && m.folderId && want.has(m.id) && !out.has(m.id)) out.set(m.id, m.folderId)
  }
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: ['message'] })) take(data as never)
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: ['thread'] })) for (const m of (data as MessageListItem[] | undefined) ?? []) take(m)
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: ['messages'] })) {
    const pages = (data as { pages?: MessageListItem[][] } | undefined)?.pages ?? []
    for (const p of pages) for (const m of p) take(m)
  }
  return out
}

class Cancelled extends Error {}
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function useMailActions() {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['messages'] })
    void qc.invalidateQueries({ queryKey: ['folders'] })
    void qc.invalidateQueries({ queryKey: ['thread'] })
    void qc.invalidateQueries({ queryKey: ['message'] })
  }
  const folderList = () => qc.getQueryData<Folder[]>(['folders']) ?? []
  const folderName = (id: string) => folderList().find((f) => f.id === id)?.name ?? 'folder'
  const fail = (e: unknown) => {
    if (e instanceof Cancelled) return
    toast({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
  }
  /** Undo = move each message back to the folder it came from. */
  const undoable = (text: string, before: Map<string, string>) => {
    const groups = new Map<string, string[]>()
    for (const [id, f] of before) groups.set(f, [...(groups.get(f) ?? []), id])
    toast({
      text,
      action: groups.size
        ? {
            label: 'Undo',
            run: () =>
              void Promise.all([...groups].map(([toFolderId, ids]) => invoke('messages.move', { ids, toFolderId })))
                .then(() => toast({ kind: 'success', text: 'Undone' }))
                .catch(fail)
                .finally(refresh)
          }
        : undefined
    })
  }

  const setFlags = useMutation({ mutationFn: (v: { ids: string[]; flags: Partial<MessageFlags> }) => invoke('messages.setFlags', v), onError: fail, onSettled: refresh })
  const archive = useMutation({
    mutationFn: async (ids: string[]) => {
      const before = folderOfCached(qc, ids)
      await invoke('messages.archive', { ids })
      return before
    },
    onSuccess: (before, ids) => undoable(`Archived ${plural(ids.length, 'message')}`, before),
    onError: fail,
    onSettled: refresh
  })
  const del = useMutation({
    mutationFn: async (ids: string[]) => {
      const before = folderOfCached(qc, ids)
      const permanent = ids.length > 0 && ids.every((id) => ['trash', 'junk'].includes(folderList().find((f) => f.id === before.get(id))?.specialUse ?? ''))
      if (permanent && !(await confirmDialog({ title: `Delete ${plural(ids.length, 'message')} forever?`, message: 'They are already in Trash or Junk. This cannot be undone.', okLabel: 'Delete forever', danger: true }))) throw new Cancelled()
      await invoke('messages.delete', { ids })
      return { before, permanent }
    },
    onSuccess: (r, ids) => (r.permanent ? toast({ text: `Deleted ${plural(ids.length, 'message')} forever` }) : undoable(`Moved ${plural(ids.length, 'message')} to Trash`, r.before)),
    onError: fail,
    onSettled: refresh
  })
  const move = useMutation({
    mutationFn: async (v: { ids: string[]; toFolderId: string }) => {
      const before = folderOfCached(qc, v.ids)
      await invoke('messages.move', v)
      return before
    },
    onSuccess: (before, v) => undoable(`Moved ${plural(v.ids.length, 'message')} to ${folderName(v.toFolderId)}`, before),
    onError: fail,
    onSettled: refresh
  })
  const junk = useMutation({
    mutationFn: async (v: { ids: string[]; junk: boolean }) => {
      const before = folderOfCached(qc, v.ids)
      await invoke('messages.junk', v)
      return before
    },
    onSuccess: (before, v) => undoable(v.junk ? `Marked ${plural(v.ids.length, 'message')} as junk` : `Moved ${plural(v.ids.length, 'message')} to Inbox`, before),
    onError: fail,
    onSettled: refresh
  })
  return { setFlags, archive, del, move, junk }
}
