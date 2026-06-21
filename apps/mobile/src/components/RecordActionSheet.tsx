import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Camera, ChevronRight, FileText, History, Image as ImageIcon, Star, Utensils, type LucideIcon } from 'lucide-react-native'

export type RecordAction = 'camera' | 'library' | 'text' | 'manual' | 'recipes' | 'history'

interface RecordActionSheetProps {
  visible: boolean
  onClose: () => void
  onSelect: (action: RecordAction) => void
  guide?: RecordActionSheetGuide | null
}

type PrimaryTone = 'green' | 'blue' | 'gold' | 'purple'
export type RecordActionSheetGuide = {
  actionKey?: RecordAction
  title: string
  description: string
  stepLabel: string
  primaryLabel: string
  onNext: () => void
  onSkip: () => void
}

const PRIMARY_ACTIONS: Array<{ key: RecordAction; title: string; tone: PrimaryTone; icon: LucideIcon }> = [
  { key: 'camera', title: '拍照识别', tone: 'green', icon: Camera },
  { key: 'library', title: '相册上传', tone: 'blue', icon: ImageIcon },
  { key: 'text', title: '文本输入', tone: 'gold', icon: FileText },
  { key: 'manual', title: '食物库输入', tone: 'purple', icon: Utensils },
]

const QUICK_ACTIONS: Array<{ key: RecordAction; title: string; desc: string; icon: LucideIcon }> = [
  { key: 'recipes', title: '我的收藏', desc: '快速记录常吃餐食', icon: Star },
  { key: 'history', title: '识别记录', desc: '查看以往识别记录', icon: History },
]

const toneStyle: Record<PrimaryTone, { color: string; backgroundColor: string; borderColor: string; iconBg: string }> = {
  green: {
    color: '#38a97b',
    backgroundColor: '#f9fefc',
    borderColor: '#d9faeb',
    iconBg: '#ebfcf4',
  },
  blue: {
    color: '#4295bc',
    backgroundColor: '#f9fdfe',
    borderColor: '#d9f2fa',
    iconBg: '#ebf7fc',
  },
  gold: {
    color: '#9f823a',
    backgroundColor: '#fefcf7',
    borderColor: '#f7e9ce',
    iconBg: '#fbf5e6',
  },
  purple: {
    color: '#6951bd',
    backgroundColor: '#fefcfe',
    borderColor: '#e6defa',
    iconBg: '#f3effc',
  },
}

export function RecordActionSheet({ visible, onClose, onSelect, guide }: RecordActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet} pointerEvents="box-none">
          <View style={styles.handle} />
          {guide ? <RecordActionGuideCard guide={guide} /> : null}
          <View style={styles.primaryGrid}>
            {PRIMARY_ACTIONS.map((action) => (
              <PrimaryActionTile key={action.key} action={action} onSelect={onSelect} highlighted={guide?.actionKey === action.key} />
            ))}
          </View>
          <View style={styles.actionList}>
            {QUICK_ACTIONS.map((action, index) => (
              <Pressable
                key={action.key}
                style={({ pressed }) => [
                  styles.quickAction,
                  index < QUICK_ACTIONS.length - 1 && styles.quickActionBorder,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelect(action.key)}
              >
                <View style={styles.quickText}>
                  <Text style={styles.quickTitle}>{action.title}</Text>
                  <Text style={styles.quickDesc}>{action.desc}</Text>
                </View>
                <ChevronRight size={20} color="#cbd5e1" strokeWidth={2.2} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  )
}

function RecordActionGuideCard({ guide }: { guide: RecordActionSheetGuide }) {
  return (
    <View style={styles.guideCard}>
      <View style={styles.guideKickerRow}>
        <Text style={styles.guideKicker}>{guide.stepLabel}</Text>
        <Pressable hitSlop={8} onPress={guide.onSkip}>
          <Text style={styles.guideSkip}>跳过</Text>
        </Pressable>
      </View>
      <Text style={styles.guideTitle}>{guide.title}</Text>
      <Text style={styles.guideDesc}>{guide.description}</Text>
      <Pressable style={({ pressed }) => [styles.guidePrimary, pressed && styles.pressed]} onPress={guide.onNext}>
        <Text style={styles.guidePrimaryText}>{guide.primaryLabel}</Text>
      </Pressable>
    </View>
  )
}

function PrimaryActionTile({
  action,
  onSelect,
  highlighted = false,
}: {
  action: (typeof PRIMARY_ACTIONS)[number]
  onSelect: (action: RecordAction) => void
  highlighted?: boolean
}) {
  const Icon = action.icon
  const style = toneStyle[action.tone]
  return (
    <Pressable
      style={({ pressed }) => [
        styles.primaryAction,
        { backgroundColor: style.backgroundColor, borderColor: style.borderColor },
        highlighted && [styles.primaryActionHighlighted, { borderColor: style.color }],
        pressed && styles.pressed,
      ]}
      onPress={() => onSelect(action.key)}
    >
      <View style={[styles.actionIconBadge, { backgroundColor: style.iconBg }]}>
        <Icon size={20} color={style.color} strokeWidth={2.2} />
      </View>
      <Text style={[styles.primaryTitle, { color: style.color }]} numberOfLines={1}>
        {action.title}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 12,
    paddingTop: 14,
    paddingBottom: 14,
    maxHeight: '86%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e7eb',
    marginBottom: 12,
  },
  guideCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  guideKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 7,
  },
  guideKicker: {
    color: '#38a97b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  guideSkip: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  guideTitle: {
    color: '#1f2937',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  guideDesc: {
    marginTop: 5,
    color: '#475569',
    fontSize: 13,
    lineHeight: 19,
  },
  guidePrimary: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 14,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#38a97b',
  },
  guidePrimaryText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  primaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  primaryAction: {
    width: '48.5%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 6,
    marginBottom: 8,
  },
  primaryActionHighlighted: {
    borderWidth: 2,
    shadowColor: '#38a97b',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  actionIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  actionList: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  quickActionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  quickText: {
    flex: 1,
    minWidth: 0,
  },
  quickTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1f2937',
    lineHeight: 21,
  },
  quickDesc: {
    marginTop: 2,
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.72,
  },
})
