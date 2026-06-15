import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors, radius, shadow } from '../theme'

export type RecordAction = 'camera' | 'library' | 'text' | 'manual' | 'foodLibrary' | 'packagedFood' | 'recipes'

interface RecordActionSheetProps {
  visible: boolean
  onClose: () => void
  onSelect: (action: RecordAction) => void
}

const ACTIONS: Array<{ key: RecordAction; title: string; desc: string; icon: string }> = [
  { key: 'camera', title: '拍照识别', desc: '拍摄餐食，自动估算热量', icon: 'CAM' },
  { key: 'library', title: '相册识别', desc: '选择已有食物图片', icon: 'IMG' },
  { key: 'text', title: '文字记录', desc: '用一句话描述吃了什么', icon: 'TXT' },
  { key: 'manual', title: '手动记录', desc: '按食物和重量精确录入', icon: 'MAN' },
  { key: 'packagedFood', title: '包装食品', desc: '上传营养成分表或商品包装', icon: 'PKG' },
  { key: 'foodLibrary', title: '食物库', desc: '从常用食物中快速添加', icon: 'LIB' },
  { key: 'recipes', title: '收藏食谱', desc: '快速记录常吃餐食组合', icon: 'REC' },
]

export function RecordActionSheet({ visible, onClose, onSelect }: RecordActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>记录一餐</Text>
          <Text style={styles.subtitle}>选择一种方式开始记录。</Text>
          <ScrollView style={styles.actionList} showsVerticalScrollIndicator={false}>
            {ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                onPress={() => onSelect(action.key)}
              >
                <Text style={styles.actionIcon}>{action.icon}</Text>
                <View style={styles.actionText}>
                  <Text style={styles.actionTitle}>{action.title}</Text>
                  <Text style={styles.actionDesc}>{action.desc}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 34,
    maxHeight: '86%',
    ...shadow,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 14,
    color: colors.textSecondary,
  },
  actionList: {
    flexGrow: 0,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pressed: {
    opacity: 0.72,
  },
  actionIcon: {
    width: 42,
    fontSize: 12,
    fontWeight: '800',
    color: colors.brandDark,
  },
  actionText: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  actionDesc: {
    marginTop: 2,
    color: colors.textSecondary,
  },
  chevron: {
    fontSize: 28,
    color: colors.textMuted,
  },
})
