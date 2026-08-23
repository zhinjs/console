import { useRef, useState, type ReactElement } from 'react'
import {
  Braces,
  Download,
  ExternalLink,
  FileText,
  Forward,
  ImageOff,
  Link as LinkIcon,
  Music,
  Pause,
  Play,
  Quote,
  Video,
} from 'lucide-react'
import { MarkdownContent, cn, pickMediaRawUrl, resolveMediaSrc } from '@zhin.js/client'
import type { ReceivedMessage } from './types'

type MessageSegment = ReceivedMessage['content'][number]

function segmentData(seg: MessageSegment): Record<string, unknown> {
  return (seg.data ?? {}) as Record<string, unknown>
}

function stringifyValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const s = Math.floor(seconds)
  const mins = Math.floor(s / 60)
  const rest = s % 60
  return `${mins}:${String(rest).padStart(2, '0')}`
}

function renderInlineText(text: string, keyPrefix: string) {
  const parts: Array<string | ReactElement> = []
  const regex = /(`[^`]+`)|(https?:\/\/[^\s<>()]+)|(\*\*([^*]+)\*\*)/g
  let last = 0
  let index = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const raw = match[0]
    if (match[1]) {
      parts.push(
        <code key={`${keyPrefix}-code-${index++}`} className="im-inline-code">
          {raw.slice(1, -1)}
        </code>,
      )
    } else if (match[2]) {
      parts.push(
        <a
          key={`${keyPrefix}-link-${index++}`}
          href={raw}
          target="_blank"
          rel="noreferrer"
          className="im-message-link"
        >
          {raw}
        </a>,
      )
    } else if (match[3]) {
      parts.push(
        <strong key={`${keyPrefix}-strong-${index++}`} className="font-semibold">
          {match[4]}
        </strong>,
      )
    }
    last = regex.lastIndex
  }

  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function TextContent({ text }: { text: string }) {
  return (
    <span className="im-text-body">
      {text.split('\n').map((line, idx, arr) => (
        <span key={idx}>
          {renderInlineText(line, `text-${idx}`)}
          {idx < arr.length - 1 ? <br /> : null}
        </span>
      ))}
    </span>
  )
}

function MediaFallback({ label }: { label: string }) {
  return (
    <span className="im-media-missing">
      <ImageOff className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}

function ImageSegment({ seg }: { seg: MessageSegment }) {
  const d = segmentData(seg)
  const raw = pickMediaRawUrl(d)
  const src = resolveMediaSrc(raw, 'image')
  const label = stringifyValue(d.name ?? d.filename ?? d.file ?? raw) || '图片'
  if (!src) return <MediaFallback label="[图片]" />

  return (
    <figure className="im-media-card im-image-card">
      <a href={src} target="_blank" rel="noreferrer" className="im-image-link">
        <img
          src={src}
          alt={label}
          className="im-image-preview"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      </a>
      <figcaption className="im-media-caption">
        <span className="truncate">{label}</span>
        <a href={src} target="_blank" rel="noreferrer" title="打开原图">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </figcaption>
    </figure>
  )
}

function VideoSegment({ seg }: { seg: MessageSegment }) {
  const d = segmentData(seg)
  const raw = pickMediaRawUrl(d)
  const src = resolveMediaSrc(raw, 'video')
  const label = stringifyValue(d.name ?? d.filename ?? raw) || '视频'
  if (!src) return <MediaFallback label="[视频]" />

  return (
    <figure className="im-media-card im-video-card">
      <div className="im-media-label">
        <Video className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <video src={src} controls playsInline preload="metadata" className="im-video-player" />
      <figcaption className="im-media-caption">
        <span>视频消息</span>
        <a href={src} target="_blank" rel="noreferrer" title="打开视频">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </figcaption>
    </figure>
  )
}

function AudioSegment({ seg }: { seg: MessageSegment }) {
  const d = segmentData(seg)
  const raw = pickMediaRawUrl(d)
  const src = resolveMediaSrc(raw, 'audio')
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(Number(d.duration ?? 0))

  if (!src) return <MediaFallback label="[语音]" />

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play()
    } else {
      audio.pause()
    }
  }

  return (
    <div className="im-audio-card">
      <button type="button" className="im-audio-play" onClick={toggle} aria-label={playing ? '暂停语音' : '播放语音'}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <div className="im-audio-main">
        <div className="im-audio-title">
          <Music className="h-3.5 w-3.5" />
          <span>语音消息</span>
          <span className="im-audio-time">{formatDuration(current)} / {formatDuration(duration)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || current)}
          className="im-audio-range"
          onChange={(e) => {
            const next = Number(e.target.value)
            setCurrent(next)
            if (audioRef.current) audioRef.current.currentTime = next
          }}
        />
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent((e.currentTarget as HTMLAudioElement).currentTime)}
        onLoadedMetadata={(e) => setDuration((e.currentTarget as HTMLAudioElement).duration)}
      />
    </div>
  )
}

function FileSegment({ seg }: { seg: MessageSegment }) {
  const d = segmentData(seg)
  const name = stringifyValue(d.name ?? d.filename ?? d.file ?? '文件')
  const size = stringifyValue(d.size ?? d.fileSize)
  const rawUrl = stringifyValue(d.url ?? d.src ?? d.path)

  return (
    <div className="im-file-card">
      <span className="im-file-icon">
        <FileText className="h-4 w-4" />
      </span>
      <span className="im-file-info">
        <span className="im-file-name">{name}</span>
        {size ? <span className="im-file-meta">{size}</span> : null}
      </span>
      {rawUrl ? (
        <a href={rawUrl} target="_blank" rel="noreferrer" className="im-file-action" title="打开文件">
          <Download className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  )
}

function ReferenceSegment({ seg, kind }: { seg: MessageSegment; kind: 'quote' | 'forward' }) {
  const d = segmentData(seg)
  const title =
    stringifyValue(d.senderName ?? d.sender_name ?? d.sender ?? d.from ?? d.source) ||
    (kind === 'quote' ? '引用消息' : '转发消息')
  const summary =
    stringifyValue(d.summary ?? d.text ?? d.preview ?? d.content ?? d.message) ||
    (kind === 'quote' ? '原消息摘要不可用' : '转发内容摘要不可用')
  const Icon = kind === 'quote' ? Quote : Forward

  return (
    <div className={cn('im-reference-card', kind === 'forward' && 'im-reference-card--forward')}>
      <Icon className="h-3.5 w-3.5" />
      <span className="im-reference-main">
        <span className="im-reference-title">{title}</span>
        <span className="im-reference-summary">{summary}</span>
      </span>
    </div>
  )
}

function UnknownSegment({ seg }: { seg: MessageSegment }) {
  return (
    <details className="im-unknown-segment">
      <summary>
        <Braces className="h-3.5 w-3.5" />
        未识别消息类型：{seg.type}
      </summary>
      <pre>{JSON.stringify(seg.data ?? {}, null, 2)}</pre>
    </details>
  )
}

function MessageSegmentView({ seg, index }: { seg: MessageSegment; index: number }) {
  const d = segmentData(seg)

  if (seg.type === 'text' && d.text != null) {
    return <TextContent text={String(d.text)} />
  }

  if ((seg.type === 'markdown' || seg.type === 'md') && (d.text != null || d.content != null)) {
    return <MarkdownContent text={String(d.text ?? d.content ?? '')} />
  }

  if (seg.type === 'at') {
    return (
      <span className="im-at font-medium">
        @{String(d.name ?? d.qq ?? d.id ?? '')}
      </span>
    )
  }

  if (seg.type === 'face' || seg.type === 'emoji') {
    const id = String(d.id ?? d.faceId ?? '')
    const label = String(d.name ?? d.text ?? id)
    if (!id) return <span className="im-face-fallback">[{label || '表情'}]</span>
    return (
      <img
        src={`https://face.viki.moe/apng/${id}.png`}
        alt={label ? `表情 ${label}` : '表情'}
        className="im-face-image"
        onError={(e) => {
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />
    )
  }

  if (seg.type === 'image') return <ImageSegment seg={seg} />
  if (seg.type === 'video') return <VideoSegment seg={seg} />
  if (seg.type === 'audio' || seg.type === 'record') return <AudioSegment seg={seg} />
  if (seg.type === 'file') return <FileSegment seg={seg} />
  if (seg.type === 'quote' || seg.type === 'reply') return <ReferenceSegment seg={seg} kind="quote" />
  if (seg.type === 'forward' || seg.type === 'node') return <ReferenceSegment seg={seg} kind="forward" />
  if (seg.type === 'link') {
    const url = stringifyValue(d.url ?? d.href)
    const title = stringifyValue(d.title ?? d.text ?? url)
    return (
      <a href={url} target="_blank" rel="noreferrer" className="im-link-card">
        <LinkIcon className="h-4 w-4" />
        <span>{title}</span>
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    )
  }

  return <UnknownSegment seg={{ ...seg, data: { ...d, _index: index } }} />
}

export function messageContentSummary(content: ReceivedMessage['content'], maxLength = 80): string {
  const parts = content.map((seg) => {
    const d = segmentData(seg)
    if (seg.type === 'text') return stringifyValue(d.text)
    if (seg.type === 'markdown' || seg.type === 'md') return stringifyValue(d.text ?? d.content)
    if (seg.type === 'at') return `@${stringifyValue(d.name ?? d.qq ?? d.id)}`
    if (seg.type === 'face' || seg.type === 'emoji') return '[表情]'
    if (seg.type === 'image') return '[图片]'
    if (seg.type === 'video') return '[视频]'
    if (seg.type === 'audio' || seg.type === 'record') return '[语音]'
    if (seg.type === 'file') return `[文件] ${stringifyValue(d.name ?? d.filename)}`
    if (seg.type === 'quote' || seg.type === 'reply') return `[引用] ${stringifyValue(d.summary ?? d.text)}`
    if (seg.type === 'forward' || seg.type === 'node') return '[转发消息]'
    return `[${seg.type}]`
  })
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

export function MessageBody({ content }: { content: ReceivedMessage['content'] }) {
  return (
    <div className="im-segment-list">
      {content.map((seg, i) => (
        <MessageSegmentView key={`${seg.type}-${i}`} seg={seg} index={i} />
      ))}
    </div>
  )
}
