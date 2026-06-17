import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors, radius, shadow } from '../theme'

export type RecordAction = 'camera' | 'library' | 'text' | 'manual' | 'foodLibrary' | 'packagedFood' | 'recipes' | 'history'

interface RecordActionSheetProps {
  visible: boolean
  onClose: () => void
  onSelect: (action: RecordAction) => void
}

const PRIMARY_ACTIONS: Array<{ key: RecordAction; title: string; desc: string; tone: 'green' | 'blue' | 'gold' | 'purple'; icon: string }> = [
  { key: 'camera', title: '拍照识别', desc: '拍摄餐食，自动估算热量', tone: 'green', icon: 'CAM' },
  { key: 'library', title: '相册上传', desc: '选择已有食物图片', tone: 'blue', icon: 'IMG' },
  { key: 'text', title: '文本输入', desc: '一句话描述吃了什么', tone: 'gold', icon: 'TXT' },
  { key: 'manual', title: '食物库输入', desc: '按食物和重量精确录入', tone: 'purple', icon: 'LIB' },
]

const QUICK_ACTIONS: Array<{ key: RecordAction; title: string; desc: string }> = [
  { key: 'recipes', title: '我的收藏', desc: '快速记录常吃餐食' },
  { key: 'history', title: '识别记录', desc: '查看以往识别结果' },
  { key: 'packagedFood', title: '包装食品', desc: '上传营养成分表或商品包装' },
  { key: 'foodLibrary', title: '食物库', desc: '浏览营养库与自定义食物' },
]

export function RecordActionSheet({ visible, onClose, onSelect }: RecordActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>记录一餐</Text>
          <Text style={styles.subtitle}>选择一种方式开始记录。</Text>
          <View style={styles.primaryGrid}>
            {PRIMARY_ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                style={({ pressed }) => [styles.primaryAction, styles[`${action.tone}Action`], pressed && styles.pressed]}
                onPress={() => onSelect(action.key)}
              >
                <View style={[styles.actionIconBadge, styles[`${action.tone}Icon`]]}>
                  <Text style={[styles.actionIcon, styles[`${action.tone}Text`]]}>{action.icon}</Text>
                </View>
                <Text style={styles.primaryTitle}>{action.title}</Text>
                <Text style={styles.primaryDesc}>{action.desc}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.actionList} showsVerticalScrollIndicator={false}>
            {QUICK_ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
                onPress={() => onSelect(action.key)}
              >
                <View style={styles.quickText}>
                  <Text style={styles.quickTitle}>{action.title}</Text>
                  <Text style={styles.quickDesc}>{action.desc}</Text>
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
  primaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  primaryAction: {
    width: '48.5%',
    minHeight: 124,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  greenAction: {
    backgroundColor: '#f9fefc',
    borderColor: '#d9faeb',
  },
  blueAction: {
    backgroundColor: '#f9fdfe',
    borderColor: '#d9f2fa',
  },
  goldAction: {
    backgroundColor: '#fefcf7',
    borderColor: '#f7e9ce',
  },
  purpleAction: {
    backgroundColor: '#fefcfe',
    borderColor: '#e6defa',
  },
  actionIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  greenIcon: {
    backgroundColor: '#ebfcf4',
  },
  blueIcon: {
    backgroundColor: '#ebf7fc',
  },
  goldIcon: {
    backgroundColor: '#fbf5e6',
  },
  purpleIcon: {
    backgroundColor: '#f3effc',
  },
  actionIcon: {
    fontSize: 11,
    fontWeight: '900',
  },
  greenText: {
    color: '#38a97b',
  },
  blueText: {
    color: '#4295bc',
  },
  goldText: {
    color: '#9f823a',
  },
  purpleText: {
    color: '#6951bd',
  },
  primaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  primaryDesc: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  actionList: {
    flexGrow: 0,
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pressed: {
    opacity: 0.72,
  },
  quickText: {
    flex: 1,
  },
  quickTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  quickDesc: {
    marginTop: 2,
    color: colors.textSecondary,
  },
  chevron: {
    fontSize: 28,
    color: colors.textMuted,
  },
})
