export type InsightInlinePart = {
  text: string
  underline?: boolean
  strong?: boolean
}

export type InsightMarkdownBlock = {
  type: 'heading' | 'paragraph' | 'list' | 'table'
  text?: string
  items?: string[]
  headers?: string[]
  rows?: string[][]
}

export function normalizeInsightText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    // 仅把行首围栏后的首个单词当作语言标识；行内 ```1508``` 中的 1508 是正文。
    .replace(/(^|\n)[ \t]*```[a-zA-Z0-9_-]*[ \t]*(?:\n|$)/g, '$1')
    .replace(/```+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseInsightInline(text: string): InsightInlinePart[] {
  const parts: InsightInlinePart[] = []
  // 模型可能在强调内容中主动换行，也可能把 HTML 标签转义成实体。
  // 使用 [\s\S] 匹配跨行内容，并只解析白名单内的 u 标签，避免标记原样泄漏到 UI。
  const normalized = text.replace(/&lt;(\/?u(?:\s[^&]*?)?)&gt;/gi, '<$1>')
  const pattern = /<u(?:\s[^>]*)?>([\s\S]*?)<\/u\s*>|__([\s\S]*?)__|\*\*([\s\S]*?)\*\*/gi
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(normalized)) !== null) {
    if (match.index > cursor) parts.push({ text: stripKnownInlineTags(normalized.slice(cursor, match.index)) })
    if (match[1] != null) {
      parts.push({ text: match[1], underline: true })
    } else if (match[2] != null) {
      parts.push({ text: match[2], underline: true })
    } else if (match[3] != null) {
      parts.push({ text: match[3], strong: true })
    }
    cursor = pattern.lastIndex
  }
  if (cursor < normalized.length) parts.push({ text: stripKnownInlineTags(normalized.slice(cursor)) })
  return parts.filter((part) => part.text)
}

function stripKnownInlineTags(value: string): string {
  return value.replace(/<\/?u(?:\s[^>]*)?>/gi, '')
}

export function parseInsightMarkdown(text: string): InsightMarkdownBlock[] {
  const blocks: InsightMarkdownBlock[] = []
  const lines = normalizeInsightText(text).split('\n')
  let paragraph: string[] = []
  let listItems: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() })
      paragraph = []
    }
  }
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ type: 'list', items: listItems })
      listItems = []
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    if (line.includes('|')) {
      const nextLine = lines[i + 1]
      if (nextLine !== undefined && isMarkdownTableDelimiter(nextLine)) {
        flushParagraph()
        flushList()
        const headers = parseMarkdownTableLine(rawLine)
        i += 2
        const rows: string[][] = []
        while (i < lines.length && lines[i].trim().includes('|')) {
          rows.push(parseMarkdownTableLine(lines[i]))
          i += 1
        }
        blocks.push({ type: 'table', headers, rows })
        i -= 1
        continue
      }
    }

    if (/^\s{0,3}#{1,6}\s+/.test(rawLine)) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', text: stripInsightMarkdownPrefix(rawLine) })
      continue
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(rawLine)) {
      flushParagraph()
      listItems.push(stripInsightMarkdownPrefix(rawLine))
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return blocks
}

function stripInsightMarkdownPrefix(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trim()
}

function parseMarkdownTableLine(line: string): string[] {
  const cells = line.split('|').map((cell) => cell.trim())
  if (cells[0] === '') cells.shift()
  if (cells[cells.length - 1] === '') cells.pop()
  return cells
}

function isMarkdownTableDelimiter(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const cells = parseMarkdownTableLine(trimmed)
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))
}
