import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@renderer/components/ui'
import { AccountsSettings } from './AccountsSettings'
import { GeneralSettings } from './GeneralSettings'
import { IdentitiesSettings } from './IdentitiesSettings'

const SECTIONS = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'identities', label: 'Identities & signatures' },
  { id: 'general', label: 'General' }
] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function SettingsPage({ onBack, initial = 'accounts' }: { onBack: () => void; initial?: SectionId }) {
  const [section, setSection] = useState<SectionId>(initial)
  return (
    <div className="flex h-full">
      <aside className="w-52 shrink-0 border-r border-border bg-panel p-3">
        <button className="mb-4 flex items-center gap-2 text-xs text-muted hover:text-fg" onClick={onBack}>
          <ArrowLeft className="size-3.5" /> Back to mail
        </button>
        <nav className="space-y-0.5">
          {SECTIONS.map((s) => (
            <button key={s.id} className={cn('block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-hover', section === s.id && 'bg-hover font-medium')} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          {section === 'accounts' && <AccountsSettings />}
          {section === 'identities' && <IdentitiesSettings />}
          {section === 'general' && <GeneralSettings />}
        </div>
      </div>
    </div>
  )
}
