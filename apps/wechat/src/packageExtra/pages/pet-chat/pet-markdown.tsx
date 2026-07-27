import { View, Text } from '@tarojs/components'

type PetMarkdownInlinePart = {
  text: string
  strong?: boolean
  underline?: boolean
}

type PetMarkdownBlock = {
  type: 'heading' | 'paragraph' | 'list' | 'table'
  text?: string
  items?: string[]
  headers?: string[]
  rows?: string[][]
}

type PetMarkdownProps = {
  text: string
}

function normalizePetMarkdown(raw: string): string {
  if (!raw) return ''
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```+/g, '')
    .replace(/__/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const chars = Array.from(normalized)
  return chars
    .filter((char, index) => {
      if (char !== '*') return true
      const previous = chars[index - 1] || ''
      const next = chars[index + 1] || ''
      return /\d/.test(previous) && /\d/.test(next)
    })
    .join('')
}

function stripBlockPrefix(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim()
}

function parseTableLine(line: string): string[] {
  const cells = line.split('|').map((cell) => cell.trim())
  if (cells[0] === '') cells.shift()
  if (cells[cells.length - 1] === '') cells.pop()
  return cells
}

function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const cells = parseTableLine(trimmed)
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))
}

function parseInline(text: string): PetMarkdownInlinePart[] {
  const parts: PetMarkdownInlinePart[] = []
  // 宠物对话的模型偶尔会用单星号表示强调。小程序没有浏览器的
  // Markdown 渲染器，若不在这里处理就会把 `*重点*` 原样显示出来。
  // 三星号先匹配，避免被双星号规则吃掉后留下一个孤立的星号。
  const pattern = /`([^`]+)`|<u>(.*?)<\/u>|__(.*?)__|\*\*\*(.*?)\*\*\*|\*\*(.*?)\*\*|\*([^*\n]+?)\*/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index) })
    }
    if (match[1] != null) {
      parts.push({ text: match[1] })
    } else if (match[2] != null) {
      parts.push({ text: match[2], underline: true })
    } else if (match[3] != null) {
      parts.push({ text: match[3], underline: true })
    } else if (match[4] != null) {
      parts.push({ text: match[4], strong: true, underline: true })
    } else if (match[5] != null) {
      parts.push({ text: match[5], strong: true })
    } else if (match[6] != null) {
      parts.push({ text: match[6], strong: true })
    }
    cursor = pattern.lastIndex
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor) })
  }

  return parts
    .map((part) => ({ ...part, text: part.text.replace(/`([^`]+)`/g, '$1') }))
    .filter((part) => part.text)
}

function parsePetMarkdown(text: string): PetMarkdownBlock[] {
  const blocks: PetMarkdownBlock[] = []
  const lines = normalizePetMarkdown(text).split('\n')
  let paragraph: string[] = []
  let listItems: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() })
    paragraph = []
  }

  const flushList = () => {
    if (!listItems.length) return
    blocks.push({ type: 'list', items: listItems })
    listItems = []
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    if (line.includes('|')) {
      const nextLine = lines[i + 1]
      if (nextLine !== undefined && isTableDelimiter(nextLine)) {
        flushParagraph()
        flushList()
        const headers = parseTableLine(rawLine)
        i += 2
        const rows: string[][] = []
        while (i < lines.length && lines[i].trim().includes('|')) {
          rows.push(parseTableLine(lines[i]))
          i++
        }
        blocks.push({ type: 'table', headers, rows })
        i--
        continue
      }
    }

    if (/^\s{0,3}#{1,6}\s+/.test(rawLine)) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', text: stripBlockPrefix(rawLine) })
      continue
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(rawLine)) {
      flushParagraph()
      listItems.push(stripBlockPrefix(rawLine))
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return blocks
}

function renderInline(text: string) {
  return parseInline(text).map((part, index) => (
    <Text
      key={`${part.text}-${index}`}
      className={`${part.strong ? 'pet-chat-md-strong' : ''}${part.underline ? ' pet-chat-md-underline' : ''}`}
    >
      {part.text}
    </Text>
  ))
}

export function PetMarkdown({ text }: PetMarkdownProps) {
  const blocks = parsePetMarkdown(text)
  if (!blocks.length) return null

  return (
    <View className='pet-chat-md'>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Text key={`heading-${index}`} className='pet-chat-md-heading'>
              {renderInline(block.text || '')}
            </Text>
          )
        }

        if (block.type === 'list') {
          return (
            <View key={`list-${index}`} className='pet-chat-md-list'>
              {(block.items || []).map((item, itemIndex) => (
                <View key={`${item}-${itemIndex}`} className='pet-chat-md-list-item'>
                  <Text className='pet-chat-md-list-bullet'>•</Text>
                  <Text className='pet-chat-md-list-text'>{renderInline(item)}</Text>
                </View>
              ))}
            </View>
          )
        }

        if (block.type === 'table') {
          const headers = block.headers || []
          const rows = block.rows || []
          const colCount = Math.max(1, headers.length)
          return (
            <View key={`table-${index}`} className='pet-chat-md-table-wrapper'>
              <View className='pet-chat-md-table' style={{ gridTemplateColumns: `repeat(${colCount}, minmax(128rpx, 1fr))` }}>
                {headers.map((header, headerIndex) => (
                  <View key={`th-${headerIndex}`} className='pet-chat-md-table-cell pet-chat-md-table-header'>
                    {renderInline(header)}
                  </View>
                ))}
                {rows.map((row, rowIndex) =>
                  row.map((cell, cellIndex) => (
                    <View key={`td-${rowIndex}-${cellIndex}`} className='pet-chat-md-table-cell'>
                      {renderInline(cell)}
                    </View>
                  ))
                )}
              </View>
            </View>
          )
        }

        return (
          <Text key={`paragraph-${index}`} className='pet-chat-md-paragraph'>
            {renderInline(block.text || '')}
          </Text>
        )
      })}
    </View>
  )
}
