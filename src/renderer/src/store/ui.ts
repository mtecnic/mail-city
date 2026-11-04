import { create } from 'zustand'

export type MailboxSelection =
  | { kind: 'unified'; specialUse: 'inbox' | 'flagged' | 'sent' | 'drafts' | 'focused' }
  | { kind: 'folder'; accountId: string; folderId: string }
  | { kind: 'outbox' }
  | { kind: 'snoozed' }
  /** `within` is the mailbox that was open when the search started; clearing the box returns to it. */
  | { kind: 'search'; query: string; within?: MailboxSelection | null }

interface UiState {
  mailbox: MailboxSelection
  selectedMessageId: string | null
  selectedIds: string[]
  settingsOpen: boolean
  /** Overlays shared across panes. */
  editAccount: { id: string; tab: 'general' | 'servers' | 'signin' } | null
  sourceMessageId: string | null
  openEditAccount(id: string, tab?: 'general' | 'servers' | 'signin'): void
  closeEditAccount(): void
  setSourceMessageId(id: string | null): void
  setMailbox(sel: MailboxSelection): void
  selectMessage(id: string | null, opts?: { toggle?: boolean; range?: string[] }): void
  /** Tick / untick a row without opening it (checkboxes, Ctrl-click, `x`). */
  toggleSelected(id: string): void
  clearSelection(): void
  setSettingsOpen(open: boolean): void
  /** Bumped by the Enter shortcut; the conversation view toggles the focused message. */
  cardToggle: number
  toggleCard(): void
}

export const useUi = create<UiState>((set) => ({
  mailbox: { kind: 'unified', specialUse: 'inbox' },
  selectedMessageId: null,
  selectedIds: [],
  settingsOpen: false,
  editAccount: null,
  sourceMessageId: null,
  openEditAccount: (id, tab = 'general') => set({ editAccount: { id, tab } }),
  closeEditAccount: () => set({ editAccount: null }),
  setSourceMessageId: (sourceMessageId) => set({ sourceMessageId }),
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
  toggleSelected: (id) =>
    set((s) => {
      const has = s.selectedIds.includes(id)
      const next = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
      // Unticking the opened message closes it; ticking never opens anything.
      return { selectedIds: next, selectedMessageId: has && s.selectedMessageId === id ? null : s.selectedMessageId }
    }),
  clearSelection: () => set({ selectedMessageId: null, selectedIds: [] }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  cardToggle: 0,
  toggleCard: () => set((s) => ({ cardToggle: s.cardToggle + 1 }))
}))
