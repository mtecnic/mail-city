import { useEditor, EditorContent, type Editor as TipTapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link as LinkIcon, Quote, RemoveFormatting } from 'lucide-react'
import { cn } from '@renderer/components/ui'
import { sanitizeEmailHtml } from '@renderer/lib/sanitize'

export function useComposeEditor(initialHtml: string, onReady?: (e: TipTapEditor) => void) {
  return useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
      Placeholder.configure({ placeholder: 'Write your message…' })
    ],
    content: initialHtml ? sanitizeEmailHtml(initialHtml, { cid: {}, allowRemoteImages: true }).html : '',
    editorProps: { attributes: { class: 'prose-mail min-h-40 flex-1 px-3 py-2 text-sm outline-none' } },
    onCreate: ({ editor }) => onReady?.(editor)
  })
}

export function EditorToolbar({ editor }: { editor: TipTapEditor | null }) {
  if (!editor) return null
  const btn = (active: boolean, onClick: () => void, Icon: typeof Bold, title: string) => (
    <button type="button" title={title} className={cn('rounded p-1 hover:bg-hover', active && 'bg-hover text-accent')} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <Icon className="size-4" />
    </button>
  )
  return (
    <div className="flex items-center gap-0.5 border-t border-border px-2 py-1">
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), Bold, 'Bold (Ctrl+B)')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), Italic, 'Italic (Ctrl+I)')}
      {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), UnderlineIcon, 'Underline (Ctrl+U)')}
      <span className="mx-1 h-4 w-px bg-border" />
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), List, 'Bullet list')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered, 'Numbered list')}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), Quote, 'Quote')}
      {btn(editor.isActive('link'), () => {
        const prev = editor.getAttributes('link')['href'] as string | undefined
        const url = window.prompt('Link URL', prev ?? 'https://')
        if (url === null) return
        if (!url) editor.chain().focus().unsetLink().run()
        else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      }, LinkIcon, 'Link')}
      {btn(false, () => editor.chain().focus().unsetAllMarks().clearNodes().run(), RemoveFormatting, 'Clear formatting')}
    </div>
  )
}

export { EditorContent }
