import { app } from 'electron'
import { join } from 'node:path'
import { emit } from './ipc/router'
import { showMainWindow } from './tray'

export interface MailtoRequest {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
}

export function parseMailto(url: string): MailtoRequest | null {
  if (!/^mailto:/i.test(url)) return null
  const rest = url.slice(7)
  const [addrPart, query = ''] = rest.split('?')
  const params = new URLSearchParams(query)
  const split = (s: string | null) => (s ? s.split(',').map((x) => decodeURIComponent(x).trim()).filter(Boolean) : [])
  return {
    to: [...split(addrPart ?? ''), ...split(params.get('to'))],
    cc: split(params.get('cc')),
    bcc: split(params.get('bcc')),
    subject: params.get('subject') ?? '',
    body: params.get('body') ?? ''
  }
}

export function registerProtocol(): void {
  if (process.defaultApp) {
    if (process.argv[1]) app.setAsDefaultProtocolClient('mailto', process.execPath, [join(process.cwd(), process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('mailto')
  }
}

/** Handle a launch/second-instance argv: mailto: links and `--compose`. Returns true if something was dispatched. */
export function handleArgv(argv: string[]): boolean {
  const mailto = argv.find((a) => /^mailto:/i.test(a))
  if (mailto) {
    const req = parseMailto(mailto)
    if (req) {
      showMainWindow()
      // Renderer may not be ready on cold start; it also asks for pending requests on boot.
      pending = req
      emit('app.mailto', req)
      return true
    }
  }
  if (argv.includes('--compose')) {
    showMainWindow()
    emit('app.compose', undefined)
    return true
  }
  return false
}

let pending: MailtoRequest | null = null
export function takePendingMailto(): MailtoRequest | null {
  const p = pending
  pending = null
  return p
}

export function installJumpList(): void {
  if (process.platform !== 'win32') return
  app.setUserTasks([
    { program: process.execPath, arguments: '--compose', iconPath: process.execPath, iconIndex: 0, title: 'New message', description: 'Compose a new email' },
    { program: process.execPath, arguments: '', iconPath: process.execPath, iconIndex: 0, title: 'Inbox', description: 'Open Mail City' }
  ])
}

export function applyLoginItem(enabled: boolean): void {
  if (process.platform === 'linux') return
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}
