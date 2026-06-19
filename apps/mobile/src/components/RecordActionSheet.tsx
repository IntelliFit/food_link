import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Camera, FileText, History, Image as ImageIcon, Package as PackageIcon, Search, Sparkles, Star, Utensils, type LucideIcon } from 'lucide-react-native'
import { colors, radius, shadow } from '../theme'

export type RecordAction = 'camera' | 'library' | 'text' | 'manual' | 'foodLibrary' | 'packagedFood' | 'recipes' | 'history' | 'gooseDuckChicken'

interface RecordActionSheetProps {
  visible: boolean
  onClose: () => void
  onSelect: (action: RecordAction) => void
}

type PrimaryTone = 'green' | 'blue' | 'gold' | 'purple'

const PRIMARY_ACTIONS: Array<{ key: RecordAction; title: string; desc: string; tone: PrimaryTone; icon: LucideIcon }> = [
  { key: 'camera', title: '拍照识别', desc: '拍摄餐食，自动估算热量', tone: 'green', icon: Camera },
  { key: 'library', title: '相册上传', desc: '选择已有食物图片', tone: 'blue', icon: ImageIcon },
  { key: 'text', title: '文本输入', desc: '一句话描述吃了什么', tone: 'gold', icon: FileText },
  { key: 'manual', title: '食物库输入', desc: '按食物和重量精确录入', tone: 'purple', icon: Utensils },
]

const QUICK_ACTIONS: Array<{ key: RecordAction; title: string; desc: string; icon: LucideIcon }> = [
  { key: 'gooseDuckChicken', title: '鹅鸭鸡识别', desc: '单纯判断鹅腿、鸭腿或鸡腿', icon: Sparkles },
  { key: 'recipes', title: '我的收藏', desc: '快速记录常吃餐食', icon: Star },
  { key: 'history', title: '识别记录', desc: '查看以往识别结果', icon: History },
  { key: 'packagedFood', title: '包装食品', desc: '上传营养成分表或商品包装', icon: PackageIcon },
  { key: 'foodLibrary', title: '食物库', desc: '浏览营养库与自定义食物', icon: Search },
]

const toneColor: Record<PrimaryTone, string> = {
  green: '#38a97b',
  blue: '#4295bc',
  gold: '#9f823a',
  purple: '#6951bd',
}

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
              <PrimaryActionTile key={action.key} action={action} onSelect={onSelect} />
            ))}
          </View>
          <ScrollView style={styles.actionList} showsVerticalScrollIndicator={false}>
            {QUICK_ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
                onPress={() => onSelect(action.key)}
              >
                <View style={styles.quickIconBadge}>
                  <action.icon size={20} color={colors.brandDark} strokeWidth={2.3} />
                </View>
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

function PrimaryActionTile({
  action,
  onSelect,
}: {
  action: (typeof PRIMARY_ACTIONS)[number]
  onSelect: (action: RecordAction) => void
}) {
  const Icon = action.icon
  return (
    <Pressable
      style={({ pressed }) => [styles.primaryAction, styles[`${action.tone}Action`], pressed && styles.pressed]}
      onPress={() => onSelect(action.key)}
    >
      <View style={[styles.actionIconBadge, styles[`${action.tone}Icon`]]}>
        <Icon size={25} color={toneColor[action.tone]} strokeWidth={2.4} />
      </View>
      <Text style={styles.primaryTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
        {action.title}
      </Text>
      <Text style={styles.primaryDesc} numberOfLines={2}>
        {action.desc}
      </Text>
    </Pressable>
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 28,
    maxHeight: '86%',
    ...shadow,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
    color: colors.textSecondary,
  },
  primaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  primaryAction: {
    width: '48%',
    minHeight: 92,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
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
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
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
  primaryTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  quickIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: colors.brandSoft,
  },
  pressed: {
    opacity: 0.72,
  },
  quickText: {
    flex: 1,
  },
  quickTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  quickDesc: {
    marginTop: 2,
    color: colors.textSecondary,
  },
  chevron: {
    fontSize: 22,
    color: colors.textMuted,
  },
})
