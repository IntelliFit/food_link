import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { parseInsightInline, parseInsightMarkdown } from '@food-link/core'
import { colors } from '../theme'

export function InsightMarkdownView({ text }: { text: string }) {
  return <View style={styles.block}>{renderInsightMarkdown(text)}</View>
}

function renderInsightInline(text: string) {
  return parseInsightInline(text).map((part, index) => (
    <Text
      key={`${part.text}-${index}`}
      style={[styles.text, part.strong && styles.strong, part.underline && styles.underline]}
    >
      {part.text}
    </Text>
  ))
}

function renderInsightMarkdown(text: string) {
  return parseInsightMarkdown(text).map((block, index) => {
    if (block.type === 'heading') {
      return (
        <Text key={`heading-${index}`} style={styles.heading}>
          {renderInsightInline(block.text || '')}
        </Text>
      )
    }

    if (block.type === 'list') {
      return (
        <View key={`list-${index}`} style={styles.list}>
          {(block.items || []).map((item, itemIndex) => (
            <View key={`${item}-${itemIndex}`} style={styles.listItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.listText}>{renderInsightInline(item)}</Text>
            </View>
          ))}
        </View>
      )
    }

    if (block.type === 'table') {
      return <InsightTable key={`table-${index}`} headers={block.headers || []} rows={block.rows || []} />
    }

    return (
      <Text key={`paragraph-${index}`} style={styles.paragraph}>
        {renderInsightInline(block.text || '')}
      </Text>
    )
  })
}

function InsightTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const colCount = Math.max(1, headers.length, ...rows.map((row) => row.length))
  const cellWidth = 118
  const normalizeRow = (row: string[]) => Array.from({ length: colCount }, (_, index) => row[index] || '')

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={[styles.table, { minWidth: colCount * cellWidth }]}>
        <View style={styles.tableRow}>
          {normalizeRow(headers).map((header, index) => (
            <View key={`th-${index}`} style={[styles.tableCell, styles.tableHeaderCell, { width: cellWidth }]}>
              <Text style={styles.tableHeaderText}>{header}</Text>
            </View>
          ))}
        </View>
        {rows.map((row, rowIndex) => (
          <View key={`tr-${rowIndex}`} style={styles.tableRow}>
            {normalizeRow(row).map((cell, cellIndex) => (
              <View key={`td-${rowIndex}-${cellIndex}`} style={[styles.tableCell, { width: cellWidth }]}>
                <Text style={styles.tableText}>{renderInsightInline(cell)}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  block: {
    gap: 8,
  },
  heading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 6,
    marginBottom: 2,
  },
  paragraph: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
  text: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
  strong: {
    color: colors.text,
    fontWeight: '900',
  },
  underline: {
    color: colors.text,
    textDecorationLine: 'underline',
    fontWeight: '800',
  },
  list: {
    gap: 6,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bullet: {
    color: colors.brandDark,
    fontWeight: '900',
    lineHeight: 22,
  },
  listText: {
    flex: 1,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  tableScroll: {
    marginVertical: 8,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableCell: {
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderRightColor: colors.border,
    borderBottomColor: colors.border,
    justifyContent: 'center',
  },
  tableHeaderCell: {
    backgroundColor: colors.brandSoft,
  },
  tableHeaderText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  tableText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
})
