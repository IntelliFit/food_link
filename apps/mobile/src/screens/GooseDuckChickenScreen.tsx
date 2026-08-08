import { useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Camera, Image as ImageIcon, RotateCcw, X } from 'lucide-react-native'
import type { GooseDuckChickenClassifyResult } from '@food-link/api-client'
import { apiClient } from '../api'
import { useAppDialog } from '../providers/DialogProvider'
import { userFacingErrorMessage } from '../utils/errors'

type SourceSheetState = 'hidden' | 'visible'

export function GooseDuckChickenScreen() {
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const [imageAsset, setImageAsset] = useState<ImagePicker.ImagePickerAsset | null>(null)
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<GooseDuckChickenClassifyResult | null>(null)
  const [sourceSheet, setSourceSheet] = useState<SourceSheetState>('hidden')
  const bottomInset = Math.max(insets.bottom, 14)

  const pickImage = async (source: 'camera' | 'library') => {
    setSourceSheet('hidden')
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        await dialog.alert('需要相机权限', '请允许 App 拍摄图片后再进行专线识别。', 'warning')
        return
      }
    }

    const picked = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.88 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.88,
        })
    if (picked.canceled || !picked.assets[0]) return
    setImageAsset(picked.assets[0])
    setResult(null)
  }

  const submit = async () => {
    if (submitting) return
    if (!imageAsset) {
      await dialog.alert('请先上传一张图片', '鹅腿、鸭腿、鸡腿，或“鹅腿阿姨”同款图都可以。', 'warning')
      return
    }

    setSubmitting(true)
    try {
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: imageAsset.uri,
        fileName: imageAsset.fileName || 'goose-duck-chicken.jpg',
        mimeType: imageAsset.mimeType || 'image/jpeg',
      })
      const classified = await apiClient.classifyGooseDuckChicken({
        imageUrl: uploaded.imageUrl,
        additionalContext: additionalInfo.trim() || undefined,
      })
      setResult(classified)
    } catch (error) {
      await dialog.alert('专线识别失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View style={styles.page}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 122 + bottomInset }]}
      >
        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <Text style={styles.heroKicker}>鹅腿阿姨热点识别</Text>
          <Text style={styles.heroTitle}>鹅腿、鸭腿，还是鸡腿？</Text>
          <Text style={styles.heroDesc}>上传一张图片，食探会用专项识别流程，只围绕鹅 / 鸭 / 鸡做判断。</Text>
        </View>

        <View style={styles.card}>
          {imageAsset ? (
            <View>
              <View style={styles.previewWrap}>
                <Image source={{ uri: imageAsset.uri }} style={styles.previewImage} resizeMode="cover" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="移除图片"
                  style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                  onPress={() => {
                    setImageAsset(null)
                    setResult(null)
                  }}
                >
                  <X size={21} color="#fff" strokeWidth={2.4} />
                </Pressable>
              </View>
              <Pressable style={({ pressed }) => [styles.repickButton, pressed && styles.pressed]} onPress={() => setSourceSheet('visible')}>
                <RotateCcw size={15} color="#bd6a3c" strokeWidth={2.4} />
                <Text style={styles.repickText}>换一张图片</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={({ pressed }) => [styles.uploadPlaceholder, pressed && styles.pressed]} onPress={() => setSourceSheet('visible')}>
              <Text style={styles.uploadPlus}>+</Text>
              <Text style={styles.uploadTitle}>上传要识别的图片</Text>
              <Text style={styles.uploadDesc}>鹅腿、鸭腿、鸡腿，或“鹅腿阿姨”同款图都可以</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>补充线索</Text>
          <TextInput
            value={additionalInfo}
            onChangeText={setAdditionalInfo}
            multiline
            maxLength={120}
            textAlignVertical="top"
            style={styles.textarea}
            placeholder="例如：这是校门口买的、外皮偏甜、带竹签、看起来像烤腿..."
            placeholderTextColor="#b6a89a"
          />
        </View>

        <View style={[styles.card, styles.ruleCard]}>
          <Text style={styles.sectionTitle}>当前是单纯识别通道</Text>
          <Text style={styles.ruleText}>这条通道只判断鹅 / 鸭 / 鸡，不进入普通食物分析、营养回算或饮食记录结果页。</Text>
        </View>

        {result ? (
          <View style={[styles.card, styles.resultCard]}>
            <Text style={styles.resultKicker}>识别结果</Text>
            <Text style={styles.resultLabel}>{result.label || '不确定'}</Text>
            <Text style={styles.resultConfidence}>置信度 {Math.round((result.confidence || 0) * 100)}%</Text>
            {result.reason ? <Text style={styles.resultReason}>{result.reason}</Text> : null}
            {result.evidence.length ? (
              <View style={styles.evidenceBox}>
                {result.evidence.slice(0, 3).map((item, index) => (
                  <Text key={`${item}-${index}`} style={styles.evidenceItem}>- {item}</Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: bottomInset }]}>
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          style={({ pressed }) => [styles.submitButton, pressed && !submitting && styles.submitPressed, submitting && styles.submitDisabled]}
          onPress={submit}
        >
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text style={styles.submitText}>开始专线识别</Text>
        </Pressable>
      </View>

      <Modal visible={sourceSheet === 'visible'} transparent animationType="fade" onRequestClose={() => setSourceSheet('hidden')}>
        <Pressable style={styles.sourceBackdrop} onPress={() => setSourceSheet('hidden')}>
          <Pressable style={[styles.sourceSheet, { paddingBottom: bottomInset + 14 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>选择图片</Text>
            <Pressable style={({ pressed }) => [styles.sourceRow, pressed && styles.pressed]} onPress={() => void pickImage('camera')}>
              <View style={styles.sourceIcon}>
                <Camera size={20} color="#bd6a3c" strokeWidth={2.4} />
              </View>
              <Text style={styles.sourceText}>拍照</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.sourceRow, pressed && styles.pressed]} onPress={() => void pickImage('library')}>
              <View style={styles.sourceIcon}>
                <ImageIcon size={20} color="#bd6a3c" strokeWidth={2.4} />
              </View>
              <Text style={styles.sourceText}>从相册选择</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f7f2eb',
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 14,
  },
  hero: {
    minHeight: 126,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 17,
    backgroundColor: '#be4d36',
    shadowColor: '#9f502b',
    shadowOpacity: 0.2,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 9 },
    elevation: 3,
  },
  heroGlow: {
    position: 'absolute',
    top: -34,
    right: -22,
    width: 150,
    height: 118,
    borderRadius: 75,
    backgroundColor: 'rgba(255, 236, 178, 0.42)',
  },
  heroKicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    color: 'rgba(255, 244, 214, 0.86)',
  },
  heroTitle: {
    marginTop: 4,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
    color: '#fff',
  },
  heroDesc: {
    marginTop: 5,
    maxWidth: 292,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255, 255, 255, 0.84)',
  },
  card: {
    marginTop: 11,
    padding: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(120, 85, 58, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    shadowColor: '#504030',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  uploadPlaceholder: {
    minHeight: 165,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(150, 122, 92, 0.28)',
    backgroundColor: '#fffaf3',
  },
  uploadPlus: {
    fontSize: 31,
    lineHeight: 37,
    color: '#bd6a3c',
  },
  uploadTitle: {
    marginTop: 5,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    color: '#3d2c25',
  },
  uploadDesc: {
    marginTop: 4,
    maxWidth: '86%',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
    color: '#8a7466',
  },
  previewWrap: {
    height: 180,
    overflow: 'hidden',
    borderRadius: 11,
    backgroundColor: '#f5ede2',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
  },
  repickButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  repickText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    color: '#bd6a3c',
  },
  sectionTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    color: '#34251f',
  },
  textarea: {
    minHeight: 82,
    marginTop: 7,
    padding: 9,
    borderRadius: 9,
    backgroundColor: '#f9f4ec',
    color: '#3d2c25',
    fontSize: 13,
    lineHeight: 18,
  },
  ruleCard: {
    backgroundColor: 'rgba(255, 248, 235, 0.9)',
  },
  ruleText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#7d6a5d',
  },
  resultCard: {
    backgroundColor: '#fff',
  },
  resultKicker: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    color: '#bd6a3c',
  },
  resultLabel: {
    marginTop: 4,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    color: '#34251f',
  },
  resultConfidence: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    color: '#bd4c34',
  },
  resultReason: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#6f5b50',
  },
  evidenceBox: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#fff7ec',
  },
  evidenceItem: {
    fontSize: 12,
    lineHeight: 17,
    color: '#8a5a37',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(247, 242, 235, 0.94)',
  },
  submitButton: {
    minHeight: 46,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#bd4c34',
    shadowColor: '#bd4c34',
    shadowOpacity: 0.26,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  submitDisabled: {
    opacity: 0.78,
  },
  submitPressed: {
    transform: [{ scale: 0.98 }],
  },
  submitText: {
    fontSize: 15.5,
    lineHeight: 21,
    fontWeight: '900',
    color: '#fff',
  },
  sourceBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.34)',
  },
  sourceSheet: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#fff',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 34,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    marginBottom: 12,
  },
  sheetTitle: {
    marginBottom: 8,
    fontSize: 16,
    fontWeight: '800',
    color: '#34251f',
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  sourceIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: '#fff3e3',
  },
  sourceText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#34251f',
  },
  pressed: {
    opacity: 0.72,
  },
})
