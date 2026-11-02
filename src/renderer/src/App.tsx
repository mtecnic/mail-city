import { useTheme } from './lib/theme'
import { useInvalidateOn } from './lib/api'
import { useUi } from './store/ui'
import { SettingsPage } from './features/settings/SettingsPage'
import { MailView } from './features/mail/MailView'

const ACCOUNT_KEYS = [['accounts.list']]

export function App() {
  useTheme()
  const { settingsOpen, setSettingsOpen } = useUi()
  useInvalidateOn('accounts.changed', ACCOUNT_KEYS)

  if (settingsOpen) return <SettingsPage onBack={() => setSettingsOpen(false)} />
  return <MailView onSettings={() => setSettingsOpen(true)} />
}
