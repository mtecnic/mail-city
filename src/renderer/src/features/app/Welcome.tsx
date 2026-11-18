import { Mail, Plus, Sparkles, Shield, Zap, Upload } from 'lucide-react'
import { Button, Dialog } from '@renderer/components/ui'

export function Welcome({ onAddAccount, onRestore }: { onAddAccount: () => void; onRestore?: () => void }) {
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
        <div className="flex justify-center gap-2">
          <Button variant="primary" onClick={onAddAccount}>
            <Plus className="size-4" /> Add your first account
          </Button>
          {onRestore && (
            <Button variant="secondary" onClick={onRestore} title="Bring accounts, passwords, rules and settings over from a backup made on another computer">
              <Upload className="size-4" /> Restore from a backup
            </Button>
          )}
        </div>
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
  ['Shift+j / k', 'Extend selection'],
  ['Enter', 'Expand / collapse in a conversation'],
  ['e', 'Archive'],
  ['#', 'Delete'],
  ['s', 'Star'],
  ['u / Shift+I', 'Mark unread / read'],
  ['r / a / f', 'Reply / reply all / forward'],
  ['x', 'Select / deselect message'],
  ['v', 'Move to folder'],
  ['z', 'Snooze'],
  ['!', 'Mark as junk'],
  ['Ctrl+Enter', 'Send (in the composer)'],
  ['Ctrl+J', 'Assistant'],
  ['Ctrl+Shift+S', 'Collapse / expand sidebar'],
  ['Right-click', 'Menus on accounts, folders, messages, chips, text and links'],
  ['Drag', 'Messages onto folders, accounts to reorder, files into the composer, pane edges to resize'],
  ['Esc', 'Close / deselect'],
  ['?', 'This help']
]

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width="max-w-xl">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <span className="text-muted">{d}</span>
            <kbd className="shrink-0 rounded border border-border bg-bg px-1.5 py-0.5 text-xs">{k}</kbd>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
