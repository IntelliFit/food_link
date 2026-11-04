import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { CommunityFeedTargetType, OwnCommentHistoryItem } from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors } from '../theme'

export function MyCommentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { isDark } = useColorScheme()
  const [items, setItems] = useState<OwnCommentHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const cursor = useRef('')
  const busy = useRef(false)
  const sequence = useRef(0)
  const owner = useRef('')
  const load = useCallback(async (reset: boolean) => {
    if (!reset && (busy.current || !cursor.current)) return
    const request = ++sequence.current
    if (reset) { cursor.current = ''; setHasMore(false) }
    busy.current = true; setLoading(true); setError(false)
    try {
      const currentOwner = (await getStoredUserId()) || ''
      if (reset && owner.current !== currentOwner) setItems([])
      owner.current = currentOwner
      if (!currentOwner) { setItems([]); return }
      const page = await apiClient.communityGetOwnComments(reset ? '' : cursor.current)
      if (request !== sequence.current || currentOwner !== await getStoredUserId()) return
      setItems(previous => {
        const next = reset ? [] : [...previous]
        const ids = new Set(next.map(item => item.id))
        for (const item of page.list) if (!ids.has(item.id)) { next.push(item); ids.add(item.id) }
        return next
      })
      cursor.current = page.has_more ? page.next_cursor || '' : ''
      setHasMore(Boolean(cursor.current))
    } catch { if (request === sequence.current) setError(true) }
    finally { if (request === sequence.current) { busy.current = false; setLoading(false) } }
  }, [])
  useFocusEffect(useCallback(() => { void load(true); return () => { sequence.current += 1; busy.current = false } }, [load]))
  const text = { color: isDark ? '#e2eddf' : '#294635' }
  const muted = { color: isDark ? '#a7b5a9' : '#7d897f' }
  const open = (item: OwnCommentHistoryItem) => {
    const known = ['food_record', 'exercise_log', 'campus_food', 'circle_post']
    if (!item.target_available || !known.includes(item.target_type)) return
    navigation.navigate('CommunityFeedDetail', { targetId: item.target_id, targetType: item.target_type as CommunityFeedTargetType })
  }
  return <ScrollView style={{ backgroundColor: isDark ? '#17241c' : '#f5f5ed' }} contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => void load(true)} tintColor={colors.brand} />}>
    <Text style={[s.title, text]}>我的评论</Text><Text style={[s.note, muted]}>你发过的评论和回复</Text>
    {items.map(item => <Pressable key={item.id} accessibilityRole='button' disabled={!item.target_available} style={[s.card, { backgroundColor: isDark ? '#222f29' : '#fffef9' }]} onPress={() => open(item)}>
      <View style={s.row}><Text style={[s.note, muted]}>{item.parent_comment_id ? '回复' : '评论'}</Text><Text style={[s.note, muted]}>{item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : ''}</Text></View>
      <Text style={[s.content, text]}>{item.content}</Text><Text style={[s.target, muted]}>{item.target_available ? item.target_preview || '查看原动态' : '原动态已删除或暂不可见'}</Text>
    </Pressable>)}
    {loading ? <ActivityIndicator color={colors.brand} style={s.state} /> : error ? <Pressable style={s.state} onPress={() => void load(true)}><Text style={muted}>评论获取失败，点击重试</Text></Pressable> : items.length === 0 ? <Text style={[s.state, muted]}>还没有发过评论</Text> : hasMore ? <Pressable style={s.state} onPress={() => void load(false)}><Text style={muted}>查看更多</Text></Pressable> : null}
  </ScrollView>
}
const s = StyleSheet.create({ page: { padding: 16, paddingBottom: 48 }, title: { fontSize: 23, lineHeight: 32, fontWeight: '800' }, note: { fontSize: 12, lineHeight: 19 }, card: { padding: 16, borderRadius: 14, marginTop: 12 }, row: { flexDirection: 'row', justifyContent: 'space-between' }, content: { fontSize: 15, lineHeight: 23, marginVertical: 12 }, target: { fontSize: 12, lineHeight: 19, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#dfe6da' }, state: { marginTop: 28, padding: 12, textAlign: 'center' } })
