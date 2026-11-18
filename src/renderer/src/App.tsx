import { useTheme } from './lib/theme'
import { useInvalidateOn } from './lib/api'
import { useUi } from './store/ui'
import { SettingsPage } from './features/settings/SettingsPage'
import { MailView } from './features/mail/MailView'
import { McpConfirmToasts } from './features/settings/McpSettings'
import { ContextMenuHost } from './components/ContextMenu'
import { DialogHost } from './components/dialogs'
import { ToastHost } from './components/toast'

const ACCOUNT_KEYS = [['accounts.list']]

export function App() {
  useTheme()
  const { settingsOpen, setSettingsOpen, settingsSection } = useUi()
  useInvalidateOn('accounts.changed', ACCOUNT_KEYS)

  return (
    <>
      {settingsOpen ? <SettingsPage key={settingsSection ?? 'default'} initial={settingsSection ?? undefined} onBack={() => setSettingsOpen(false)} /> : <MailView onSettings={() => setSettingsOpen(true)} />}
      <McpConfirmToasts />
      <ContextMenuHost />
      <DialogHost />
      <ToastHost />
    </>
  )
}
