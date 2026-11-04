import { useEffect } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke, onEvent } from '@renderer/lib/api'
import type { MailboxSelection } from '@renderer/store/ui'
import type { ChannelInput } from '@shared/ipc'
import type { MessageFlags } from '@shared/schemas/mail'

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
export function useThread(threadId: string | null | undefined) {
  const qc = useQueryClient()
  useEffect(() => onEvent('messages.changed', () => qc.invalidateQueries({ queryKey: ['thread'] })), [qc])
  useEffect(() => onEvent('messages.bodyFetched', () => qc.invalidateQueries({ queryKey: ['thread'] })), [qc])
  return useQuery({
    queryKey: ['thread', threadId],
    queryFn: async () => (await invoke('messages.thread', { threadId: threadId! })).slice().sort((a, b) => a.date.localeCompare(b.date)),
    enabled: !!threadId
  })
}

export function useMailActions() {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['messages'] })
    void qc.invalidateQueries({ queryKey: ['folders'] })
    void qc.invalidateQueries({ queryKey: ['thread'] })
    void qc.invalidateQueries({ queryKey: ['message'] })
  }
  const setFlags = useMutation({ mutationFn: (v: { ids: string[]; flags: Partial<MessageFlags> }) => invoke('messages.setFlags', v), onSettled: refresh })
  const archive = useMutation({ mutationFn: (ids: string[]) => invoke('messages.archive', { ids }), onSettled: refresh })
  const del = useMutation({ mutationFn: (ids: string[]) => invoke('messages.delete', { ids }), onSettled: refresh })
  const move = useMutation({ mutationFn: (v: { ids: string[]; toFolderId: string }) => invoke('messages.move', v), onSettled: refresh })
  const junk = useMutation({ mutationFn: (v: { ids: string[]; junk: boolean }) => invoke('messages.junk', v), onSettled: refresh })
  return { setFlags, archive, del, move, junk }
}
