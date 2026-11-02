import { TypedEmitter } from '../../utils/emitter'
import { newId } from '../../utils/ids'
import type { ToolSpec } from '../tools/registry'

export interface McpConfirmRequest {
  id: string
  client: string
  tool: string
  risk: string
  summary: string
  input: unknown
}

/**
 * Routes "may this MCP client run this tool?" questions to the UI. In headless
 * (stdio) mode there is no UI, so anything not on the allowlist is denied.
 */
export class PermissionBroker extends TypedEmitter<{ confirm: [McpConfirmRequest] }> {
  private pending = new Map<string, (ok: boolean | 'always') => void>()

  constructor(private readonly interactive: boolean) {
    super()
  }

  ask(client: string, tool: ToolSpec, input: unknown, summary: string): Promise<boolean | 'always'> {
    if (!this.interactive) return Promise.resolve(false)
    const id = newId('mcpcf')
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.emit('confirm', { id, client, tool: tool.name, risk: tool.risk, summary, input })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          resolve(false)
        }
      }, 5 * 60_000)
    })
  }

  resolve(id: string, answer: boolean | 'always'): void {
    this.pending.get(id)?.(answer)
    this.pending.delete(id)
  }
}
