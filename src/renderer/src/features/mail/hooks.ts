import { useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  if (sel.kind === 'unified') return sel.specialUse === 'flagged' ? { flaggedOnly: true, specialUse: 'inbox' } : { specialUse: sel.specialUse }
  if (sel.kind === 'folder') return { accountId: sel.accountId, folderId: sel.folderId }
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
  return useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => invoke('messages.list', { ...base, before: pageParam, limit: PAGE }),
    getNextPageParam: (last) => (last.length < PAGE ? undefined : last[last.length - 1]?.date)
  })
}

export function useMessage(id: string | null) {
  const qc = useQueryClient()
  useEffect(() => onEvent('messages.bodyFetched', (e) => qc.invalidateQueries({ queryKey: ['message', e.id] })), [qc])
  return useQuery({ queryKey: ['message', id], queryFn: () => invoke('messages.get', { id: id! }), enabled: !!id, staleTime: 60_000 })
}

export function useThread(threadId: string | null | undefined) {
  return useQuery({ queryKey: ['thread', threadId], queryFn: () => invoke('messages.thread', { threadId: threadId! }), enabled: !!threadId })
}

export function useMailActions() {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['messages'] })
    void qc.invalidateQueries({ queryKey: ['folders'] })
    void qc.invalidateQueries({ queryKey: ['thread'] })
  }
  const setFlags = useMutation({ mutationFn: (v: { ids: string[]; flags: Partial<MessageFlags> }) => invoke('messages.setFlags', v), onSettled: refresh })
  const archive = useMutation({ mutationFn: (ids: string[]) => invoke('messages.archive', { ids }), onSettled: refresh })
  const del = useMutation({ mutationFn: (ids: string[]) => invoke('messages.delete', { ids }), onSettled: refresh })
  const move = useMutation({ mutationFn: (v: { ids: string[]; toFolderId: string }) => invoke('messages.move', v), onSettled: refresh })
  const junk = useMutation({ mutationFn: (v: { ids: string[]; junk: boolean }) => invoke('messages.junk', v), onSettled: refresh })
  return { setFlags, archive, del, move, junk }
}
