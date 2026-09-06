import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { parseInsightInline, parseInsightMarkdown } from '@food-link/core'
import { colors } from '../theme'
import { useColorScheme } from '../providers/ColorSchemeProvider'

type InsightPalette = {
  text: string
  textSecondary: string
  brandText: string
  border: string
  surface: string
  headerSurface: string
}

const lightPalette: InsightPalette = {
  text: colors.text,
  textSecondary: colors.textSecondary,
  brandText: colors.brandDark,
  border: colors.border,
  surface: colors.surface,
  headerSurface: colors.brandSoft,
}

const darkPalette: InsightPalette = {
  text: '#f2f7f4',
  textSecondary: '#aab8b2',
  brandText: '#9fe3c5',
  border: 'rgba(255,255,255,0.10)',
  surface: '#181f1d',
  headerSurface: 'rgba(92,184,150,0.14)',
}

const lightStyles = createStyles(lightPalette)
const darkStyles = createStyles(darkPalette)
type InsightStyles = typeof lightStyles

export function InsightMarkdownView({ text }: { text: string }) {
  const { isDark } = useColorScheme()
  const styles = isDark ? darkStyles : lightStyles
  return <View style={styles.block}>{renderInsightMarkdown(text, styles)}</View>
}

function renderInsightInline(text: string, styles: InsightStyles) {
  return parseInsightInline(text).map((part, index) => (
    <Text
      key={`${part.text}-${index}`}
      style={[styles.text, part.strong && styles.strong, part.underline && styles.underline]}
    >
      {part.text}
    </Text>
  ))
}

function renderInsightMarkdown(text: string, styles: InsightStyles) {
  return parseInsightMarkdown(text).map((block, index) => {
    if (block.type === 'heading') {
      return (
        <Text key={`heading-${index}`} style={styles.heading}>
          {renderInsightInline(block.text || '', styles)}
        </Text>
      )
    }

    if (block.type === 'list') {
      return (
        <View key={`list-${index}`} style={styles.list}>
          {(block.items || []).map((item, itemIndex) => (
            <View key={`${item}-${itemIndex}`} style={styles.listItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.listText}>{renderInsightInline(item, styles)}</Text>
            </View>
          ))}
        </View>
      )
    }

    if (block.type === 'table') {
      return <InsightTable key={`table-${index}`} headers={block.headers || []} rows={block.rows || []} styles={styles} />
    }

    return (
      <Text key={`paragraph-${index}`} style={styles.paragraph}>
        {renderInsightInline(block.text || '', styles)}
      </Text>
    )
  })
}

function InsightTable({ headers, rows, styles }: { headers: string[]; rows: string[][]; styles: InsightStyles }) {
  const colCount = Math.max(1, headers.length, ...rows.map((row) => row.length))
  const cellWidth = 118
  const normalizeRow = (row: string[]) => Array.from({ length: colCount }, (_, index) => row[index] || '')

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll} accessibilityLabel="AI 洞察数据表，可横向滚动">
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
                <Text style={styles.tableText}>{renderInsightInline(cell, styles)}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

function createStyles(palette: InsightPalette) {
  return StyleSheet.create({
    block: {
      gap: 8,
    },
    heading: {
      color: palette.text,
      fontSize: 16,
      fontWeight: '900',
      marginTop: 6,
      marginBottom: 2,
    },
    paragraph: {
      color: palette.textSecondary,
      lineHeight: 22,
    },
    text: {
      color: palette.textSecondary,
      lineHeight: 22,
    },
    strong: {
      color: palette.text,
      fontWeight: '900',
    },
    underline: {
      color: palette.text,
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
      color: palette.brandText,
      fontWeight: '900',
      lineHeight: 22,
    },
    listText: {
      flex: 1,
      color: palette.textSecondary,
      lineHeight: 22,
    },
    tableScroll: {
      marginVertical: 8,
    },
    table: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: palette.surface,
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
      borderRightColor: palette.border,
      borderBottomColor: palette.border,
      justifyContent: 'center',
    },
    tableHeaderCell: {
      backgroundColor: palette.headerSurface,
    },
    tableHeaderText: {
      color: palette.text,
      fontSize: 13,
      fontWeight: '900',
      lineHeight: 18,
    },
    tableText: {
      color: palette.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
  })
}
