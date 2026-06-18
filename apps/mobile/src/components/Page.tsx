import type { PropsWithChildren } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, compactFont } from '../theme'

interface PageProps extends PropsWithChildren {
  title?: string
  subtitle?: string
  refreshing?: boolean
  onRefresh?: () => void
}

export function Page({ title, subtitle, refreshing, onRefresh, children }: PageProps) {
  const insets = useSafeAreaInsets()
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top + 8, 18), paddingBottom: insets.bottom + 112 },
      ]}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.brand} />
        ) : undefined
      }
    >
      {title ? (
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.86}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {children}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 14,
  },
  title: {
    fontSize: compactFont(30, 26),
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
})
