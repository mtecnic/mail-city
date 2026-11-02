import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, Input, Alert } from '@renderer/components/ui'
import type { RuleInput } from '@shared/schemas/rules'

/** "Move newsletters from Substack to Reading" → rule preview → save. */
export function NlRuleInput({ onDraft }: { onDraft: (rule: RuleInput) => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ rule: RuleInput; explanation: string } | null>(null)
  const make = useMutation({ mutationFn: () => invoke('ai.ruleFromText', { text }), onSuccess: (r) => setPreview(r) })
  const save = useMutation({
    mutationFn: () => invoke('rules.save', preview!.rule),
    onSuccess: () => {
      setPreview(null)
      setText('')
      void qc.invalidateQueries({ queryKey: ['rules'] })
    }
  })
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-1 text-xs font-medium">
        <Sparkles className="size-3.5 text-accent" /> Describe a rule in plain words
      </div>
      <div className="flex gap-2">
        <Input placeholder='e.g. "archive GitHub notifications and mark them read"' value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && make.mutate()} />
        <Button onClick={() => make.mutate()} disabled={!text.trim()} loading={make.isPending}>
          Create
        </Button>
      </div>
      {make.error && <Alert kind="error">{make.error.message}</Alert>}
      {preview && (
        <div className="space-y-2 text-xs">
          <div className="rounded border border-border bg-bg px-3 py-2">
            <div className="font-medium">{preview.rule.name}</div>
            <div className="text-muted">
              If {preview.rule.conditions?.match ?? 'all'} of: {preview.rule.conditions?.items?.map((c) => `${c.field} ${c.op} "${c.value ?? ''}"`).join('; ')}
            </div>
            <div className="text-muted">Then: {preview.rule.actions?.map((a) => (a.type === 'move' ? `move to folder ${a.folderId}` : a.type)).join(', ')}</div>
            {preview.explanation && <div className="mt-1 italic text-muted">{preview.explanation}</div>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
              Save rule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDraft(preview.rule)}>
              Edit first
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
