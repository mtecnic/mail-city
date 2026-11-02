import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, Field, Input, Alert } from '@renderer/components/ui'
import { AddAccountDialog } from '@renderer/features/accounts/AddAccountDialog'
import type { OAuthClientConfig } from '@shared/schemas/oauth'

export function AccountsSettings() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
  const remove = useMutation({
    mutationFn: (id: string) => invoke('accounts.remove', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts.list'] })
  })

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Accounts</h3>
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add account
          </Button>
        </div>
        <div className="divide-y divide-border rounded-md border border-border">
          {accounts.data?.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="size-2.5 rounded-full" style={{ background: a.color }} />
              <div className="flex-1">
                <div className="font-medium">{a.displayName}</div>
                <div className="text-xs text-muted">
                  {a.email} · {a.authType === 'oauth2' ? 'OAuth' : 'Password'}
                  {a.lastError && <span className="ml-2 text-danger">{a.lastError}</span>}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => confirm(`Remove ${a.email}? Local cache for this account will be deleted.`) && remove.mutate(a.id)} aria-label="Remove">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {accounts.data?.length === 0 && <p className="px-3 py-4 text-xs text-muted">No accounts yet.</p>}
        </div>
      </section>

      <OAuthClientsSection />
      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function OAuthClientsSection() {
  const qc = useQueryClient()
  const cfg = useQuery({ queryKey: ['oauth.config'], queryFn: () => invoke('oauth.config.get') })
  const [draft, setDraft] = useState<OAuthClientConfig | null>(null)
  const value = draft ?? cfg.data?.user
  const save = useMutation({
    mutationFn: (c: OAuthClientConfig) => invoke('oauth.config.set', c),
    onSuccess: () => {
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['oauth.config'] })
    }
  })
  if (!value) return null
  const set = (patch: Partial<OAuthClientConfig['google']> | Partial<OAuthClientConfig['microsoft']>, key: 'google' | 'microsoft') =>
    setDraft({ ...value, [key]: { ...value[key], ...patch } } as OAuthClientConfig)

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">OAuth clients</h3>
      <Alert kind="info">
        Google and Microsoft require an OAuth app to sign in. {cfg.data?.hasGoogle || cfg.data?.hasMicrosoft ? 'This build ships defaults; you can override them here.' : 'Create your own (free) and paste the IDs here — see docs/OAUTH-SETUP.md.'}
      </Alert>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-xs font-medium">Google {cfg.data?.hasGoogle && !value.google.clientId && <span className="text-muted">(using built-in)</span>}</div>
          <Field label="Client ID">
            <Input value={value.google.clientId} onChange={(e) => set({ clientId: e.target.value }, 'google')} />
          </Field>
          <Field label="Client secret">
            <Input type="password" value={value.google.clientSecret} onChange={(e) => set({ clientSecret: e.target.value }, 'google')} />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium">Microsoft {cfg.data?.hasMicrosoft && !value.microsoft.clientId && <span className="text-muted">(using built-in)</span>}</div>
          <Field label="Application (client) ID">
            <Input value={value.microsoft.clientId} onChange={(e) => set({ clientId: e.target.value }, 'microsoft')} />
          </Field>
          <Field label="Tenant" hint="common = personal + work accounts">
            <Input value={value.microsoft.tenant} onChange={(e) => set({ tenant: e.target.value }, 'microsoft')} />
          </Field>
        </div>
      </div>
      {draft && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={() => save.mutate(draft)} loading={save.isPending}>
            Save
          </Button>
        </div>
      )}
    </section>
  )
}
