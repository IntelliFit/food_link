import type { AnalyzeVideoUploadResult } from '@food-link/core'
import type { ImagePickerAsset } from 'expo-image-picker'
import { useVideoPlayer, VideoView } from 'expo-video'
import { Camera, Film, Image as ImageIcon, RefreshCcw, Trash2 } from 'lucide-react-native'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useColorScheme } from '../providers/ColorSchemeProvider'

type PrecisionVideoTheme = {
  surface: string
  surfaceMuted: string
  surfaceStrong: string
  text: string
  secondary: string
  muted: string
  border: string
  accent: string
  accentText: string
  accentSoft: string
  accentTrack: string
  accentBorder: string
  danger: string
  dangerSurface: string
  dangerBorder: string
  inverseText: string
  videoSurface: string
  frameOverlay: string
}

const LIGHT_PRECISION_VIDEO_THEME: PrecisionVideoTheme = {
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  surfaceStrong: '#e2e8f0',
  text: '#0f172a',
  secondary: '#64748b',
  muted: '#94a3b8',
  border: '#dbe4e0',
  accent: '#00bc7d',
  accentText: '#047857',
  accentSoft: '#ecfdf5',
  accentTrack: '#d1fae5',
  accentBorder: 'rgba(0,188,125,0.28)',
  danger: '#b91c1c',
  dangerSurface: '#fff7f7',
  dangerBorder: '#fecaca',
  inverseText: '#ffffff',
  videoSurface: '#0f172a',
  frameOverlay: 'rgba(15,23,42,0.68)',
}

const DARK_PRECISION_VIDEO_THEME: PrecisionVideoTheme = {
  surface: '#1e2624',
  surfaceMuted: '#27322f',
  surfaceStrong: '#2d3634',
  text: '#f2f7f4',
  secondary: 'rgba(214,226,220,0.76)',
  muted: 'rgba(214,226,220,0.52)',
  border: 'rgba(214,226,220,0.16)',
  accent: '#4a9d7d',
  accentText: '#7dd3b0',
  accentSoft: '#18332a',
  accentTrack: '#2f5144',
  accentBorder: '#3d5d51',
  danger: '#fca5a5',
  dangerSurface: 'rgba(127,29,29,0.28)',
  dangerBorder: 'rgba(248,113,113,0.52)',
  inverseText: '#ffffff',
  videoSurface: '#0f172a',
  frameOverlay: 'rgba(2,6,23,0.72)',
}

export type PrecisionVideoProcessStage = 'idle' | 'compressing' | 'uploading'

type Props = {
  selectedVideo: ImagePickerAsset | null
  uploadResult: AnalyzeVideoUploadResult | null
  processStage: PrecisionVideoProcessStage
  progress: number
  onPickCamera: () => void
  onPickLibrary: () => void
  onRetry: () => void
  onClear: () => void
  onPreviewFrame: (uri: string) => void
}

export function PrecisionVideoCapture({
  selectedVideo,
  uploadResult,
  processStage,
  progress,
  onPickCamera,
  onPickLibrary,
  onRetry,
  onClear,
  onPreviewFrame,
}: Props) {
  const { styles, theme } = usePrecisionVideoUi()
  const busy = processStage !== 'idle'
  return (
    <View style={styles.capture}>
      <View style={styles.header}>
        <View style={styles.headerIcon}><Film size={18} color={theme.accentText} strokeWidth={2.3} /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>环绕短视频</Text>
          <Text style={styles.subtitle}>自然扫过每种食物，尽量包含一帧全景和一帧侧面</Text>
        </View>
      </View>

      {selectedVideo ? (
        <View style={styles.previewCard}>
          <LocalVideoPreview uri={selectedVideo.uri} />
          <View style={styles.actions}>
            <ActionButton icon={Camera} label="重新录制" disabled={busy} onPress={onPickCamera} />
            <ActionButton icon={ImageIcon} label="替换视频" disabled={busy} onPress={onPickLibrary} />
            <ActionButton icon={Trash2} label="移除" danger disabled={busy} onPress={onClear} />
          </View>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}><Camera size={29} color={theme.muted} strokeWidth={1.8} /></View>
          <Text style={styles.emptyTitle}>录制食物短视频</Text>
          <Text style={styles.emptyHint}>建议 4–8 秒，至少 2 秒；最长 12 秒、上传最大 8MB</Text>
          <View style={styles.actions}>
            <ActionButton icon={Camera} label="录制" onPress={onPickCamera} />
            <ActionButton icon={ImageIcon} label="从相册选择" onPress={onPickLibrary} />
          </View>
        </View>
      )}

      {busy ? (
        <View accessibilityRole="progressbar" accessibilityLabel="视频处理进度" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <ActivityIndicator size="small" color={theme.accent} />
            <Text accessibilityLiveRegion="polite" style={styles.progressText}>
              {processStage === 'compressing' ? '压缩' : '上传与提取关键帧'} {progress}%
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${Math.max(2, Math.min(100, progress))}%` }]} />
          </View>
        </View>
      ) : null}

      {!busy && selectedVideo && !uploadResult ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新处理视频"
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          onPress={onRetry}
        >
          <RefreshCcw size={16} color={theme.accentText} strokeWidth={2.4} />
          <Text style={styles.retryText}>重新处理视频</Text>
        </Pressable>
      ) : null}

      {uploadResult ? (
        <View style={styles.framesCard}>
          <View style={styles.framesHeader}>
            <Text style={styles.framesTitle}>已提取 {uploadResult.keyframes.length} 个关键帧</Text>
            <Text style={styles.framesMeta}>{(uploadResult.duration_ms / 1000).toFixed(1)} 秒</Text>
          </View>
          <View style={styles.framesGrid}>
            {uploadResult.keyframes.map((frame, index) => (
              <Pressable
                key={frame.role}
                accessibilityRole="imagebutton"
                accessibilityLabel={`查看第 ${index + 1} 个关键帧，${((frame.timestamp_ms || 0) / 1000).toFixed(1)} 秒`}
                style={({ pressed }) => [styles.frame, pressed && styles.pressed]}
                onPress={() => onPreviewFrame(frame.image_url)}
              >
                <Image source={{ uri: frame.image_url }} style={styles.frameImage} />
                <Text style={styles.frameLabel}>{index + 1} · {((frame.timestamp_ms || 0) / 1000).toFixed(1)}s</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>系统会综合关键帧判断高度、遮挡和尺度；原视频处理后即删除。</Text>
        </View>
      ) : null}
    </View>
  )
}

function LocalVideoPreview({ uri }: { uri: string }) {
  const { styles } = usePrecisionVideoUi()
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false
  })
  return (
    <VideoView
      accessibilityLabel="已选择的食物短视频"
      player={player}
      nativeControls
      contentFit="cover"
      surfaceType="textureView"
      style={styles.video}
    />
  )
}

function ActionButton({ icon: Icon, label, danger, disabled, onPress }: {
  icon: typeof Camera
  label: string
  danger?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const { styles, theme } = usePrecisionVideoUi()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={({ pressed }) => [styles.action, danger && styles.actionDanger, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
      onPress={onPress}
    >
      <Icon size={15} color={danger ? theme.danger : theme.accentText} strokeWidth={2.4} />
      <Text style={[styles.actionText, danger && styles.actionTextDanger]}>{label}</Text>
    </Pressable>
  )
}

function createPrecisionVideoStyles(theme: PrecisionVideoTheme) {
  return StyleSheet.create({
  capture: { padding: 10, gap: 10 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9 },
  headerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accentSoft },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: theme.text, fontSize: 15, lineHeight: 21, fontWeight: '900' },
  subtitle: { marginTop: 2, color: theme.secondary, fontSize: 11, lineHeight: 16 },
  previewCard: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceMuted },
  video: { width: '100%', height: 210, backgroundColor: theme.videoSurface },
  emptyCard: { minHeight: 190, padding: 16, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceMuted },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceStrong },
  emptyTitle: { marginTop: 9, color: theme.secondary, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  emptyHint: { marginTop: 4, maxWidth: 285, textAlign: 'center', color: theme.secondary, fontSize: 11, lineHeight: 17 },
  actions: { padding: 8, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  action: { minHeight: 48, minWidth: 94, paddingHorizontal: 12, borderRadius: 24, borderWidth: 1, borderColor: theme.accentBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: theme.surface },
  actionDanger: { borderColor: theme.dangerBorder, backgroundColor: theme.dangerSurface },
  actionText: { color: theme.accentText, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  actionTextDanger: { color: theme.danger },
  progressCard: { padding: 10, borderRadius: 10, backgroundColor: theme.accentSoft },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressText: { color: theme.accentText, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  progressTrack: { height: 6, marginTop: 8, borderRadius: 3, overflow: 'hidden', backgroundColor: theme.accentTrack },
  progressBar: { height: '100%', borderRadius: 3, backgroundColor: theme.accent },
  retryButton: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: theme.accentBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: theme.accentSoft },
  retryText: { color: theme.accentText, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  framesCard: { padding: 10, borderRadius: 12, backgroundColor: theme.surfaceMuted },
  framesHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  framesTitle: { color: theme.text, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  framesMeta: { color: theme.secondary, fontSize: 11, lineHeight: 16 },
  framesGrid: { marginTop: 7, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  frame: { width: '31.7%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.surfaceStrong },
  frameImage: { width: '100%', height: '100%' },
  frameLabel: { position: 'absolute', left: 4, right: 4, bottom: 4, paddingVertical: 2, borderRadius: 5, overflow: 'hidden', textAlign: 'center', color: theme.inverseText, backgroundColor: theme.frameOverlay, fontSize: 9, lineHeight: 13, fontWeight: '800' },
  note: { marginTop: 8, color: theme.secondary, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  disabled: { opacity: 0.52 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  })
}

const LIGHT_PRECISION_VIDEO_STYLES = createPrecisionVideoStyles(LIGHT_PRECISION_VIDEO_THEME)
const DARK_PRECISION_VIDEO_STYLES = createPrecisionVideoStyles(DARK_PRECISION_VIDEO_THEME)

function usePrecisionVideoUi() {
  const { isDark } = useColorScheme()
  return isDark
    ? { theme: DARK_PRECISION_VIDEO_THEME, styles: DARK_PRECISION_VIDEO_STYLES }
    : { theme: LIGHT_PRECISION_VIDEO_THEME, styles: LIGHT_PRECISION_VIDEO_STYLES }
}
