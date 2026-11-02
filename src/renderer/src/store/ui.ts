import { create } from 'zustand'

export type MailboxSelection =
  | { kind: 'unified'; specialUse: 'inbox' | 'flagged' | 'sent' | 'drafts' | 'focused' }
  | { kind: 'folder'; accountId: string; folderId: string }
  | { kind: 'outbox' }
  | { kind: 'snoozed' }
  | { kind: 'search'; query: string }

interface UiState {
  mailbox: MailboxSelection
  selectedMessageId: string | null
  selectedIds: string[]
  settingsOpen: boolean
  setMailbox(sel: MailboxSelection): void
  selectMessage(id: string | null, opts?: { toggle?: boolean; range?: string[] }): void
  clearSelection(): void
  setSettingsOpen(open: boolean): void
}

export const useUi = create<UiState>((set) => ({
  mailbox: { kind: 'unified', specialUse: 'inbox' },
  selectedMessageId: null,
  selectedIds: [],
  settingsOpen: false,
  setMailbox: (mailbox) => set({ mailbox, selectedMessageId: null, selectedIds: [] }),
  selectMessage: (id, opts) =>
    set((s) => {
      if (id === null) return { selectedMessageId: null, selectedIds: [] }
      if (opts?.range) return { selectedMessageId: id, selectedIds: opts.range }
      if (opts?.toggle) {
        const has = s.selectedIds.includes(id)
        const next = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
        return { selectedIds: next, selectedMessageId: next.length === 1 ? next[0]! : has ? s.selectedMessageId : id }
      }
      return { selectedMessageId: id, selectedIds: [id] }
    }),
  clearSelection: () => set({ selectedMessageId: null, selectedIds: [] }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen })
}))
