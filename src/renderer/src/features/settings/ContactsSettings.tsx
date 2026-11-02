import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Merge, Plus, Trash2, Upload } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, Field, Input, Alert } from '@renderer/components/ui'

export function ContactsSettings() {
  const qc = useQueryClient()
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => invoke('contacts.list') })
  const dupes = useQuery({ queryKey: ['contacts.dupes'], queryFn: () => invoke('contacts.duplicates') })
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<{ id?: string; name: string; emails: string; notes: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['contacts'] })
    void qc.invalidateQueries({ queryKey: ['contacts.dupes'] })
  }
  const save = useMutation({
    mutationFn: (c: { id?: string; name: string; emails: string[]; notes: string | null }) => invoke('contacts.save', c),
    onSuccess: () => {
      refresh()
      setEditing(null)
    }
  })
  const remove = useMutation({ mutationFn: (id: string) => invoke('contacts.remove', { id }), onSuccess: refresh })
  const merge = useMutation({ mutationFn: (ids: string[]) => invoke('contacts.merge', { ids }), onSuccess: refresh })
  const imp = useMutation({ mutationFn: () => invoke('contacts.import'), onSuccess: (r) => { refresh(); setNote(`Imported ${r.imported} contacts.`) } })
  const exp = useMutation({ mutationFn: () => invoke('contacts.export'), onSuccess: (r) => r.ok && setNote(`Exported to ${r.path}`) })

  const f = filter.toLowerCase()
  const list = (contacts.data ?? []).filter((c) => !f || c.name.toLowerCase().includes(f) || c.emails.some((e) => e.includes(f)))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Contacts</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => imp.mutate()} loading={imp.isPending}>
            <Upload className="size-3.5" /> Import vCard
          </Button>
          <Button size="sm" variant="ghost" onClick={() => exp.mutate()} loading={exp.isPending}>
            <Download className="size-3.5" /> Export
          </Button>
          <Button size="sm" variant="primary" onClick={() => setEditing({ name: '', emails: '', notes: '' })}>
            <Plus className="size-3.5" /> New
          </Button>
        </div>
      </div>
      {note && <Alert kind="success">{note}</Alert>}
      <p className="text-xs text-muted">People you write to are collected automatically and ranked for autocomplete. {contacts.data?.length ?? 0} contacts.</p>

      {(dupes.data?.length ?? 0) > 0 && (
        <div className="space-y-1 rounded-md border border-border p-3">
          <div className="text-xs font-medium">Possible duplicates</div>
          {dupes.data!.slice(0, 10).map((g) => (
            <div key={g[0]!.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate">
                {g[0]!.name}: {g.flatMap((c) => c.emails).join(', ')}
              </span>
              <Button size="sm" variant="ghost" onClick={() => merge.mutate(g.map((c) => c.id))}>
                <Merge className="size-3.5" /> Merge
              </Button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <Field label="Name">
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <Field label="Email addresses (comma separated)">
            <Input value={editing.emails} onChange={(e) => setEditing({ ...editing, emails: e.target.value })} />
          </Field>
          <Field label="Notes">
            <Input value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ id: editing.id, name: editing.name, emails: editing.emails.split(/[,\s;]+/).filter(Boolean), notes: editing.notes || null })}>
              Save
            </Button>
          </div>
        </div>
      )}

      <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
        {list.slice(0, 500).map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <button className="min-w-0 flex-1 text-left" onClick={() => setEditing({ id: c.id, name: c.name, emails: c.emails.join(', '), notes: c.notes ?? '' })}>
              <div className="truncate font-medium">{c.name || c.primaryEmail}</div>
              <div className="truncate text-xs text-muted">
                {c.emails.join(', ')} · sent {c.sendCount} · received {c.receiveCount}
              </div>
            </button>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)} aria-label="Delete">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {list.length === 0 && <p className="px-3 py-4 text-xs text-muted">No contacts.</p>}
      </div>
    </div>
  )
}
