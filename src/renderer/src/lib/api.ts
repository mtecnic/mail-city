/**
 * Thin typed wrapper over the preload bridge. All renderer code talks to the
 * kernel through this module so it can be mocked in tests/storybook.
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ChannelName, ChannelInput, ChannelOutput, EventName, EventPayload } from '@shared/ipc'

export function invoke<C extends ChannelName>(channel: C, ...args: ChannelInput<C> extends void ? [] : [ChannelInput<C>]): Promise<ChannelOutput<C>> {
  return window.mail.invoke(channel, ...args)
}

export function onEvent<E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): () => void {
  return window.mail.on(event, handler)
}

/** Subscribe to a main-process event for the lifetime of a component. */
export function useMailEvent<E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): void {
  useEffect(() => onEvent(event, handler), [event, handler])
}

/** Invalidate react-query keys whenever a main-process event fires. */
export function useInvalidateOn(event: EventName, keys: unknown[][]): void {
  const qc = useQueryClient()
  const serialized = JSON.stringify(keys)
  useEffect(
    () =>
      onEvent(event, () => {
        for (const k of JSON.parse(serialized) as unknown[][]) void qc.invalidateQueries({ queryKey: k })
      }),
    [event, qc, serialized]
  )
}
