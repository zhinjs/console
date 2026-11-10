import { Image, Link2, Music, Paperclip, Video } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../../components/ui/dropdown-menu'

export function ComposerAttachmentMenu({ disabled = false, onImage, onFile, onMedia }: {
  disabled?: boolean; onImage(): void; onFile(): void; onMedia(type: 'image' | 'video' | 'audio'): void
}) {
  const i18n = useI18n()
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" className="im-tool-button h-8 px-2 text-xs" disabled={disabled} aria-label={i18n.t('添加附件')}><Paperclip className="h-3.5 w-3.5 mr-1" /><span className="im-tool-label">{i18n.t('附件')}</span></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" className="im-attachment-menu">
      <DropdownMenuItem onSelect={onImage}><Image />{i18n.t('图片文件')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={onFile}><Paperclip />{i18n.t('文件')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onMedia('image')}><Link2 />{i18n.t('图片链接')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onMedia('video')}><Video />{i18n.t('视频链接')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onMedia('audio')}><Music />{i18n.t('音频链接')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
