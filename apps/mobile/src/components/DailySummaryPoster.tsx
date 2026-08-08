import { forwardRef, useMemo } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import qrcode from 'qrcode-generator'

const appIcon = require('../../assets/icon.png')

export interface DailySummaryPosterMacro {
  current: number
  target: number
}

export interface DailySummaryPosterData {
  date: string
  intakeCurrent: number
  intakeTarget: number
  macros: {
    protein: DailySummaryPosterMacro
    carbs: DailySummaryPosterMacro
    fat: DailySummaryPosterMacro
  }
  waterCurrentMl: number
  waterGoalMl: number
  exerciseKcal: number
  streakDays: number
  greenDays: number
  nickname?: string
  avatar?: string
  qrValue?: string
}

export const DailySummaryPoster = forwardRef<View, { data: DailySummaryPosterData }>(function DailySummaryPoster({ data }, ref) {
  const dateInfo = formatPosterDate(data.date)
  return (
    <View ref={ref} collapsable={false} style={styles.poster}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>FOOD LINK · 今日卡片</Text>
          <Text style={styles.date}>{dateInfo.date}</Text>
          <Text style={styles.weekday}>{dateInfo.weekday}</Text>
        </View>
        <Image source={appIcon} style={styles.logo} resizeMode="contain" />
      </View>

      <View style={styles.intakeCard}>
        <Text style={styles.sectionLabel}>今日摄入</Text>
        <View style={styles.intakeValueRow}>
          <Text style={styles.intakeValue}>{formatNumber(data.intakeCurrent)}</Text>
          <Text style={styles.intakeUnit}>{data.intakeTarget > 0 ? ` / ${formatNumber(data.intakeTarget)} kcal` : ' kcal'}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent(data.intakeCurrent, data.intakeTarget)}%` }]} />
        </View>
      </View>

      <View style={styles.macroRow}>
        <PosterMacroCard label="蛋白质" color="#67b7e1" value={data.macros.protein} />
        <PosterMacroCard label="碳水" color="#e2b85d" value={data.macros.carbs} />
        <PosterMacroCard label="脂肪" color="#ed9668" value={data.macros.fat} />
      </View>

      <View style={styles.statusRow}>
        <PosterStatusCard label="饮水" value={data.waterGoalMl > 0 ? `${formatNumber(data.waterCurrentMl)} / ${formatNumber(data.waterGoalMl)} ml` : `${formatNumber(data.waterCurrentMl)} ml`} />
        <PosterStatusCard label="运动消耗" value={`${formatNumber(data.exerciseKcal)} kcal`} />
      </View>

      <View style={styles.achievementCard}>
        <View style={styles.achievementCopy}>
          <Text style={styles.achievementTitle}>坚持正在发生</Text>
          <Text style={styles.achievementHint}>成就数据来自服务端当日仪表盘</Text>
        </View>
        <View style={styles.achievementItem}>
          <Text style={styles.achievementValue}>{Math.max(0, Math.floor(data.streakDays))}</Text>
          <Text style={styles.achievementLabel}>连续记录</Text>
        </View>
        <View style={styles.achievementDivider} />
        <View style={styles.achievementItem}>
          <Text style={styles.achievementValue}>{Math.max(0, Math.floor(data.greenDays))}</Text>
          <Text style={styles.achievementLabel}>全绿天数</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <PosterIdentity nickname={data.nickname} avatar={data.avatar} />
        <View style={styles.footerCopy}>
          <Text style={styles.footerTitle} numberOfLines={1}>{data.nickname ? `${data.nickname} 的健康日记` : '智健食探健康日记'}</Text>
          <Text style={styles.footerHint}>{data.qrValue ? '扫码加入食探，一起记录每一餐' : '记录每一天，看见健康变化'}</Text>
        </View>
        <DailyPosterQrCode value={data.qrValue || ''} />
      </View>
    </View>
  )
})

function PosterMacroCard({ label, color, value }: { label: string; color: string; value: DailySummaryPosterMacro }) {
  return (
    <View style={styles.macroCard}>
      <View style={[styles.macroDot, { backgroundColor: color }]} />
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValue}>{formatNumber(value.current)}g</Text>
      <Text style={styles.macroTarget}>{value.target > 0 ? `目标 ${formatNumber(value.target)}g` : '目标 --'}</Text>
    </View>
  )
}

function PosterStatusCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusCard}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  )
}

function PosterIdentity({ nickname, avatar }: { nickname?: string; avatar?: string }) {
  if (avatar) return <Image source={{ uri: avatar }} style={styles.avatar} resizeMode="cover" />
  if (nickname) {
    return (
      <View style={styles.avatarFallback}>
        <Text style={styles.avatarFallbackText}>{nickname.slice(0, 1)}</Text>
      </View>
    )
  }
  return <Image source={appIcon} style={styles.avatar} resizeMode="contain" />
}

function DailyPosterQrCode({ value }: { value: string }) {
  const matrix = useMemo(() => {
    if (!value.trim()) return []
    const qr = qrcode(0, 'M')
    qr.addData(value.trim())
    qr.make()
    const size = qr.getModuleCount()
    return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)))
  }, [value])

  if (matrix.length === 0) {
    return (
      <View style={[styles.qrOuter, styles.qrFallback]}>
        <Image source={appIcon} style={styles.qrFallbackLogo} resizeMode="contain" />
      </View>
    )
  }

  return (
    <View style={styles.qrOuter}>
      <View style={styles.qrMatrix}>
        {matrix.map((row, rowIndex) => (
          <View key={`daily-poster-qr-row-${rowIndex}`} style={styles.qrRow}>
            {row.map((dark, colIndex) => (
              <View key={`daily-poster-qr-cell-${rowIndex}-${colIndex}`} style={[styles.qrCell, dark ? styles.qrCellDark : styles.qrCellLight]} />
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

function progressPercent(current: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0
  return Math.max(0, Math.min(100, (Math.max(0, current) / target) * 100))
}

function formatNumber(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0
  const rounded = Math.round(normalized * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function formatPosterDate(dateKey: string): { date: string; weekday: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return { date: dateKey, weekday: '' }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return { date: `${match[1]}年${Number(match[2])}月${Number(match[3])}日`, weekday: weekdays[date.getDay()] || '' }
}

const styles = StyleSheet.create({
  poster: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    borderRadius: 28,
    overflow: 'hidden',
    padding: 20,
    backgroundColor: '#f5fbf8',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: '#6b8d80',
    fontSize: 9,
    letterSpacing: 1.4,
    fontWeight: '900',
  },
  date: {
    marginTop: 7,
    color: '#183b31',
    fontSize: 22,
    fontWeight: '900',
  },
  weekday: {
    marginTop: 3,
    color: '#7a948b',
    fontSize: 11,
    fontWeight: '700',
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 13,
  },
  intakeCard: {
    marginTop: 18,
    borderRadius: 22,
    padding: 17,
    backgroundColor: '#153d32',
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    fontWeight: '800',
  },
  intakeValueRow: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  intakeValue: {
    color: '#ffffff',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
  },
  intakeUnit: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    marginTop: 12,
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  progressFill: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#70d0aa',
  },
  macroRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  macroCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 17,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  macroDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  macroLabel: {
    marginTop: 7,
    color: '#71877f',
    fontSize: 9,
    fontWeight: '800',
  },
  macroValue: {
    marginTop: 3,
    color: '#183b31',
    fontSize: 15,
    fontWeight: '900',
  },
  macroTarget: {
    marginTop: 2,
    color: '#9aaba5',
    fontSize: 8,
  },
  statusRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  statusCard: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#e8f5ef',
  },
  statusLabel: {
    color: '#6f8b81',
    fontSize: 9,
    fontWeight: '800',
  },
  statusValue: {
    marginTop: 4,
    color: '#183b31',
    fontSize: 12,
    fontWeight: '900',
  },
  achievementCard: {
    marginTop: 12,
    borderRadius: 19,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  achievementCopy: {
    flex: 1,
    minWidth: 0,
  },
  achievementTitle: {
    color: '#183b31',
    fontSize: 12,
    fontWeight: '900',
  },
  achievementHint: {
    marginTop: 3,
    color: '#95a69f',
    fontSize: 7,
  },
  achievementItem: {
    width: 52,
    alignItems: 'center',
  },
  achievementValue: {
    color: '#2d8063',
    fontSize: 20,
    fontWeight: '900',
  },
  achievementLabel: {
    marginTop: 1,
    color: '#7c9189',
    fontSize: 7,
    fontWeight: '700',
  },
  achievementDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#e3ece8',
  },
  footer: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff',
  },
  avatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dff2e9',
  },
  avatarFallbackText: {
    color: '#2d8063',
    fontSize: 13,
    fontWeight: '900',
  },
  footerCopy: {
    flex: 1,
    minWidth: 0,
  },
  footerTitle: {
    color: '#27493f',
    fontSize: 10,
    fontWeight: '900',
  },
  footerHint: {
    marginTop: 2,
    color: '#8ca098',
    fontSize: 7,
  },
  qrOuter: {
    width: 60,
    height: 60,
    borderRadius: 9,
    padding: 5,
    backgroundColor: '#ffffff',
  },
  qrMatrix: {
    flex: 1,
  },
  qrRow: {
    flex: 1,
    flexDirection: 'row',
  },
  qrCell: {
    flex: 1,
    aspectRatio: 1,
  },
  qrCellDark: {
    backgroundColor: '#132f27',
  },
  qrCellLight: {
    backgroundColor: '#ffffff',
  },
  qrFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrFallbackLogo: {
    width: 32,
    height: 32,
  },
})
