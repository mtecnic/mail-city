import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlarmClock } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui'
import { useUi } from '@renderer/store/ui'

function preset(kind: 'laterToday' | 'tomorrow' | 'thisWeekend' | 'nextWeek'): Date {
  const d = new Date()
  switch (kind) {
    case 'laterToday':
      d.setHours(d.getHours() + 3, 0, 0, 0)
      return d
    case 'tomorrow':
      d.setDate(d.getDate() + 1)
      d.setHours(8, 0, 0, 0)
      return d
    case 'thisWeekend':
      d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
      d.setHours(8, 0, 0, 0)
      return d
    case 'nextWeek':
      d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7 || 7))
      d.setHours(8, 0, 0, 0)
      return d
  }
}

export function SnoozeMenu({ ids, onDone }: { ids: string[]; onDone?: () => void }) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const selectMessage = useUi((s) => s.selectMessage)
  const snooze = useMutation({
    mutationFn: (until: Date) => invoke('messages.snooze', { ids, until: until.toISOString() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['messages'] })
      setOpen(false)
      selectMessage(null)
      onDone?.()
    }
  })
  const fmt = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const items: [string, () => Date][] = [
    ['Later today', () => preset('laterToday')],
    ['Tomorrow', () => preset('tomorrow')],
    ['This weekend', () => preset('thisWeekend')],
    ['Next week', () => preset('nextWeek')]
  ]
  return (
    <div className="relative">
      <Button size="sm" variant="ghost" title="Snooze (z)" onClick={() => setOpen((o) => !o)}>
        <AlarmClock className="size-4" />
      </Button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-panel py-1 text-sm shadow-lg" onMouseLeave={() => setOpen(false)}>
          {items.map(([label, fn]) => {
            const d = fn()
            return (
              <button key={label} className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-hover" onClick={() => snooze.mutate(d)}>
                <span>{label}</span>
                <span className="text-xs text-muted">{fmt(d)}</span>
              </button>
            )
          })}
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-hover"
            onClick={() => {
              const v = window.prompt('Snooze until (YYYY-MM-DD HH:MM)')
              if (!v) return
              const d = new Date(v)
              if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) snooze.mutate(d)
            }}
          >
            Pick date & time…
          </button>
        </div>
      )}
    </div>
  )
}
