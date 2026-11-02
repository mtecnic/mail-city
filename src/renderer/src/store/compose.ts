import { create } from 'zustand'
import type { Address } from '@shared/schemas/mail'
import type { DraftAttachment, ReplyMode } from '@shared/schemas/compose'

export interface ComposerState {
  key: string
  draftId: string | null
  accountId: string
  identityId: string | null
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  /** Initial HTML for the editor (quoted text etc.). Editor owns the live value. */
  initialHtml: string
  attachments: DraftAttachment[]
  inReplyToMessageId: string | null
  replyMode: ReplyMode | null
  minimized: boolean
  showCc: boolean
  showBcc: boolean
}

interface ComposeStore {
  composers: ComposerState[]
  open(init: Partial<ComposerState> & { accountId: string }): string
  update(key: string, patch: Partial<ComposerState>): void
  close(key: string): void
}

export const useCompose = create<ComposeStore>((set) => ({
  composers: [],
  open: (init) => {
    const key = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const c: ComposerState = {
      key,
      draftId: null,
      identityId: null,
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      initialHtml: '',
      attachments: [],
      inReplyToMessageId: null,
      replyMode: null,
      minimized: false,
      showCc: false,
      showBcc: false,
      ...init
    }
    c.showCc = c.showCc || c.cc.length > 0
    c.showBcc = c.showBcc || c.bcc.length > 0
    set((s) => ({ composers: [...s.composers.map((x) => ({ ...x, minimized: true })), c] }))
    return key
  },
  update: (key, patch) => set((s) => ({ composers: s.composers.map((c) => (c.key === key ? { ...c, ...patch } : c)) })),
  close: (key) => set((s) => ({ composers: s.composers.filter((c) => c.key !== key) }))
}))
