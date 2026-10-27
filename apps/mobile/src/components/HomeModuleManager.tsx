import { useCallback, useMemo, useRef, useState } from 'react'
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import { HOME_MODULES, HOME_QUICK_STATS, defaultHomeModuleLayout, isHomeModuleVisible, moveHomeModule, toggleHomeQuickStat, type HomeModuleId, type HomeModuleLayout, type HomeModuleLocks } from '@food-link/core'
import { IconfontText } from './Iconfont'
import { useColorScheme } from '../providers/ColorSchemeProvider'

const densities = [{ id: 'smart', label: '智能' }, { id: 'comfortable', label: '舒展' }, { id: 'compact', label: '紧凑' }] as const
const icons: Record<HomeModuleId, string> = { diet: 'icon-canciguanli', nextMeal: 'icon-a-144-lvye', body: 'icon-weight-scale', supplements: 'icon-danbaizhi', expiry: 'icon-kefulan', rewards: 'icon-picture', meals: 'icon-canciguanli', recap: 'icon-weibiaoti1' }
const quickIcons = { weight: 'icon-weight-scale', water: 'icon-drink', exercise: 'icon-dumbbell', sleep: 'icon-a-144-lvye' }

function DragHandle({ label, onMove }: { label: string; onMove: (steps: number) => void }) {
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8,
    onPanResponderRelease: (_, gesture) => { if (Math.abs(gesture.dy) >= 30) onMove(Math.trunc(gesture.dy / 54) || Math.sign(gesture.dy)) },
  }), [onMove])
  return <View accessibilityLabel={`拖动${label}排序`} style={s.handle} {...responder.panHandlers}><IconfontText className='iconfont icon-all' size={14} color='#b6c4bb' /></View>
}

export function HomeModuleManager({ layout, locks, onSave, onClose }: { layout: HomeModuleLayout; locks: HomeModuleLocks; onSave: (value: HomeModuleLayout) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(layout)
  const [saving, setSaving] = useState(false)
  const savePending = useRef(false)
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const move = useCallback((id: HomeModuleId, steps: number) => setDraft(previous => moveHomeModule(previous, id, steps)), [])
  const selectedDensity = densities.find(item => item.id === draft.density)!
  const ink = { color: isDark ? '#e8ece9' : '#173f34' }
  const card = { backgroundColor: isDark ? '#223a2d' : '#fff' }
  return <Modal visible transparent animationType='slide' onRequestClose={() => !saving && onClose()}>
    <View style={s.overlay}>
      <Pressable accessibilityLabel='关闭整理首页' style={StyleSheet.absoluteFill} onPress={() => !saving && onClose()} />
      <View accessibilityViewIsModal style={[s.sheet, { backgroundColor: isDark ? '#14251d' : '#fffef9', paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={s.grabber} />
        <View style={s.heading}><View><Text style={[s.headingTitle, ink]}>整理首页</Text><Text style={s.hint}>选择内容，拖动调整顺序</Text></View><Pressable accessibilityRole='button' accessibilityLabel='关闭整理首页' disabled={saving} onPress={onClose} hitSlop={12}><IconfontText className='iconfont icon-close' size={18} color='#8b9b91' /></Pressable></View>
        <View style={s.summary}><IconfontText className='iconfont icon-a-144-lvye' size={13} color='#148460' /><Text style={s.summaryText}>当前：{selectedDensity.label}布局 · {draft.quickStats.length} 项快捷</Text></View>
        <View style={[s.section, card]}>
          <Text style={[s.sectionTitle, ink]}>布局密度</Text>
          <View style={s.densities}>{densities.map(item => <Pressable key={item.id} accessibilityRole='button' accessibilityState={{ selected: draft.density === item.id }} onPress={() => setDraft(previous => ({ ...previous, density: item.id }))} style={[s.density, draft.density === item.id && s.selectedDensity]}><Text style={[s.densityText, draft.density === item.id && s.selectedDensityText]}>{item.label}</Text></Pressable>)}</View>
          <Text style={s.description}>{draft.density === 'smart' ? '内容多时自动使用横滑和紧凑列表' : draft.density === 'compact' ? '缩短模块间距，同屏查看更多内容' : '增加留白，阅读节奏更舒缓'}</Text>
        </View>
        <View style={[s.section, card]}>
          <View style={s.heading}><Text style={[s.sectionTitle, ink]}>快捷数据卡</Text><Text style={s.description}>已选 {draft.quickStats.length}</Text></View>
          <Text style={s.description}>1–3 项自适应铺满，4 项可左右滑动</Text>
          <View style={s.quickGrid}>{HOME_QUICK_STATS.map(item => <View key={item.id} style={[s.quickItem, draft.quickStats.includes(item.id) && [s.selectedQuick, { backgroundColor: isDark ? '#263c30' : '#f1faf5' }]]}><IconfontText className={`iconfont ${quickIcons[item.id]}`} size={14} color='#238563' /><Text style={[s.quickLabel, ink]}>{item.label}</Text><Switch accessibilityLabel={`显示${item.label}`} value={draft.quickStats.includes(item.id)} trackColor={{ true: '#0fb47c' }} onValueChange={visible => setDraft(previous => toggleHomeQuickStat(previous, item.id, visible))} /></View>)}</View>
        </View>
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>{draft.order.map((id, index) => {
          const item = HOME_MODULES.find(module => module.id === id)!
          return <View key={id} style={[s.row, card]}>
            <DragHandle label={item.label} onMove={steps => move(id, steps)} />
            <View style={s.moduleIcon}><IconfontText className={`iconfont ${icons[id]}`} size={18} color='#5ab38b' /></View>
            <View style={s.copy}><Text style={[s.moduleTitle, ink]}>{item.label}</Text><Text style={s.description} numberOfLines={2}>{id === 'body' ? `${draft.quickStats.length} 项快捷记录 · 在上方分别选择` : locks[id] || item.description}</Text></View>
            <View><Pressable accessibilityRole='button' accessibilityLabel={`上移${item.label}`} disabled={index === 0} style={[s.arrow, index === 0 && s.disabled]} onPress={() => move(id, -1)}><ChevronUp size={14} color='#71897b' /></Pressable><Pressable accessibilityRole='button' accessibilityLabel={`下移${item.label}`} disabled={index === draft.order.length - 1} style={[s.arrow, index === draft.order.length - 1 && s.disabled]} onPress={() => move(id, 1)}><ChevronDown size={14} color='#71897b' /></Pressable></View>
            {id === 'body' ? <Text style={s.count}>{draft.quickStats.length} 项</Text> : <Switch accessibilityLabel={`显示${item.label}`} accessibilityHint={locks[id]} disabled={Boolean(locks[id])} value={isHomeModuleVisible(draft, id, locks)} trackColor={{ true: '#0fb47c' }} onValueChange={visible => setDraft(previous => ({ ...previous, hidden: visible ? previous.hidden.filter(key => key !== id) : [...previous.hidden.filter(key => key !== id), id] }))} />}
          </View>
        })}</ScrollView>
        <View style={s.footer}><Pressable accessibilityRole='button' disabled={saving} onPress={() => setDraft(defaultHomeModuleLayout())} style={s.reset}><Text style={s.resetText}>恢复默认</Text></Pressable><Pressable accessibilityRole='button' accessibilityLabel='保存首页布局' disabled={saving} onPress={async () => { if (savePending.current) return; savePending.current = true; setSaving(true); try { await onSave(draft) } finally { savePending.current = false; setSaving(false) } }} style={[s.save, saving && s.disabled]}><Text style={s.saveText}>完成</Text></Pressable></View>
      </View>
    </View>
  </Modal>
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(27,44,32,0.45)' },
  sheet: { height: '87%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 15 },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#ccd3c6', alignSelf: 'center', marginTop: 8, marginBottom: 6 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headingTitle: { fontSize: 21, lineHeight: 28, fontWeight: '800' }, hint: { fontSize: 12, lineHeight: 17, color: '#7f8d83' },
  summary: { flexDirection: 'row', gap: 5, borderRadius: 16, backgroundColor: '#e9f7ed', paddingHorizontal: 10, paddingVertical: 6, marginVertical: 8 },
  summaryText: { color: '#256b52', fontSize: 11, fontWeight: '700' }, section: { padding: 9, borderRadius: 15, borderWidth: 1, borderColor: '#edf1e9', marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800' }, densities: { flexDirection: 'row', backgroundColor: '#f0f4ef', borderRadius: 18, marginTop: 8, marginBottom: 5 },
  density: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 18 }, densityText: { color: '#546e5e', fontSize: 12, fontWeight: '700' }, selectedDensity: { backgroundColor: '#18865e' }, selectedDensityText: { color: '#fff' },
  description: { fontSize: 10, lineHeight: 14, color: '#8b998f', marginTop: 2 }, quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  quickItem: { width: '49%', flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#edf1e9', borderRadius: 10, paddingHorizontal: 7, minHeight: 36 },
  selectedQuick: { borderColor: '#45b993', backgroundColor: '#f1faf5' }, quickLabel: { flex: 1, fontSize: 12, fontWeight: '600', marginLeft: 5 },
  list: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e9eee7', paddingVertical: 3 },
  handle: { width: 22, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }, moduleIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e5f5ea', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  copy: { flex: 1 }, moduleTitle: { fontSize: 14, fontWeight: '800' }, arrow: { minWidth: 28, minHeight: 22, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.3 }, count: { color: '#7b9987', fontSize: 11, width: 50, textAlign: 'right' },
  footer: { flexDirection: 'row', gap: 10, paddingTop: 14 }, reset: { flex: 1, minHeight: 42, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#afd0ba' }, resetText: { color: '#36765b', fontSize: 14 },
  save: { flex: 1, minHeight: 42, borderRadius: 24, backgroundColor: '#147653', alignItems: 'center', justifyContent: 'center' }, saveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
})
