import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Play, Plus, Trash2 } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, Field, Input, Select, Alert } from '@renderer/components/ui'
import type { Rule, RuleAction, RuleCondition, RuleInput } from '@shared/schemas/rules'
import { NlRuleInput } from '@renderer/features/ai/NlRuleInput'

const FIELDS: [RuleCondition['field'], string][] = [
  ['from', 'From'],
  ['to', 'To'],
  ['cc', 'Cc'],
  ['anyRecipient', 'Any recipient'],
  ['subject', 'Subject'],
  ['body', 'Body'],
  ['listId', 'List-Id'],
  ['hasAttachment', 'Has attachment'],
  ['size', 'Size (bytes)'],
  ['aiCategory', 'AI category']
]
const OPS: [RuleCondition['op'], string][] = [
  ['contains', 'contains'],
  ['notContains', 'does not contain'],
  ['equals', 'is'],
  ['startsWith', 'starts with'],
  ['endsWith', 'ends with'],
  ['regex', 'matches regex'],
  ['isTrue', 'is set'],
  ['isFalse', 'is not set'],
  ['gt', 'greater than'],
  ['lt', 'less than']
]
const ACTIONS: [RuleAction['type'], string][] = [
  ['move', 'Move to folder'],
  ['archive', 'Archive'],
  ['markRead', 'Mark as read'],
  ['flag', 'Star'],
  ['mute', 'Skip notification'],
  ['junk', 'Mark as junk'],
  ['delete', 'Delete'],
  ['setCategory', 'Set category'],
  ['forward', 'Forward to']
]

const EMPTY: RuleInput = { name: 'New rule', conditions: { match: 'all', items: [{ field: 'from', op: 'contains', value: '' }] }, actions: [{ type: 'markRead' }], accountIds: [] }

export function RulesSettings() {
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => invoke('rules.list') })
  const folders = useQuery({ queryKey: ['folders'], queryFn: () => invoke('folders.list', {}) })
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
  const [editing, setEditing] = useState<RuleInput | null>(null)
  const [applyResult, setApplyResult] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['rules'] })
  const save = useMutation({ mutationFn: (r: RuleInput) => invoke('rules.save', r), onSuccess: () => { void refresh(); setEditing(null) } })
  const remove = useMutation({ mutationFn: (id: string) => invoke('rules.remove', { id }), onSuccess: refresh })
  const reorder = useMutation({ mutationFn: (ids: string[]) => invoke('rules.reorder', { ids }), onSuccess: refresh })
  const apply = useMutation({ mutationFn: (ruleId?: string) => invoke('rules.applyNow', { ruleId }), onSuccess: (r) => setApplyResult(`Applied to ${r.affected} message${r.affected === 1 ? '' : 's'}.`) })

  const move = (idx: number, dir: -1 | 1) => {
    const ids = (rules.data ?? []).map((r) => r.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j]!, ids[idx]!]
    reorder.mutate(ids)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Rules</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => apply.mutate(undefined)} loading={apply.isPending} title="Run all rules against cached mail">
            <Play className="size-3.5" /> Apply all now
          </Button>
          <Button size="sm" variant="primary" onClick={() => setEditing(EMPTY)}>
            <Plus className="size-3.5" /> New rule
          </Button>
        </div>
      </div>
      {applyResult && <Alert kind="success">{applyResult}</Alert>}
      <p className="text-xs text-muted">Rules run in order on new mail in the inbox. Actions are applied locally first and synced to the server.</p>
      <NlRuleInput onDraft={(r) => setEditing(r)} />

      <div className="divide-y divide-border rounded-md border border-border">
        {rules.data?.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <input type="checkbox" checked={r.enabled} onChange={(e) => save.mutate({ ...r, enabled: e.target.checked })} title="Enabled" />
            <button className="flex-1 truncate text-left hover:underline" onClick={() => setEditing(r)}>
              {r.name}
            </button>
            <span className="text-xs text-muted">{describe(r, folders.data ?? [])}</span>
            <Button size="sm" variant="ghost" onClick={() => move(i, -1)} aria-label="Up">
              <ArrowUp className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => move(i, 1)} aria-label="Down">
              <ArrowDown className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => apply.mutate(r.id)} title="Apply this rule now">
              <Play className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)} aria-label="Delete">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {rules.data?.length === 0 && <p className="px-3 py-4 text-xs text-muted">No rules yet.</p>}
      </div>

      {editing && (
        <RuleEditor
          rule={editing}
          folders={folders.data ?? []}
          accounts={accounts.data ?? []}
          onCancel={() => setEditing(null)}
          onSave={(r) => save.mutate(r)}
          saving={save.isPending}
        />
      )}
    </div>
  )
}

function describe(r: Rule, folders: { id: string; name: string }[]): string {
  return r.actions
    .map((a) => {
      if (a.type === 'move') return `move to ${folders.find((f) => f.id === a.folderId)?.name ?? '?'}`
      if (a.type === 'forward') return `forward to ${a.to}`
      if (a.type === 'setCategory') return `category ${a.category}`
      return ACTIONS.find(([t]) => t === a.type)?.[1].toLowerCase() ?? a.type
    })
    .join(', ')
}

function RuleEditor({ rule, folders, accounts, onCancel, onSave, saving }: { rule: RuleInput; folders: { id: string; name: string; accountId: string; path: string }[]; accounts: { id: string; displayName: string }[]; onCancel: () => void; onSave: (r: RuleInput) => void; saving: boolean }) {
  const [r, setR] = useState<RuleInput>(rule)
  const conds: RuleCondition[] = (r.conditions?.items ?? []).map((c) => ({ ...c, value: c.value ?? '' }))
  const setConds = (items: RuleCondition[]) => setR({ ...r, conditions: { match: r.conditions?.match ?? 'all', items } })
  const setActions = (actions: RuleAction[]) => setR({ ...r, actions })

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
        </Field>
        <Field label="Accounts" hint="Leave empty for all accounts">
          <div className="flex flex-wrap gap-2 pt-1 text-xs">
            {accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={r.accountIds?.includes(a.id) ?? false}
                  onChange={(e) => setR({ ...r, accountIds: e.target.checked ? [...(r.accountIds ?? []), a.id] : (r.accountIds ?? []).filter((x) => x !== a.id) })}
                />
                {a.displayName}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          If
          <Select className="h-7 w-24" value={r.conditions?.match ?? 'all'} onChange={(e) => setR({ ...r, conditions: { match: e.target.value as 'all' | 'any', items: conds } })}>
            <option value="all">all</option>
            <option value="any">any</option>
          </Select>
          of the following match:
        </div>
        {conds.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select className="w-40" value={c.field} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, field: e.target.value as RuleCondition['field'] } : x)))}>
              {FIELDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <Select className="w-40" value={c.op} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, op: e.target.value as RuleCondition['op'] } : x)))}>
              {OPS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            {!['isTrue', 'isFalse'].includes(c.op) && c.field !== 'hasAttachment' && (
              <Input className="flex-1" value={c.value} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            )}
            <Button size="sm" variant="ghost" onClick={() => setConds(conds.filter((_, j) => j !== i))} aria-label="Remove">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setConds([...conds, { field: 'subject', op: 'contains', value: '' }])}>
          <Plus className="size-3.5" /> Condition
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium">Then:</div>
        {(r.actions ?? []).map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select
              className="w-44"
              value={a.type}
              onChange={(e) => {
                const t = e.target.value as RuleAction['type']
                const next: RuleAction = t === 'move' ? { type: 'move', folderId: folders[0]?.id ?? '' } : t === 'forward' ? { type: 'forward', to: '' } : t === 'setCategory' ? { type: 'setCategory', category: '' } : ({ type: t } as RuleAction)
                setActions((r.actions ?? []).map((x, j) => (j === i ? next : x)))
              }}
            >
              {ACTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            {a.type === 'move' && (
              <Select className="flex-1" value={a.folderId} onChange={(e) => setActions((r.actions ?? []).map((x, j) => (j === i ? { type: 'move', folderId: e.target.value } : x)))}>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {accounts.find((ac) => ac.id === f.accountId)?.displayName} / {f.path}
                  </option>
                ))}
              </Select>
            )}
            {a.type === 'forward' && <Input className="flex-1" placeholder="someone@example.com" value={a.to} onChange={(e) => setActions((r.actions ?? []).map((x, j) => (j === i ? { type: 'forward', to: e.target.value } : x)))} />}
            {a.type === 'setCategory' && <Input className="flex-1" placeholder="e.g. receipts" value={a.category} onChange={(e) => setActions((r.actions ?? []).map((x, j) => (j === i ? { type: 'setCategory', category: e.target.value } : x)))} />}
            <Button size="sm" variant="ghost" onClick={() => setActions((r.actions ?? []).filter((_, j) => j !== i))} aria-label="Remove">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setActions([...(r.actions ?? []), { type: 'markRead' }])}>
          <Plus className="size-3.5" /> Action
        </Button>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={r.stopProcessing ?? false} onChange={(e) => setR({ ...r, stopProcessing: e.target.checked })} /> Stop processing further rules when this one matches
      </label>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onSave(r)} loading={saving} disabled={!r.name || !conds.length || !(r.actions ?? []).length}>
          Save rule
        </Button>
      </div>
    </div>
  )
}
