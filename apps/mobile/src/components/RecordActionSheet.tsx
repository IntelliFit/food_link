import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Camera, ChevronRight, FileText, History, Image as ImageIcon, Star, Utensils, type LucideIcon } from 'lucide-react-native'

export type RecordAction = 'camera' | 'library' | 'text' | 'manual' | 'foodLibrary' | 'packagedFood' | 'recipes' | 'history' | 'gooseDuckChicken'

interface RecordActionSheetProps {
  visible: boolean
  onClose: () => void
  onSelect: (action: RecordAction) => void
}

type PrimaryTone = 'green' | 'blue' | 'gold' | 'purple'

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

export function RecordActionSheet({ visible, onClose, onSelect }: RecordActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet} pointerEvents="box-none">
          <View style={styles.handle} />
          <View style={styles.primaryGrid}>
            {PRIMARY_ACTIONS.map((action) => (
              <PrimaryActionTile key={action.key} action={action} onSelect={onSelect} />
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

function PrimaryActionTile({
  action,
  onSelect,
}: {
  action: (typeof PRIMARY_ACTIONS)[number]
  onSelect: (action: RecordAction) => void
}) {
  const Icon = action.icon
  const style = toneStyle[action.tone]
  return (
    <Pressable
      style={({ pressed }) => [
        styles.primaryAction,
        { backgroundColor: style.backgroundColor, borderColor: style.borderColor },
        pressed && styles.pressed,
      ]}
      onPress={() => onSelect(action.key)}
    >
      <View style={[styles.actionIconBadge, { backgroundColor: style.iconBg }]}>
        <Icon size={25} color={style.color} strokeWidth={2.2} />
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
    padding: 16,
    paddingBottom: 28,
    maxHeight: '86%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e5e7eb',
    marginBottom: 24,
  },
  primaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  primaryAction: {
    width: '48%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 12,
    gap: 12,
    marginBottom: 12,
  },
  actionIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  actionList: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
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
