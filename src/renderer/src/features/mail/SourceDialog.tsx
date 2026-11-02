import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, Dialog, Spinner } from '@renderer/components/ui'

export function SourceDialog({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const src = useQuery({ queryKey: ['messages.source', messageId], queryFn: () => invoke('messages.source', { id: messageId! }), enabled: !!messageId, staleTime: Infinity })
  if (!messageId) return null
  return (
    <Dialog open onClose={onClose} title="Message source" width="max-w-4xl">
      <div className="flex h-[70vh] flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{src.data ? `${src.data.text.length.toLocaleString()} characters shown` : src.isLoading ? 'Downloading from server…' : 'Source unavailable (account offline?)'}</span>
          <Button size="sm" variant="ghost" onClick={() => invoke('messages.saveSource', { id: messageId })} disabled={!src.data}>
            <Download className="size-3.5" /> Save .eml…
          </Button>
        </div>
        {src.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <pre className="flex-1 select-text overflow-auto rounded border border-border bg-bg p-3 font-mono text-[11px] leading-snug">{src.data?.text ?? ''}</pre>
        )}
      </div>
    </Dialog>
  )
}
