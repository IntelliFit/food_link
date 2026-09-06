import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native'
import type { UserInfo } from '@food-link/core'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../providers/AuthProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { userFacingErrorMessage } from '../utils/errors'

const DEFAULT_SMS_COOLDOWN_SECONDS = 30
const DELETE_CONFIRMATION = '注销账号'

type FormTouched = {
  phone?: boolean
  currentPassword?: boolean
  newPassword?: boolean
  confirmPassword?: boolean
  verificationCode?: boolean
}

export function AccountSecurityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const { logout } = useAuth()
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const compact = width < 370

  const [profile, setProfile] = useState<UserInfo | null>(null)
  const [phone, setPhone] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationCodeSentTo, setVerificationCodeSentTo] = useState('')
  const [touched, setTouched] = useState<FormTouched>({})
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [codeSending, setCodeSending] = useState(false)
  const [codeCooldownSeconds, setCodeCooldownSeconds] = useState(0)
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const initialSnapshotRef = useRef('')
  const allowLeaveRef = useRef(false)
  const loadedRef = useRef(false)

  const normalizedPhone = normalizeMainlandPhone(phone)
  const profilePhone = normalizeMainlandPhone(profile?.telephone)
  const trimmedCurrentPassword = currentPassword.trim()
  const trimmedPassword = newPassword.trim()
  const trimmedConfirmPassword = confirmPassword.trim()
  const trimmedVerificationCode = verificationCode.trim()
  const phoneValid = /^1[3-9]\d{9}$/.test(normalizedPhone)
  const phoneChanged = normalizedPhone !== profilePhone
  const requiresPhoneVerification = phoneValid && phoneChanged
  const requiresCurrentPassword = Boolean(profile?.has_password)
  const passwordLongEnough = trimmedPassword.length >= 8
  const passwordMatched = Boolean(trimmedConfirmPassword) && trimmedPassword === trimmedConfirmPassword
  const verificationCodeValid = /^\d{6}$/.test(trimmedVerificationCode)

  const currentSnapshot = useMemo(() => JSON.stringify({
    phone: normalizedPhone,
    currentPassword,
    newPassword,
    confirmPassword,
    verificationCode,
  }), [confirmPassword, currentPassword, newPassword, normalizedPhone, verificationCode])
  const dirty = Boolean(initialSnapshotRef.current) && currentSnapshot !== initialSnapshotRef.current

  const phoneError = touched.phone && !phoneValid ? '请输入有效的 11 位大陆手机号' : ''
  const currentPasswordError = touched.currentPassword && requiresCurrentPassword && !trimmedCurrentPassword ? '请输入当前密码' : ''
  const newPasswordError = touched.newPassword && !passwordLongEnough ? '新密码至少需要 8 位' : ''
  const confirmPasswordError = touched.confirmPassword && !passwordMatched ? '两次输入的新密码不一致' : ''
  const verificationCodeError = touched.verificationCode && requiresPhoneVerification && !verificationCodeValid ? '请输入 6 位短信验证码' : ''
  const canSave = dirty
    && phoneValid
    && passwordLongEnough
    && passwordMatched
    && (!requiresCurrentPassword || Boolean(trimmedCurrentPassword))
    && (!requiresPhoneVerification || verificationCodeValid)
    && !saving
    && !codeSending

  useEffect(() => {
    navigation.setOptions({
      title: '账号安全',
      headerStyle: { backgroundColor: palette.surface },
      headerTintColor: palette.text,
      headerShadowVisible: false,
    })
  }, [navigation, palette.surface, palette.text])

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReduceMotion(enabled))
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    if (codeCooldownSeconds <= 0) return undefined
    const timer = setTimeout(() => setCodeCooldownSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [codeCooldownSeconds])

  const applyProfile = useCallback((nextProfile: UserInfo) => {
    const nextPhone = nextProfile.telephone || ''
    setProfile(nextProfile)
    setPhone(nextPhone)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setVerificationCode('')
    setVerificationCodeSentTo('')
    setTouched({})
    initialSnapshotRef.current = JSON.stringify({
      phone: normalizeMainlandPhone(nextPhone),
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
      verificationCode: '',
    })
  }, [])

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    setLoadError('')
    try {
      const nextProfile = await apiClient.getUserProfile()
      applyProfile(nextProfile)
      loadedRef.current = true
      setLoaded(true)
    } catch (error) {
      const message = userFacingErrorMessage(error, '账号信息加载失败')
      if (!loadedRef.current) setLoadError(message)
      else await dialog.alert('刷新失败', message, 'danger')
    } finally {
      setRefreshing(false)
    }
  }, [applyProfile, dialog])

  useFocusEffect(useCallback(() => {
    void load(false)
  }, [load]))

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowLeaveRef.current) return
    if (saving || deleting) {
      event.preventDefault()
      return
    }
    if (!dirty) return
    event.preventDefault()
    void dialog.confirm({
      title: '放弃账号设置？',
      message: '尚未保存的手机号或密码修改会丢失。',
      kind: 'warning',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
    }).then((confirmed) => {
      if (!confirmed) return
      allowLeaveRef.current = true
      navigation.dispatch(event.data.action)
    })
  }), [deleting, dialog, dirty, navigation, saving])

  const handlePhoneChange = useCallback((value: string) => {
    const nextPhone = normalizeMainlandPhone(value)
    if (nextPhone !== normalizedPhone) {
      setVerificationCode('')
      setVerificationCodeSentTo('')
    }
    setPhone(value.replace(/[^\d+\s()-]/g, '').slice(0, 18))
  }, [normalizedPhone])

  const sendVerificationCode = useCallback(async () => {
    setTouched((current) => ({ ...current, phone: true }))
    if (!phoneValid || codeSending || codeCooldownSeconds > 0) return
    setCodeSending(true)
    try {
      const result = await apiClient.sendSMSCode({ phone: normalizedPhone })
      const cooldown = normalizePositiveSeconds(result.cooldown_seconds ?? result.retry_after_seconds) || DEFAULT_SMS_COOLDOWN_SECONDS
      setCodeCooldownSeconds(cooldown)
      setVerificationCodeSentTo(normalizedPhone)
      AccessibilityInfo.announceForAccessibility(`验证码已发送至${maskPhone(normalizedPhone)}`)
    } catch (error) {
      await dialog.alert('验证码发送失败', userFacingErrorMessage(error, '请稍后再试'), 'warning')
    } finally {
      setCodeSending(false)
    }
  }, [codeCooldownSeconds, codeSending, dialog, normalizedPhone, phoneValid])

  const save = useCallback(async () => {
    setTouched({ phone: true, currentPassword: true, newPassword: true, confirmPassword: true, verificationCode: true })
    if (!canSave) return
    setSaving(true)
    try {
      await apiClient.setAccountPassword({
        phone: normalizedPhone,
        password: trimmedPassword,
        currentPassword: trimmedCurrentPassword,
        verificationCode: phoneChanged ? trimmedVerificationCode : undefined,
      })
      AccessibilityInfo.announceForAccessibility('手机号和密码已保存')
      await dialog.alert('已保存', '之后可以使用手机号和密码登录 APP。', 'success')
      await load(false)
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }, [canSave, dialog, load, normalizedPhone, phoneChanged, trimmedCurrentPassword, trimmedPassword, trimmedVerificationCode])

  const openDeleteDialog = useCallback(() => {
    setDeleteConfirmation('')
    setDeleteDialogVisible(true)
  }, [])

  const closeDeleteDialog = useCallback(() => {
    if (deleting) return
    setDeleteDialogVisible(false)
    setDeleteConfirmation('')
  }, [deleting])

  const deleteAccount = useCallback(async () => {
    if (deleting || deleteConfirmation.trim() !== DELETE_CONFIRMATION) return
    setDeleting(true)
    try {
      await apiClient.deleteAccount()
      await AsyncStorage.clear()
      await logout()
      allowLeaveRef.current = true
      setDeleteDialogVisible(false)
      AccessibilityInfo.announceForAccessibility('账号已注销')
      await dialog.alert('账号已注销', '本机登录状态和缓存已清除。', 'success')
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })
    } catch (error) {
      await dialog.alert('注销失败', userFacingErrorMessage(error, '请稍后重试'), 'danger')
    } finally {
      setDeleting(false)
    }
  }, [deleteConfirmation, deleting, dialog, logout, navigation])

  if (!loaded && !loadError) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={palette.brand} accessibilityLabel="正在读取账号安全信息" />
      </View>
    )
  }

  if (!loaded && loadError) {
    return (
      <View style={styles.centerState} accessibilityRole="alert">
        <View style={styles.errorIcon}><CircleAlert size={27} color={palette.danger} /></View>
        <Text style={styles.errorTitle}>账号信息加载失败</Text>
        <Text style={styles.errorMessage}>{loadError}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="重新加载账号信息" style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]} onPress={() => void load(false)}>
          <RotateCcw size={18} color="#ffffff" />
          <Text style={styles.retryText}>重新加载</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 106 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={palette.brand} colors={[palette.brand]} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><ShieldCheck size={25} color={palette.brandStrong} strokeWidth={2.3} /></View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>账号安全</Text>
            <Text style={styles.heroDescription}>手机号用于跨端登录、好友搜索与账号找回。</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.phoneRow}>
            <View style={styles.phoneCopy}>
              <Text style={styles.cardEyebrow}>手机号</Text>
              <Text style={styles.phoneValue}>{maskPhone(profile?.telephone) || '未绑定'}</Text>
            </View>
            <View style={[styles.statusBadge, profilePhone && styles.statusBadgeSuccess]}>
              <Text style={[styles.statusBadgeText, profilePhone && styles.statusBadgeTextSuccess]}>{profilePhone ? '已绑定' : '待绑定'}</Text>
            </View>
          </View>
          <Text style={styles.phoneNote}>{profilePhone ? '当前账号已绑定手机号，可继续设置 APP 密码登录。' : '绑定手机号时需要验证号码归属，完整号码不会公开。'}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.sectionTitle}>APP 备用登录</Text>
              <Text style={styles.sectionDescription}>微信之外，可使用手机号和密码登录</Text>
            </View>
            <View style={[styles.modeBadge, profile?.has_password && styles.modeBadgeEnabled]}>
              <Text style={[styles.modeBadgeText, profile?.has_password && styles.modeBadgeTextEnabled]}>{profile?.has_password ? '已启用' : '未启用'}</Text>
            </View>
          </View>

          <InfoRow icon={Smartphone} label="当前手机号" value={maskPhone(profile?.telephone) || '未绑定'} palette={palette} styles={styles} />
          <InfoRow icon={LockKeyhole} label="密码登录" value={profile?.has_password ? '已设置' : '未设置'} palette={palette} styles={styles} />
          {profile?.password_set_at ? <InfoRow icon={KeyRound} label="设置时间" value={formatDate(profile.password_set_at)} palette={palette} styles={styles} /> : null}

          <SecurityField
            label="手机号"
            accessibilityLabel="备用登录手机号"
            value={phone}
            onChangeText={handlePhoneChange}
            onBlur={() => setTouched((current) => ({ ...current, phone: true }))}
            placeholder="请输入 11 位手机号"
            keyboardType="phone-pad"
            error={phoneError}
            palette={palette}
            styles={styles}
          />
          <Text style={styles.formHint}>
            {!normalizedPhone
              ? '填写 11 位手机号后，将通过短信验证号码归属。'
              : phoneChanged
                ? '首次绑定或更换手机号，需要短信验证。'
                : '手机号未改变，本次无需短信验证。'}
          </Text>

          {requiresPhoneVerification ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>短信验证码</Text>
              <View style={[styles.verificationRow, compact && styles.verificationRowCompact]}>
                <TextInput
                  accessibilityLabel="短信验证码"
                  accessibilityHint="请输入 6 位数字验证码"
                  value={verificationCode}
                  onChangeText={(value) => setVerificationCode(value.replace(/\D/g, '').slice(0, 6))}
                  onBlur={() => setTouched((current) => ({ ...current, verificationCode: true }))}
                  editable={!saving}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="6 位验证码"
                  placeholderTextColor={palette.textMuted}
                  style={[styles.input, styles.verificationInput, verificationCodeError && styles.inputError]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={codeCooldownSeconds > 0 ? `${codeCooldownSeconds}秒后可重新发送验证码` : '发送短信验证码'}
                  accessibilityState={{ disabled: codeSending || codeCooldownSeconds > 0 || !phoneValid, busy: codeSending }}
                  disabled={codeSending || codeCooldownSeconds > 0 || !phoneValid}
                  style={({ pressed }) => [styles.sendCodeButton, (codeSending || codeCooldownSeconds > 0 || !phoneValid) && styles.secondaryButtonDisabled, pressed && styles.pressed]}
                  onPress={() => void sendVerificationCode()}
                >
                  {codeSending ? <ActivityIndicator size="small" color={palette.brandStrong} /> : <Text style={styles.sendCodeText}>{codeCooldownSeconds > 0 ? `${codeCooldownSeconds}s 后重发` : '发送验证码'}</Text>}
                </Pressable>
              </View>
              {verificationCodeError ? <Text style={styles.inlineError} accessibilityLiveRegion="polite">{verificationCodeError}</Text> : null}
              {verificationCodeSentTo === normalizedPhone ? <Text style={styles.formHint}>验证码已发送至 {maskPhone(normalizedPhone)}，15 分钟内有效。</Text> : null}
            </View>
          ) : null}

          {requiresCurrentPassword ? (
            <SecurityField
              label="当前密码"
              accessibilityLabel="当前密码"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              onBlur={() => setTouched((current) => ({ ...current, currentPassword: true }))}
              placeholder="修改密码前先验证当前密码"
              secureTextEntry
              error={currentPasswordError}
              palette={palette}
              styles={styles}
            />
          ) : null}

          <SecurityField
            label="新密码"
            accessibilityLabel="新密码"
            value={newPassword}
            onChangeText={setNewPassword}
            onBlur={() => setTouched((current) => ({ ...current, newPassword: true }))}
            placeholder="至少 8 位"
            secureTextEntry
            error={newPasswordError}
            palette={palette}
            styles={styles}
          />
          <SecurityField
            label="确认新密码"
            accessibilityLabel="确认新密码"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onBlur={() => setTouched((current) => ({ ...current, confirmPassword: true }))}
            placeholder="再次输入新密码"
            secureTextEntry
            error={confirmPasswordError}
            palette={palette}
            styles={styles}
          />
          <View style={styles.passwordStatusRow}>
            <StatusPill label="至少 8 位" active={passwordLongEnough} palette={palette} styles={styles} />
            <StatusPill label="两次一致" active={passwordMatched} palette={palette} styles={styles} />
          </View>
        </View>

        <View style={styles.dangerCard}>
          <View style={styles.dangerHeading}>
            <View style={styles.dangerIcon}><AlertTriangle size={20} color={palette.danger} strokeWidth={2.3} /></View>
            <View style={styles.dangerCopy}>
              <Text style={styles.dangerTitle}>注销账号</Text>
              <Text style={styles.dangerDescription}>注销后将永久删除你的健康档案、记录和账户资料，且无法恢复。</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="注销账号" style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]} onPress={openDeleteDialog}>
            <Trash2 size={18} color={palette.danger} strokeWidth={2.3} />
            <Text style={styles.deleteButtonText}>注销账号</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.submitBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="保存手机号和密码"
          accessibilityState={{ disabled: !canSave, busy: saving }}
          disabled={!canSave}
          style={({ pressed }) => [styles.submitButton, !canSave && styles.submitButtonDisabled, pressed && canSave && styles.submitButtonPressed]}
          onPress={() => void save()}
        >
          {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Save size={19} color="#ffffff" strokeWidth={2.4} />}
          <Text style={styles.submitButtonText}>{saving ? '正在保存' : dirty ? '保存手机号和密码' : '尚未修改'}</Text>
        </Pressable>
      </View>

      <DeleteAccountModal
        visible={deleteDialogVisible}
        value={deleteConfirmation}
        deleting={deleting}
        reduceMotion={reduceMotion}
        insetsBottom={insets.bottom}
        palette={palette}
        styles={styles}
        onChange={setDeleteConfirmation}
        onClose={closeDeleteDialog}
        onConfirm={() => void deleteAccount()}
      />
    </View>
  )
}

function SecurityField({ label, accessibilityLabel, value, onChangeText, onBlur, placeholder, secureTextEntry, keyboardType, error, palette, styles }: {
  label: string
  accessibilityLabel: string
  value: string
  onChangeText: (value: string) => void
  onBlur: () => void
  placeholder: string
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'phone-pad'
  error: string
  palette: Palette
  styles: ReturnType<typeof createStyles>
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={error || undefined}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, error && styles.inputError]}
      />
      {error ? <Text style={styles.inlineError} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  )
}

function InfoRow({ icon: Icon, label, value, palette, styles }: {
  icon: LucideIcon
  label: string
  value: string
  palette: Palette
  styles: ReturnType<typeof createStyles>
}) {
  return (
    <View style={styles.infoRow} accessibilityLabel={`${label}：${value}`}>
      <View style={styles.infoMain}>
        <View style={styles.infoIcon}><Icon size={17} color={palette.brandStrong} strokeWidth={2.2} /></View>
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function StatusPill({ label, active, palette, styles }: {
  label: string
  active: boolean
  palette: Palette
  styles: ReturnType<typeof createStyles>
}) {
  return (
    <View style={[styles.statusPill, active && styles.statusPillActive]} accessibilityLabel={`${label}，${active ? '已满足' : '未满足'}`}>
      {active ? <CheckCircle2 size={13} color={palette.brandStrong} strokeWidth={2.4} /> : null}
      <Text style={[styles.statusPillText, active && styles.statusPillTextActive]}>{label}</Text>
    </View>
  )
}

function DeleteAccountModal({ visible, value, deleting, reduceMotion, insetsBottom, palette, styles, onChange, onClose, onConfirm }: {
  visible: boolean
  value: string
  deleting: boolean
  reduceMotion: boolean
  insetsBottom: number
  palette: Palette
  styles: ReturnType<typeof createStyles>
  onChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const valid = value.trim() === DELETE_CONFIRMATION
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.modalDismiss} accessibilityRole="button" accessibilityLabel="关闭注销确认" onPress={onClose} />
        <KeyboardAvoidingView style={styles.modalCenter} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
          <View style={[styles.modalCard, { marginBottom: Math.max(insetsBottom, 16) }]} accessibilityViewIsModal>
            <View style={styles.modalDangerIcon}><Trash2 size={22} color={palette.danger} strokeWidth={2.3} /></View>
            <Text style={styles.modalTitle}>确认注销账号</Text>
            <Text style={styles.modalDescription}>这是不可恢复的操作。请输入“注销账号”后继续。</Text>
            <Text style={styles.modalLabel}>确认文案</Text>
            <TextInput
              accessibilityLabel="注销账号确认文案"
              accessibilityHint="请输入注销账号四个字"
              value={value}
              onChangeText={(text) => onChange(text.slice(0, 8))}
              editable={!deleting}
              autoFocus
              maxLength={8}
              placeholder="注销账号"
              placeholderTextColor={palette.textMuted}
              style={[styles.modalInput, value.length > 0 && !valid && styles.inputError]}
            />
            {value.length > 0 && !valid ? <Text style={styles.inlineError} accessibilityLiveRegion="polite">请输入完整的“注销账号”</Text> : null}
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="取消注销" disabled={deleting} style={({ pressed }) => [styles.modalCancel, deleting && styles.secondaryButtonDisabled, pressed && styles.pressed]} onPress={onClose}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="确认注销账号"
                accessibilityState={{ disabled: !valid || deleting, busy: deleting }}
                disabled={!valid || deleting}
                style={({ pressed }) => [styles.modalConfirm, (!valid || deleting) && styles.modalConfirmDisabled, pressed && valid && !deleting && styles.pressed]}
                onPress={onConfirm}
              >
                {deleting ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.modalConfirmText}>确认注销</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

function normalizeMainlandPhone(value?: string | null): string {
  let phone = String(value || '').trim().replace(/[\s-()]/g, '')
  if (phone.startsWith('+')) phone = phone.slice(1)
  if (phone.startsWith('86') && phone.length === 13) phone = phone.slice(2)
  return phone
}

function maskPhone(value?: string | null): string {
  const phone = normalizeMainlandPhone(value)
  if (!/^1[3-9]\d{9}$/.test(phone)) return ''
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function normalizePositiveSeconds(value: unknown): number {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.max(1, Math.ceil(seconds))
}

type Palette = typeof lightPalette

const lightPalette = {
  page: '#f8faf9',
  surface: '#ffffff',
  surfaceMuted: '#f2f6f4',
  border: '#dbe6e1',
  text: '#15231d',
  textSecondary: '#52655d',
  textMuted: '#788a82',
  brand: '#00ad73',
  brandStrong: '#087653',
  brandSoft: '#e7f8f1',
  warning: '#c56b16',
  warningSoft: '#fff7ed',
  danger: '#c24136',
  dangerStrong: '#a6352d',
  dangerSoft: '#fff1ee',
  disabled: '#cbd5d1',
  scrim: 'rgba(8, 18, 14, 0.58)',
}

const darkPalette: Palette = {
  page: '#101716',
  surface: '#1a2220',
  surfaceMuted: '#222c29',
  border: '#354940',
  text: '#eef5f1',
  textSecondary: '#c0cec7',
  textMuted: '#91a29a',
  brand: '#21bd84',
  brandStrong: '#7ce0b7',
  brandSoft: '#17372d',
  warning: '#f0a254',
  warningSoft: '#3b2a1c',
  danger: '#fb7c72',
  dangerStrong: '#ff9d96',
  dangerSoft: '#43211f',
  disabled: '#46564f',
  scrim: 'rgba(0, 0, 0, 0.68)',
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.page },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 16, paddingTop: 16 },
    centerState: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.page },
    errorIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.dangerSoft },
    errorTitle: { marginTop: 14, color: palette.text, fontSize: 18, lineHeight: 25, fontWeight: '800' },
    errorMessage: { marginTop: 7, color: palette.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    retryButton: { minWidth: 144, minHeight: 48, marginTop: 20, paddingHorizontal: 20, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.brand },
    retryText: { color: '#ffffff', fontSize: 14, lineHeight: 20, fontWeight: '800' },
    hero: { minHeight: 112, padding: 17, borderRadius: 20, borderWidth: 1, borderColor: palette.border, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: palette.brandSoft },
    heroIcon: { width: 50, height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
    heroCopy: { flex: 1, minWidth: 0 },
    heroTitle: { color: palette.text, fontSize: 20, lineHeight: 27, fontWeight: '900' },
    heroDescription: { marginTop: 4, color: palette.textSecondary, fontSize: 13, lineHeight: 20 },
    card: { marginTop: 14, padding: 16, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, backgroundColor: palette.surface },
    phoneRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    phoneCopy: { flex: 1, minWidth: 0 },
    cardEyebrow: { color: palette.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '700' },
    phoneValue: { marginTop: 4, color: palette.text, fontSize: 20, lineHeight: 27, fontWeight: '900', fontVariant: ['tabular-nums'] },
    statusBadge: { minHeight: 32, minWidth: 76, paddingHorizontal: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.warningSoft },
    statusBadgeSuccess: { backgroundColor: palette.brandSoft },
    statusBadgeText: { color: palette.warning, fontSize: 12, lineHeight: 17, fontWeight: '800' },
    statusBadgeTextSuccess: { color: palette.brandStrong },
    phoneNote: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, color: palette.textSecondary, fontSize: 13, lineHeight: 20 },
    sectionHeader: { minHeight: 58, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    sectionHeaderCopy: { flex: 1, minWidth: 0 },
    sectionTitle: { color: palette.text, fontSize: 16, lineHeight: 23, fontWeight: '900' },
    sectionDescription: { marginTop: 3, color: palette.textMuted, fontSize: 12, lineHeight: 18 },
    modeBadge: { minHeight: 30, paddingHorizontal: 10, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    modeBadgeEnabled: { backgroundColor: palette.brandSoft },
    modeBadgeText: { color: palette.textMuted, fontSize: 11, lineHeight: 16, fontWeight: '800' },
    modeBadgeTextEnabled: { color: palette.brandStrong },
    infoRow: { minHeight: 50, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    infoMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
    infoIcon: { width: 34, height: 34, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    infoLabel: { color: palette.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    infoValue: { flexShrink: 1, color: palette.text, textAlign: 'right', fontSize: 13, lineHeight: 19, fontWeight: '800' },
    field: { marginTop: 14 },
    fieldLabel: { marginBottom: 7, color: palette.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '800' },
    input: { minHeight: 52, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: palette.border, borderRadius: 14, color: palette.text, backgroundColor: palette.surfaceMuted, fontSize: 15, lineHeight: 21 },
    inputError: { borderColor: palette.danger },
    inlineError: { marginTop: 6, color: palette.danger, fontSize: 12, lineHeight: 18 },
    formHint: { marginTop: 7, color: palette.textMuted, fontSize: 12, lineHeight: 18 },
    verificationRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    verificationRowCompact: { flexDirection: 'column', alignItems: 'stretch' },
    verificationInput: { flex: 1 },
    sendCodeButton: { minWidth: 122, minHeight: 52, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    secondaryButtonDisabled: { opacity: 0.5 },
    sendCodeText: { color: palette.brandStrong, fontSize: 13, lineHeight: 19, fontWeight: '900' },
    passwordStatusRow: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statusPill: { minHeight: 32, paddingHorizontal: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.surfaceMuted },
    statusPillActive: { backgroundColor: palette.brandSoft },
    statusPillText: { color: palette.textMuted, fontSize: 11, lineHeight: 16, fontWeight: '800' },
    statusPillTextActive: { color: palette.brandStrong },
    dangerCard: { marginTop: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: palette.danger, backgroundColor: palette.dangerSoft },
    dangerHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
    dangerIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
    dangerCopy: { flex: 1, minWidth: 0 },
    dangerTitle: { color: palette.dangerStrong, fontSize: 15, lineHeight: 21, fontWeight: '900' },
    dangerDescription: { marginTop: 4, color: palette.textSecondary, fontSize: 12, lineHeight: 19 },
    deleteButton: { minHeight: 50, marginTop: 14, borderRadius: 16, borderWidth: 1, borderColor: palette.danger, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.surface },
    deleteButtonText: { color: palette.dangerStrong, fontSize: 14, lineHeight: 20, fontWeight: '900' },
    submitBar: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, backgroundColor: palette.surface },
    submitButton: { minHeight: 54, borderRadius: 27, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.brand },
    submitButtonDisabled: { backgroundColor: palette.disabled },
    submitButtonPressed: { opacity: 0.82 },
    submitButtonText: { color: '#ffffff', fontSize: 15, lineHeight: 21, fontWeight: '900' },
    modalBackdrop: { flex: 1, backgroundColor: palette.scrim },
    modalDismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    modalCenter: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
    modalCard: { padding: 20, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, backgroundColor: palette.surface },
    modalDangerIcon: { alignSelf: 'center', width: 50, height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.dangerSoft },
    modalTitle: { marginTop: 12, color: palette.text, textAlign: 'center', fontSize: 19, lineHeight: 26, fontWeight: '900' },
    modalDescription: { marginTop: 7, color: palette.textSecondary, textAlign: 'center', fontSize: 13, lineHeight: 20 },
    modalLabel: { marginTop: 18, color: palette.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '800' },
    modalInput: { minHeight: 52, marginTop: 7, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: palette.border, borderRadius: 14, color: palette.text, backgroundColor: palette.surfaceMuted, fontSize: 15, lineHeight: 21 },
    modalActions: { marginTop: 18, flexDirection: 'row', gap: 10 },
    modalCancel: { flex: 1, minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    modalCancelText: { color: palette.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' },
    modalConfirm: { flex: 1, minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.danger },
    modalConfirmDisabled: { opacity: 0.42 },
    modalConfirmText: { color: '#ffffff', fontSize: 14, lineHeight: 20, fontWeight: '900' },
    pressed: { opacity: 0.72 },
  })
}
