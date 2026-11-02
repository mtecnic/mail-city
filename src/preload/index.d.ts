import type { MailApi } from './index'

declare global {
  interface Window {
    mail: MailApi
  }
}

export {}
