import type { PropsWithChildren } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, compactFont } from '../theme'

interface PageProps extends PropsWithChildren {
  title?: string
  subtitle?: string
  refreshing?: boolean
  onRefresh?: () => void
  style?: StyleProp<ViewStyle>
  contentContainerStyle?: StyleProp<ViewStyle>
}

export function Page({ title, subtitle, refreshing, onRefresh, children, style, contentContainerStyle }: PageProps) {
  const insets = useSafeAreaInsets()
  return (
    <ScrollView
      style={[styles.scroll, style]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Math.max(insets.top + 6, 16), paddingBottom: insets.bottom + 104 },
        contentContainerStyle,
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
    marginBottom: 10,
  },
  title: {
    fontSize: compactFont(24, 22),
    lineHeight: 30,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
})
