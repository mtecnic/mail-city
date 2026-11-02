import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/api'
import { useCompose } from '@renderer/store/compose'
import { useUi } from '@renderer/store/ui'
import type { ReplyMode } from '@shared/schemas/compose'

/** Opens composers for new mail, replies and existing drafts. */
export function useComposeActions() {
  const open = useCompose((s) => s.open)
  const qc = useQueryClient()
  const mailbox = useUi((s) => s.mailbox)

  const newMessage = useCallback(
    async (accountId?: string) => {
      const accounts = await qc.fetchQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
      const id = accountId ?? (mailbox.kind === 'folder' ? mailbox.accountId : accounts[0]?.id)
      if (!id) return
      const identities = await invoke('identities.list', { accountId: id })
      open({ accountId: id, identityId: identities.find((i) => i.isDefault)?.id ?? identities[0]?.id ?? null })
    },
    [open, qc, mailbox]
  )

  const reply = useCallback(
    async (messageId: string, mode: ReplyMode) => {
      const t = await invoke('compose.replyTemplate', { messageId, mode })
      open({
        accountId: t.accountId,
        identityId: t.identityId,
        to: t.to,
        cc: t.cc,
        subject: t.subject,
        initialHtml: `<p></p>${t.quotedHtml}`,
        attachments: t.attachments,
        inReplyToMessageId: t.inReplyToMessageId,
        replyMode: t.replyMode
      })
    },
    [open]
  )

  const openDraft = useCallback(
    async (draftId: string) => {
      const d = await invoke('drafts.get', { id: draftId })
      if (!d) return
      open({
        draftId: d.id,
        accountId: d.accountId,
        identityId: d.identityId,
        to: d.to,
        cc: d.cc,
        bcc: d.bcc,
        subject: d.subject,
        initialHtml: d.html,
        attachments: d.attachments,
        inReplyToMessageId: d.inReplyToMessageId,
        replyMode: d.replyMode
      })
    },
    [open]
  )

  return { newMessage, reply, openDraft }
}
