/**
 * Export / restore dialogs for the passphrase-encrypted setup backup
 * (accounts, passwords and tokens, identities, rules, contacts, settings, AI keys).
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Alert, Button, Dialog, Field, Input } from '@renderer/components/ui'
import type { BackupHeader, ImportResult } from '@shared/schemas/backup'

const MIN = 8

export function ExportBackupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const run = useMutation({ mutationFn: () => invoke('backup.export', { passphrase: pass }) })
  const reset = () => {
    setPass('')
    setConfirm('')
    run.reset()
    onClose()
  }
  const mismatch = confirm.length > 0 && confirm !== pass
  return (
    <Dialog open={open} onClose={reset} title="Export a backup">
      {run.data?.ok ? (
        <div className="space-y-3 text-sm">
          <Alert kind="success">
            Backup written to <code className="break-all">{run.data.path}</code>
          </Alert>
          <p className="text-xs text-muted">
            {run.data.header?.counts.accounts} accounts, {run.data.header?.counts.rules} rules, {run.data.header?.counts.contacts} contacts and {run.data.header?.counts.providers} AI key(s). Keep the file and the passphrase somewhere safe: together they unlock every password and token in it.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={reset}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">
            The backup holds your accounts with their passwords and sign-in tokens, send-as identities and signatures, rules, contacts, settings, OAuth client ids and AI API keys. Mail itself is not included; it syncs again after a restore. The file is encrypted with the passphrase below (scrypt + AES-256-GCM) and works on any computer.
          </p>
          <Field label={`Passphrase (at least ${MIN} characters)`}>
            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
          </Field>
          <Field label="Confirm passphrase">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {mismatch && <Alert kind="warn">The passphrases do not match.</Alert>}
          {run.error && <Alert kind="error">{run.error.message}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => run.mutate()} disabled={pass.length < MIN || pass !== confirm} loading={run.isPending}>
              <Download className="size-4" /> Choose file & export
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export function RestoreBackupDialog({ open, onClose, onRestored }: { open: boolean; onClose: () => void; onRestored?: (r: ImportResult) => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState<{ path: string; header: BackupHeader } | null>(null)
  const [pass, setPass] = useState('')
  const pick = useMutation({ mutationFn: () => invoke('backup.inspect'), onSuccess: (r) => r && setFile(r) })
  const run = useMutation({
    mutationFn: () => invoke('backup.import', { path: file!.path, passphrase: pass }),
    onSuccess: (r) => {
      void qc.invalidateQueries()
      onRestored?.(r)
    }
  })
  const reset = () => {
    setFile(null)
    setPass('')
    pick.reset()
    run.reset()
    onClose()
  }
  const h = file?.header
  return (
    <Dialog open={open} onClose={reset} title="Restore from a backup">
      {run.data ? (
        <div className="space-y-3 text-sm">
          <Alert kind="success">Restored. Your accounts are syncing now.</Alert>
          <ul className="list-disc pl-5 text-xs text-muted">
            <li>
              {run.data.accounts.created} account(s) added, {run.data.accounts.updated} updated
            </li>
            <li>
              {run.data.identities} identities, {run.data.signatures} signatures, {run.data.rules} rules, {run.data.contacts} contacts
            </li>
            <li>
              {run.data.providers} AI provider(s), {run.data.vaultEntries} key(s)
            </li>
          </ul>
          <p className="text-xs text-muted">The MCP HTTP endpoint stays off until you enable it here; it gets a fresh token on this computer.</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={reset}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {!file ? (
            <>
              <p className="text-xs text-muted">Pick a <code>.mailcity</code> file made with <em>Export a backup</em> on another computer. Accounts that already exist here are updated by e-mail address; nothing is deleted.</p>
              {pick.error && <Alert kind="error">{pick.error.message}</Alert>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={reset}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => pick.mutate()} loading={pick.isPending}>
                  <Upload className="size-4" /> Choose file…
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-md border border-border bg-panel px-3 py-2 text-xs">
                <div className="truncate font-medium" title={file.path}>
                  {file.path.split(/[\\/]/).pop()}
                </div>
                <div className="text-muted">
                  Made {new Date(h!.createdAt).toLocaleString()} with Mail City {h!.appVersion} on {h!.platform === 'win32' ? 'Windows' : h!.platform === 'darwin' ? 'macOS' : h!.platform}
                </div>
                <div className="text-muted">
                  {h!.counts.accounts} accounts · {h!.counts.rules} rules · {h!.counts.contacts} contacts · {h!.counts.providers} AI key(s)
                </div>
              </div>
              <Field label="Passphrase">
                <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && pass && run.mutate()} />
              </Field>
              {run.error && <Alert kind="error">{run.error.message}</Alert>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setFile(null)}>
                  Back
                </Button>
                <Button variant="primary" onClick={() => run.mutate()} disabled={!pass} loading={run.isPending}>
                  Restore
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}
