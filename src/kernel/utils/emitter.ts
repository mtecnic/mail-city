import { EventEmitter } from 'node:events'

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
    this.ee.emit(event, ...args)
  }

  removeAllListeners(): void {
    this.ee.removeAllListeners()
  }
}
