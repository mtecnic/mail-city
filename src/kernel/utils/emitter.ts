import { EventEmitter } from 'node:events'
import { createLogger } from './logger'

const log = createLogger('emitter')

/** Small typed wrapper over Node's EventEmitter. */
export class TypedEmitter<Events extends Record<string, unknown[]>> {
  private readonly ee = new EventEmitter({ captureRejections: false })

  constructor() {
    this.ee.setMaxListeners(100)
  }

  on<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): () => void {
    this.ee.on(event, listener as (...args: unknown[]) => void)
    return () => this.off(event, listener)
  }

  once<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): void {
    this.ee.once(event, listener as (...args: unknown[]) => void)
  }

  off<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): void {
    this.ee.off(event, listener as (...args: unknown[]) => void)
  }

  emit<K extends keyof Events & string>(event: K, ...args: Events[K]): void {
    // Node throws when an 'error' event has no listener. In an app that must survive flaky
    // networks that turns a recoverable socket error into a crash dialog, so log it instead.
    if (event === 'error' && this.ee.listenerCount('error') === 0) {
      log.warn('unhandled error event ignored', { message: args[0] instanceof Error ? args[0].message : String(args[0]) })
      return
    }
    this.ee.emit(event, ...args)
  }

  removeAllListeners(): void {
    this.ee.removeAllListeners()
  }
}
