import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import * as ImagePicker from 'expo-image-picker'
import type {
  CampusCollectorProfile,
  DiningCanteenItem,
  DiningLocationItem,
  DiningLocationSiteItem,
} from '@food-link/api-client'
import { apiClient } from '../api'
import { useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { userFacingErrorMessage } from '../utils/errors'
import { colors } from '../theme'

const MAX_BATCH_ENTRIES = 30

type DraftEntry = {
  id: string
  localUri: string
  imageUrl: string
  name: string
  price: string
  portion: string
}

type PickerKind = 'school' | 'campus' | 'canteen'
type PickerItem = DiningLocationItem | DiningLocationSiteItem | DiningCanteenItem

export function CampusFoodCollectorScreen() {
  const dialog = useAppDialog()
  const { isDark } = useColorScheme()
  const palette = useMemo(() => createPalette(isDark), [isDark])
  const [profile, setProfile] = useState<CampusCollectorProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [school, setSchool] = useState<DiningLocationItem | null>(null)
  const [campus, setCampus] = useState<DiningLocationSiteItem | null>(null)
  const [canteen, setCanteen] = useState<DiningCanteenItem | null>(null)
  const [schools, setSchools] = useState<DiningLocationItem[]>([])
  const [campuses, setCampuses] = useState<DiningLocationSiteItem[]>([])
  const [canteens, setCanteens] = useState<DiningCanteenItem[]>([])
  const [picker, setPicker] = useState<PickerKind | null>(null)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [applicationNote, setApplicationNote] = useState('')
  const [floor, setFloor] = useState('')
  const [windowName, setWindowName] = useState('')
  const [batchNote, setBatchNote] = useState('')
  const [entries, setEntries] = useState<DraftEntry[]>([])
  const [applying, setApplying] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [clientBatchKey, setClientBatchKey] = useState(newBatchKey)

  const applyPreferredScope = useCallback((next: CampusCollectorProfile) => {
    const scope = next.active_scopes?.[0]
    if (!scope) return
    setSchool({ id: scope.school_id, name: scope.school_name || '已授权学校', location_type: 'university' })
    setCampus(scope.campus_id ? { id: scope.campus_id, school_id: scope.school_id, name: scope.campus_name || '已授权校区' } : null)
    setCanteen(scope.canteen_id && scope.campus_id ? {
      id: scope.canteen_id,
      school_id: scope.school_id,
      campus_id: scope.campus_id,
      name: scope.canteen_name || '已授权食堂',
    } : null)
  }, [])

  const loadProfile = useCallback(async () => {
    setProfileLoading(true)
    try {
      const next = await apiClient.getCampusCollectorProfile()
      setProfile(next)
      applyPreferredScope(next)
    } catch (error) {
      await dialog.alert('读取校园采集员资料失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setProfileLoading(false)
    }
  }, [applyPreferredScope, dialog])

  useFocusEffect(useCallback(() => { void loadProfile() }, [loadProfile]))

  const openPicker = useCallback(async (kind: PickerKind) => {
    if (kind === 'campus' && !school) {
      await dialog.alert('请先选择学校', undefined, 'warning')
      return
    }
    if (kind === 'canteen' && !campus) {
      await dialog.alert('请先选择校区', undefined, 'warning')
      return
    }
    setPicker(kind)
    setPickerLoading(true)
    try {
      if (kind === 'school') setSchools(await apiClient.searchDiningLocations({ type: 'university', limit: 100 }))
      if (kind === 'campus' && school) setCampuses(await apiClient.getDiningLocationSites(school.id))
      if (kind === 'canteen' && campus) setCanteens(await apiClient.getDiningLocationCanteens(campus.id))
    } catch (error) {
      setPicker(null)
      await dialog.alert('获取校园目录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setPickerLoading(false)
    }
  }, [campus, dialog, school])

  const pickerItems: PickerItem[] = picker === 'school' ? schools : picker === 'campus' ? campuses : canteens
  const choosePickerItem = (item: PickerItem) => {
    if (picker === 'school') {
      const selected = item as DiningLocationItem
      if (profile?.can_batch && !profile.active_scopes.some((scope) => scope.school_id === selected.id)) {
        void dialog.alert('该学校不在授权范围', undefined, 'warning')
        return
      }
      setSchool(selected)
      setCampus(null)
      setCanteen(null)
      setFloor('')
      setWindowName('')
    } else if (picker === 'campus') {
      const selected = item as DiningLocationSiteItem
      if (profile?.can_batch && !profile.active_scopes.some((scope) => scope.school_id === selected.school_id && (!scope.campus_id || scope.campus_id === selected.id))) {
        void dialog.alert('该校区不在授权范围', undefined, 'warning')
        return
      }
      setCampus(selected)
      setCanteen(null)
      setFloor('')
      setWindowName('')
    } else if (picker === 'canteen') {
      const selected = item as DiningCanteenItem
      if (profile?.can_batch && !profile.active_scopes.some((scope) => scope.school_id === selected.school_id && (!scope.campus_id || scope.campus_id === campus?.id) && (!scope.canteen_id || scope.canteen_id === selected.id))) {
        void dialog.alert('该食堂不在授权范围', undefined, 'warning')
        return
      }
      setCanteen(selected)
      setFloor('')
      setWindowName('')
      void apiClient.getDiningCanteenFloors(selected.id).then((items) => {
        const preferred = items.find((item) => item.is_default)
        if (preferred) setFloor(preferred.name)
      }).catch(() => undefined)
    }
    setPicker(null)
  }

  const submitApplication = async () => {
    if (!school || applying) {
      if (!school) await dialog.alert('请先选择学校', undefined, 'warning')
      return
    }
    setApplying(true)
    try {
      await apiClient.applyCampusCollector({
        school_id: school.id,
        campus_id: campus?.id,
        canteen_id: canteen?.id,
        applicant_note: applicationNote.trim() || undefined,
      })
      await dialog.alert('申请已提交', '管理员授权后，本页会自动开放批量采集。', 'success')
      await loadProfile()
    } catch (error) {
      await dialog.alert('提交申请失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setApplying(false)
    }
  }

  const chooseBatchImages = async (source: 'camera' | 'library' = 'library') => {
    const remain = MAX_BATCH_ENTRIES - entries.length
    if (remain <= 0 || uploading) return
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.84, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.84,
        allowsMultipleSelection: true,
        selectionLimit: Math.min(remain, 9),
      })
    if (result.canceled || !result.assets.length) return
    setUploading(true)
    let failures = 0
    for (const [index, asset] of result.assets.entries()) {
      try {
        const uploaded = await apiClient.uploadCampusFoodImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || `campus-food-${Date.now()}-${index}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        })
        setEntries((current) => [...current, {
          id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
          localUri: asset.uri,
          imageUrl: uploaded.imageUrl,
          name: '',
          price: '',
          portion: '',
        }])
      } catch {
        failures += 1
      }
    }
    setUploading(false)
    if (failures) await dialog.alert('部分照片上传失败', `有 ${failures} 张未上传成功，已保留成功项。`, 'warning')
  }

  const updateEntry = (id: string, patch: Partial<DraftEntry>) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))
  }

  const submitBatch = async () => {
    if (submitting) return
    if (!school || !campus || !canteen) {
      await dialog.alert('请选择学校、校区和食堂', undefined, 'warning')
      return
    }
    if (!entries.length) {
      await dialog.alert('请先连续拍照或多选图片', undefined, 'warning')
      return
    }
    const missing = entries.findIndex((entry) => !entry.name.trim() || !entry.imageUrl)
    if (missing >= 0) {
      await dialog.alert(`请补全第 ${missing + 1} 道菜的名称`, undefined, 'warning')
      return
    }
    const confirmed = await dialog.confirm({
      title: `发布 ${entries.length} 道菜`,
      message: '学校、校区、食堂等公共信息只提交一次；每道菜会立即建立版本并在后台分析营养。',
      confirmText: '立即发布',
      cancelText: '再检查一下',
    })
    if (!confirmed) return
    setSubmitting(true)
    try {
      const now = new Date()
      await apiClient.createCampusCollectorBatch({
        client_batch_key: clientBatchKey,
        batch_name: `${school.name}-${canteen.name}-${now.toISOString().slice(0, 10)}`,
        venue_type: 'university',
        school_id: school.id,
        campus_id: campus.id,
        canteen_id: canteen.id,
        organization_name: school.name,
        area_name: campus.name,
        canteen_name: canteen.name,
        default_floor: floor.trim() || undefined,
        default_window_name: windowName.trim() || undefined,
        default_window_layout: 'unknown',
        default_service_mode: 'unknown',
        captured_at: now.toISOString(),
        source_note: batchNote.trim() || undefined,
        entries: entries.map((entry) => ({
          entry_type: 'dish',
          name: entry.name.trim(),
          image_paths: [entry.imageUrl],
          floor: floor.trim() || undefined,
          window_name: windowName.trim() || undefined,
          price_type: entry.price ? 'fixed' : 'unknown',
          price: entry.price ? Number(entry.price) : undefined,
          price_unit: entry.price ? '元/份' : undefined,
          portion_description: entry.portion.trim() || undefined,
        })),
      })
      const count = entries.length
      setEntries([])
      setBatchNote('')
      setClientBatchKey(newBatchKey())
      await dialog.alert(`已发布 ${count} 道菜`, '营养分析将在后台继续。', 'success')
    } catch (error) {
      await dialog.alert('批量发布失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSubmitting(false)
    }
  }

  const pendingApplication = profile?.applications?.find((item) => item.status === 'pending')

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <View style={[styles.hero, { backgroundColor: palette.hero }]}>
        <Text style={[styles.title, { color: palette.text }]}>校园代理批量采集</Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>一次选择学校、食堂、楼层和窗口，再连续拍照录入多道菜。菜名和清晰照片必填，价格与份量可以后补。</Text>
      </View>

      {profileLoading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.brand} /></View>
      ) : !profile?.can_batch ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.cardTitle, { color: palette.text }]}>{pendingApplication ? '申请审核中' : '申请批量采集通道'}</Text>
            <Text style={[styles.cardDescription, { color: palette.textSecondary }]}>普通用户已经可以单菜上传；批量通道需按学校授权，不能访问后台其他数据。</Text>
            {pendingApplication ? (
              <View style={[styles.statusRow, { backgroundColor: palette.soft }]} accessibilityRole="alert">
                <View style={styles.statusDot} />
                <Text style={[styles.statusText, { color: palette.textSecondary }]}>申请已收到，管理员授权后本页会自动开放批量采集。</Text>
              </View>
            ) : (
              <>
                <PickerField label="学校 *" value={school?.name || '请选择'} onPress={() => void openPicker('school')} palette={palette} />
                <PickerField label="校区（可选范围）" value={campus?.name || '全校'} onPress={() => void openPicker('campus')} palette={palette} />
                <PickerField label="食堂（可选范围）" value={canteen?.name || '所选范围全部食堂'} onPress={() => void openPicker('canteen')} palette={palette} />
                <LabeledInput label="申请说明（可选）" value={applicationNote} onChangeText={setApplicationNote} placeholder="说明你负责的学校、预计采集食堂等" multiline palette={palette} />
                <PrimaryButton label="提交申请" busy={applying} disabled={!school} onPress={() => void submitApplication()} />
              </>
            )}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.cardHeading}>
              <Text style={[styles.cardTitle, { color: palette.text }]}>本次公共信息</Text>
              <Text style={styles.scopeBadge}>已授权批量通道</Text>
            </View>
            <PickerField label="学校 *" value={school?.name || '请选择'} onPress={() => void openPicker('school')} palette={palette} />
            <PickerField label="校区 *" value={campus?.name || '请选择'} onPress={() => void openPicker('campus')} palette={palette} />
            <PickerField label="食堂 *" value={canteen?.name || '请选择'} onPress={() => void openPicker('canteen')} palette={palette} />
            <View style={styles.inlineFields}>
              <View style={styles.halfField}><LabeledInput label="楼层" value={floor} onChangeText={setFloor} placeholder="可不填" palette={palette} /></View>
              <View style={styles.halfField}><LabeledInput label="窗口" value={windowName} onChangeText={setWindowName} placeholder="可不填" palette={palette} /></View>
            </View>
            <LabeledInput label="本批次备注（可选）" value={batchNote} onChangeText={setBatchNote} placeholder="来源或采集说明" multiline palette={palette} />
          </View>

          <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.cardHeading}>
              <Text style={[styles.cardTitle, { color: palette.text }]}>菜品照片 · {entries.length}/{MAX_BATCH_ENTRIES}</Text>
              <View style={styles.captureActions}>
                <Pressable accessibilityRole="button" accessibilityLabel="拍摄一道菜" onPress={() => void chooseBatchImages('camera')} disabled={uploading || entries.length >= MAX_BATCH_ENTRIES} style={({ pressed }) => [styles.addButton, (uploading || entries.length >= MAX_BATCH_ENTRIES) && styles.disabled, pressed && styles.pressed]}>
                  {uploading ? <ActivityIndicator size="small" color={colors.brand} /> : <Text style={styles.addButtonText}>拍照</Text>}
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="从相册多选菜品照片" onPress={() => void chooseBatchImages('library')} disabled={uploading || entries.length >= MAX_BATCH_ENTRIES} style={({ pressed }) => [styles.addButton, (uploading || entries.length >= MAX_BATCH_ENTRIES) && styles.disabled, pressed && styles.pressed]}>
                  <Text style={styles.addButtonText}>多选</Text>
                </Pressable>
              </View>
            </View>
            {!entries.length ? <Text style={[styles.empty, { color: palette.textSecondary }]}>选择多张图片后，会自动生成多条待填写菜品。</Text> : entries.map((entry, index) => (
              <View key={entry.id} style={[styles.entry, { borderColor: palette.border }]}>
                <Image source={{ uri: entry.localUri || entry.imageUrl }} style={styles.entryImage} accessibilityLabel={`第 ${index + 1} 道菜照片`} />
                <View style={styles.entryFields}>
                  <TextInput value={entry.name} onChangeText={(name) => updateEntry(entry.id, { name })} placeholder={`第 ${index + 1} 道菜名称 *`} placeholderTextColor={palette.textMuted} style={[styles.entryName, { color: palette.text, backgroundColor: palette.soft }]} />
                  <View style={styles.inlineFields}>
                    <TextInput value={entry.price} onChangeText={(price) => updateEntry(entry.id, { price: price.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" placeholder="价格" placeholderTextColor={palette.textMuted} style={[styles.entryInput, { color: palette.text, backgroundColor: palette.soft }]} />
                    <TextInput value={entry.portion} onChangeText={(portion) => updateEntry(entry.id, { portion })} placeholder="份量" placeholderTextColor={palette.textMuted} style={[styles.entryInput, { color: palette.text, backgroundColor: palette.soft }]} />
                  </View>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`删除第 ${index + 1} 道菜`} onPress={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}>
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
          <PrimaryButton label="批量立即发布" busy={submitting} disabled={!entries.length} onPress={() => void submitBatch()} />
          <View style={styles.safeBottom} />
        </ScrollView>
      )}

      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.overlay} onPress={() => setPicker(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: palette.card }]} onPress={(event) => event.stopPropagation()} accessibilityViewIsModal>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>{picker === 'school' ? '选择学校' : picker === 'campus' ? '选择校区' : '选择食堂'}</Text>
            {pickerLoading ? <View style={styles.loading}><ActivityIndicator color={colors.brand} /></View> : (
              <ScrollView style={styles.pickerList}>
                {pickerItems.map((item) => (
                  <Pressable key={item.id} style={({ pressed }) => [styles.pickerRow, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.soft }]} onPress={() => choosePickerItem(item)}>
                    <Text style={[styles.pickerRowText, { color: palette.text }]}>{item.name}</Text>
                  </Pressable>
                ))}
                {!pickerItems.length ? <Text style={[styles.empty, { color: palette.textSecondary }]}>暂无可选项</Text> : null}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

function PickerField({ label, value, onPress, palette }: { label: string; value: string; onPress: () => void; palette: ReturnType<typeof createPalette> }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}，${value}`} onPress={onPress} style={({ pressed }) => [styles.field, { backgroundColor: palette.soft, borderColor: palette.border }, pressed && styles.pressed]}>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: palette.text }]} numberOfLines={2}>{value}</Text>
    </Pressable>
  )
}

function LabeledInput({ label, value, onChangeText, placeholder, multiline, palette }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; palette: ReturnType<typeof createPalette> }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.label, { color: palette.textSecondary }]}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.textMuted} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} style={[styles.input, multiline && styles.textarea, { color: palette.text, backgroundColor: palette.soft, borderColor: palette.border }]} />
    </View>
  )
}

function PrimaryButton({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.primary, (disabled || busy) && styles.disabled, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  )
}

function createPalette(isDark: boolean) {
  return {
    background: isDark ? '#0d1512' : '#f7faf8',
    hero: isDark ? '#15231d' : '#e9f7f0',
    card: isDark ? '#18231f' : '#ffffff',
    soft: isDark ? '#21312a' : '#f4f8f6',
    border: isDark ? '#2c4037' : '#dfe9e4',
    text: isDark ? '#edf5f1' : '#1f342b',
    textSecondary: isDark ? '#abc0b7' : '#60746b',
    textMuted: isDark ? '#80968c' : '#8b9b94',
  }
}

function newBatchKey() {
  return `collector-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  hero: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '900' },
  subtitle: { marginTop: 8, fontSize: 14, lineHeight: 21 },
  content: { padding: 16, gap: 14 },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  captureActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardHeading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardTitle: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  cardDescription: { marginTop: 8, marginBottom: 12, fontSize: 13, lineHeight: 20 },
  statusRow: { minHeight: 52, marginTop: 12, padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
  statusText: { flex: 1, fontSize: 13, lineHeight: 19 },
  field: { minHeight: 62, marginTop: 10, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  label: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  value: { marginTop: 3, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  inputGroup: { marginTop: 12 },
  input: { minHeight: 48, marginTop: 6, paddingHorizontal: 13, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, fontSize: 15 },
  textarea: { minHeight: 92, paddingTop: 12 },
  primary: { minHeight: 52, marginTop: 16, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  disabled: { opacity: 0.46 },
  pressed: { opacity: 0.72 },
  scopeBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', color: '#167355', backgroundColor: '#dff5ea', fontSize: 11, fontWeight: '800' },
  inlineFields: { flexDirection: 'row', gap: 8 },
  halfField: { flex: 1, minWidth: 0 },
  addButton: { minHeight: 44, minWidth: 112, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e5f6ed' },
  addButtonText: { color: '#167355', fontSize: 12, fontWeight: '800' },
  empty: { paddingVertical: 18, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  entry: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  entryImage: { width: 68, height: 68, borderRadius: 12, backgroundColor: '#dce8e2' },
  entryFields: { flex: 1, minWidth: 0 },
  entryName: { minHeight: 44, paddingHorizontal: 10, borderRadius: 10, fontSize: 13, fontWeight: '700' },
  entryInput: { flex: 1, minWidth: 0, minHeight: 42, marginTop: 8, paddingHorizontal: 10, borderRadius: 10, fontSize: 12 },
  removeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff0f0' },
  removeText: { color: '#c94a4a', fontSize: 23, lineHeight: 25 },
  safeBottom: { height: 24 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,20,16,0.52)' },
  sheet: { maxHeight: '72%', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 22, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetTitle: { fontSize: 19, lineHeight: 26, fontWeight: '900', marginBottom: 12 },
  pickerList: { maxHeight: 430 },
  pickerRow: { minHeight: 52, paddingHorizontal: 4, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  pickerRowText: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
})
