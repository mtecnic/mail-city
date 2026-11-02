import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, X } from 'lucide-react'
import { invoke, onEvent } from '@renderer/lib/api'
import { useUi } from '@renderer/store/ui'
import { useCompose } from '@renderer/store/compose'
import { useComposeActions } from '@renderer/features/compose/useComposeActions'
import { Button } from '@renderer/components/ui'
import type { ChannelOutput } from '@shared/ipc'

/** Wires main-process app events (mailto:, tray, notifications, jump list) into the UI. */
export function AppEvents() {
  const qc = useQueryClient()
  const { setMailbox, selectMessage, setSettingsOpen } = useUi()
  const open = useCompose((s) => s.open)
  const { newMessage } = useComposeActions()

  useEffect(() => {
    const openMailto = async (req: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string }) => {
      const accounts = await qc.fetchQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
      const acct = accounts[0]
      if (!acct) return
      const identities = await invoke('identities.list', { accountId: acct.id })
      const addr = (s: string) => ({ name: '', address: s.toLowerCase() })
      const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
      open({
        accountId: acct.id,
        identityId: identities.find((i) => i.isDefault)?.id ?? null,
        to: req.to.map(addr),
        cc: req.cc.map(addr),
        bcc: req.bcc.map(addr),
        subject: req.subject,
        initialHtml: req.body ? `<p>${esc(req.body).replace(/\n/g, '<br>')}</p>` : ''
      })
    }
    const offs = [
      onEvent('app.mailto', (req) => void openMailto(req)),
      onEvent('app.compose', () => void newMessage()),
      onEvent('app.openSettings', () => setSettingsOpen(true)),
      onEvent('app.openMessage', (e) => {
        setSettingsOpen(false)
        setMailbox({ kind: 'folder', accountId: e.accountId, folderId: e.folderId })
        setTimeout(() => selectMessage(e.id), 50)
      }),
      onEvent('app.openOutbox', () => {
        setSettingsOpen(false)
        setMailbox({ kind: 'outbox' })
      })
    ]
    void invoke('app.pendingMailto').then((req) => req && openMailto(req))
    return () => offs.forEach((off) => off())
  }, [qc, open, newMessage, setMailbox, selectMessage, setSettingsOpen])

  return null
}

export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [status, setStatus] = useState<ChannelOutput<'update.status'>>({ state: 'idle' })
  const initial = useQuery({ queryKey: ['update.status'], queryFn: () => invoke('update.status') })
  useEffect(() => {
    if (initial.data) setStatus(initial.data)
  }, [initial.data])
  useEffect(() => onEvent('update.status', (s) => { setStatus(s); setDismissed(false) }), [])
  if (dismissed) return null
  if (status.state === 'downloaded') {
    return (
      <div className="flex items-center gap-3 border-b border-border bg-accent/10 px-4 py-1.5 text-xs">
        <Download className="size-3.5 text-accent" />
        <span className="flex-1">Mail City {status.version} is ready to install.</span>
        <Button size="sm" variant="primary" onClick={() => invoke('update.install')}>
          <RefreshCw className="size-3.5" /> Restart & update
        </Button>
        <button className="text-muted hover:text-fg" onClick={() => setDismissed(true)} aria-label="Dismiss">
          <X className="size-3.5" />
        </button>
      </div>
    )
  }
  if (status.state === 'downloading') {
    return <div className="border-b border-border bg-panel px-4 py-1 text-xs text-muted">Downloading update… {status.percent}%</div>
  }
  return null
}
