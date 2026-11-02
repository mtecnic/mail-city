import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, Field, Input, Select } from '@renderer/components/ui'

export function IdentitiesSettings() {
  const qc = useQueryClient()
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
  const identities = useQuery({ queryKey: ['identities'], queryFn: () => invoke('identities.list', {}) })
  const signatures = useQuery({ queryKey: ['signatures'], queryFn: () => invoke('signatures.list') })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['identities'] })
    void qc.invalidateQueries({ queryKey: ['signatures'] })
  }
  const update = useMutation({ mutationFn: (v: { id: string; patch: Record<string, unknown> }) => invoke('identities.update', v as never), onSuccess: refresh })
  const create = useMutation({ mutationFn: (accountId: string) => invoke('identities.create', { accountId, email: '', name: '' }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: string) => invoke('identities.remove', { id }), onSuccess: refresh })
  const saveSig = useMutation({ mutationFn: (s: { id?: string; name: string; html: string; text: string }) => invoke('signatures.save', s), onSuccess: refresh })
  const delSig = useMutation({ mutationFn: (id: string) => invoke('signatures.delete', { id }), onSuccess: refresh })
  const [sigDraft, setSigDraft] = useState<{ id?: string; name: string; text: string } | null>(null)

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Send-as identities</h3>
        <p className="text-xs text-muted">Aliases you can send from. The server must allow sending as the address (Gmail "Send mail as", Outlook aliases, or any address on your own domain).</p>
        {accounts.data?.map((a) => (
          <div key={a.id} className="rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-medium">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: a.color }} /> {a.displayName} · {a.email}
              </span>
              <Button size="sm" variant="ghost" onClick={() => create.mutate(a.id)}>
                <Plus className="size-3.5" /> Alias
              </Button>
            </div>
            <div className="divide-y divide-border">
              {identities.data
                ?.filter((i) => i.accountId === a.id)
                .map((i) => (
                  <div key={i.id} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] items-center gap-2 px-3 py-2 text-sm">
                    <Input placeholder="Name" defaultValue={i.name} onBlur={(e) => e.target.value !== i.name && update.mutate({ id: i.id, patch: { name: e.target.value } })} />
                    <Input placeholder="address@domain" defaultValue={i.email} onBlur={(e) => e.target.value !== i.email && /@/.test(e.target.value) && update.mutate({ id: i.id, patch: { email: e.target.value } })} />
                    <Select value={i.signatureId ?? ''} onChange={(e) => update.mutate({ id: i.id, patch: { signatureId: e.target.value || null } })}>
                      <option value="">No signature</option>
                      {signatures.data?.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-1 text-xs text-muted">
                      <input type="radio" name={`default-${a.id}`} checked={i.isDefault} onChange={() => update.mutate({ id: i.id, patch: { isDefault: true } })} /> default
                    </label>
                    <Button size="sm" variant="ghost" disabled={i.isDefault} onClick={() => remove.mutate(i.id)} aria-label="Remove">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Signatures</h3>
          <Button size="sm" onClick={() => setSigDraft({ name: 'Signature', text: '' })}>
            <Plus className="size-3.5" /> New
          </Button>
        </div>
        <div className="divide-y divide-border rounded-md border border-border">
          {signatures.data?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 cursor-pointer" onClick={() => setSigDraft({ id: s.id, name: s.name, text: s.text })}>
                {s.name}
              </span>
              <Button size="sm" variant="ghost" onClick={() => delSig.mutate(s.id)} aria-label="Delete">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {signatures.data?.length === 0 && <p className="px-3 py-3 text-xs text-muted">No signatures yet.</p>}
        </div>
        {sigDraft && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <Field label="Name">
              <Input value={sigDraft.name} onChange={(e) => setSigDraft({ ...sigDraft, name: e.target.value })} />
            </Field>
            <Field label="Text (plain; line breaks preserved)">
              <textarea className="h-28 w-full rounded-md border border-border bg-bg p-2 text-sm" value={sigDraft.text} onChange={(e) => setSigDraft({ ...sigDraft, text: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSigDraft(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const html = sigDraft.text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!).replace(/\n/g, '<br>')
                  saveSig.mutate({ id: sigDraft.id, name: sigDraft.name, html, text: sigDraft.text }, { onSuccess: () => setSigDraft(null) })
                }}
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
