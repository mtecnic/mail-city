import { Mail, Plus, Sparkles, Shield, Zap } from 'lucide-react'
import { Button } from '@renderer/components/ui'

export function Welcome({ onAddAccount }: { onAddAccount: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-lg space-y-6 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-accent/15">
          <Mail className="size-8 text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Welcome to Mail City</h1>
          <p className="mt-1 text-sm text-muted">All of your inboxes — Gmail, Outlook, iCloud, Yahoo and any IMAP account — in one place, stored locally on this PC.</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-left text-xs">
          <div className="rounded-md border border-border p-3">
            <Zap className="mb-1 size-4 text-accent" />
            <div className="font-medium">Unified</div>
            <div className="text-muted">One inbox, every account, instant search.</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <Shield className="mb-1 size-4 text-accent" />
            <div className="font-medium">Private</div>
            <div className="text-muted">Mail cached locally, credentials in the Windows keystore.</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <Sparkles className="mb-1 size-4 text-accent" />
            <div className="font-medium">AI-native</div>
            <div className="text-muted">Bring Claude or a local model; connect any MCP agent.</div>
          </div>
        </div>
        <Button variant="primary" onClick={onAddAccount} className="mx-auto">
          <Plus className="size-4" /> Add your first account
        </Button>
        <p className="text-xs text-muted">
          Tip: press <kbd className="rounded border border-border px-1">?</kbd> any time for keyboard shortcuts.
        </p>
      </div>
    </div>
  )
}

export const SHORTCUTS: [string, string][] = [
  ['c', 'Compose'],
  ['/', 'Search'],
  ['j / k', 'Next / previous message'],
  ['Enter', 'Open'],
  ['e', 'Archive'],
  ['#', 'Delete'],
  ['s', 'Star'],
  ['u', 'Mark unread'],
  ['r / a / f', 'Reply / reply all / forward'],
  ['x', 'Select / deselect message'],
  ['v', 'Move to folder'],
  ['z', 'Snooze'],
  ['!', 'Mark as junk'],
  ['Right-click', 'Context menu (accounts, folders, messages)'],
  ['Ctrl+J', 'Assistant'],
  ['Esc', 'Deselect'],
  ['?', 'This help']
]

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-80 rounded-lg border border-border bg-panel p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-semibold">Keyboard shortcuts</h2>
        <div className="space-y-1.5">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-muted">{d}</span>
              <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 text-xs">{k}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
