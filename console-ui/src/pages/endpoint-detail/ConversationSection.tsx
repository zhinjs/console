import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ConversationSection as ConversationSectionType } from './types'
import { ConversationRow } from './ConversationRow'

interface ConversationSectionProps {
  section: ConversationSectionType
  collapsed: boolean
  onToggle: () => void
  selectionKey: string | null
  onSelectEntry: (entry: ConversationSectionType['entries'][number]) => void
}

export function ConversationSection({
  section,
  collapsed,
  onToggle,
  selectionKey,
  onSelectEntry,
}: ConversationSectionProps) {
  const count = section.entries.length

  return (
    <section className="im-conversation-section" aria-label={section.title}>
      <button
        type="button"
        className="im-section-header"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="im-section-chevron" aria-hidden>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
        <span className="im-section-title">{section.title}</span>
        <span className="im-section-count-badge">{count}</span>
      </button>
      {!collapsed && (
        <div className="im-section-panel">
          {count === 0 ? (
            <p className="im-section-empty">{section.emptyHint ?? '暂无会话'}</p>
          ) : (
            section.entries.map((entry) => {
              const key = `${entry.channelType}-${entry.id}`
              return (
                <ConversationRow
                  key={key}
                  entry={entry}
                  active={selectionKey === key}
                  onSelect={() => onSelectEntry(entry)}
                />
              )
            })
          )}
        </div>
      )}
    </section>
  )
}
