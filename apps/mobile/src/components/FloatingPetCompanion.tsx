import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PetSummary } from '@food-link/core'
import { ChevronLeft, ChevronRight, Gift, MessageCircle, Minus, PawPrint } from 'lucide-react-native'
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, shadow } from '../theme'
import {
  getHomePetFloatPosition,
  setHomePetFloatPosition,
  type HomePetFloatPosition,
} from '../utils/petPreferences'
import { PetAvatar, petMoodLabel, petStateLabel } from './PetAvatar'

interface FloatingPetCompanionProps {
  summary: PetSummary
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onOpenHome: () => void
  onOpenChat: () => void
  onClaimEvent?: () => void
  claiming?: boolean
}

type DockSide = 'left' | 'right'

const EXPANDED_WIDTH = 236
const EXPANDED_HEIGHT = 108
const COLLAPSED_SIZE = 72
const EDGE_MARGIN = 14
const DRAG_THRESHOLD = 5
const RECENT_DRAG_GUARD_MS = 220

export function FloatingPetCompanion({
  summary,
  collapsed,
  onCollapsedChange,
  onOpenHome,
  onOpenChat,
  onClaimEvent,
  claiming = false,
}: FloatingPetCompanionProps) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const position = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current
  const currentPositionRef = useRef<HomePetFloatPosition | null>(null)
  const dragStartRef = useRef<HomePetFloatPosition | null>(null)
  const lastDragAtRef = useRef(0)
  const collapsedRef = useRef(collapsed)
  const initializedRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dockSide, setDockSide] = useState<DockSide>('right')

  const metrics = useMemo(
    () => getPetFloatMetrics(windowWidth, windowHeight, insets.top, insets.bottom, collapsed),
    [collapsed, insets.bottom, insets.top, windowHeight, windowWidth],
  )

  const applyPosition = useCallback((next: HomePetFloatPosition) => {
    currentPositionRef.current = next
    position.setValue({ x: next.left, y: next.top })
    setDockSide(resolveDockSide(next, windowWidth, collapsed))
  }, [collapsed, position, windowWidth])

  useEffect(() => {
    collapsedRef.current = collapsed
  }, [collapsed])

  useEffect(() => {
    let active = true

    async function loadPosition() {
      const stored = initializedRef.current ? currentPositionRef.current : await getHomePetFloatPosition()
      if (!active) return
      initializedRef.current = true
      const next = clampPetFloatPosition(stored || defaultPetFloatPosition(metrics), metrics, collapsed)
      applyPosition(next)
      void setHomePetFloatPosition(next)
      setReady(true)
    }

    void loadPosition()
    return () => {
      active = false
    }
  }, [applyPosition, collapsed, metrics])

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dx) > DRAG_THRESHOLD || Math.abs(gesture.dy) > DRAG_THRESHOLD
    ),
    onPanResponderGrant: () => {
      dragStartRef.current = currentPositionRef.current
      setDragging(true)
    },
    onPanResponderMove: (_, gesture) => {
      const start = dragStartRef.current
      if (!start) return
      const activeMetrics = getPetFloatMetrics(
        windowWidth,
        windowHeight,
        insets.top,
        insets.bottom,
        collapsedRef.current,
      )
      const next = clampPetFloatPosition({
        left: start.left + gesture.dx,
        top: start.top + gesture.dy,
      }, activeMetrics, collapsedRef.current)
      currentPositionRef.current = next
      position.setValue({ x: next.left, y: next.top })
    },
    onPanResponderRelease: (_, gesture) => {
      const start = dragStartRef.current
      dragStartRef.current = null
      setDragging(false)
      const moved = Math.abs(gesture.dx) > DRAG_THRESHOLD || Math.abs(gesture.dy) > DRAG_THRESHOLD
      if (moved) lastDragAtRef.current = Date.now()
      const activeMetrics = getPetFloatMetrics(
        windowWidth,
        windowHeight,
        insets.top,
        insets.bottom,
        collapsedRef.current,
      )
      const source = currentPositionRef.current || start || defaultPetFloatPosition(activeMetrics)
      const next = clampPetFloatPosition(source, activeMetrics, collapsedRef.current)
      applyPosition(next)
      void setHomePetFloatPosition(next)
    },
    onPanResponderTerminate: () => {
      dragStartRef.current = null
      setDragging(false)
      const activeMetrics = getPetFloatMetrics(
        windowWidth,
        windowHeight,
        insets.top,
        insets.bottom,
        collapsedRef.current,
      )
      const source = currentPositionRef.current || defaultPetFloatPosition(activeMetrics)
      const next = clampPetFloatPosition(source, activeMetrics, collapsedRef.current)
      applyPosition(next)
      void setHomePetFloatPosition(next)
    },
  }), [applyPosition, insets.bottom, insets.top, position, windowHeight, windowWidth])

  const canPress = useCallback(() => Date.now() - lastDragAtRef.current > RECENT_DRAG_GUARD_MS, [])

  const openChat = useCallback(() => {
    if (!canPress()) return
    onOpenChat()
  }, [canPress, onOpenChat])

  const openHome = useCallback(() => {
    if (!canPress()) return
    onOpenHome()
  }, [canPress, onOpenHome])

  const expand = useCallback(() => {
    if (!canPress()) return
    onCollapsedChange(false)
  }, [canPress, onCollapsedChange])

  const collapse = useCallback(() => {
    if (!canPress()) return
    onCollapsedChange(true)
  }, [canPress, onCollapsedChange])

  const claimEvent = useCallback(() => {
    if (!canPress() || claiming) return
    onClaimEvent?.()
  }, [canPress, claiming, onClaimEvent])

  const pet = summary.pet
  const levelProgress = Math.max(0, Math.min(100, pet?.level_progress || 0))
  const moodText = petMoodLabel(summary.status?.mood).replace(/^状态：/, '')
  const stateText = petStateLabel(summary.status?.state)
  const canClaim = Boolean(summary.event?.can_claim && !summary.event?.is_claimed)
  const message = summary.status?.message || summary.event?.message || '记录一餐，陪你一起长大。'
  const collapsedA11y = `${pet?.name || '成长伙伴'}已收起，双击展开`
  const expandedA11y = `浮动成长伙伴：${pet?.name || '成长伙伴'}，${moodText}，${stateText}`

  return (
    <Animated.View
      style={[
        styles.float,
        {
          opacity: ready ? 1 : 0,
          transform: position.getTranslateTransform(),
          width: metrics.width,
          minHeight: metrics.height,
        },
        dragging && styles.dragging,
      ]}
      {...panResponder.panHandlers}
    >
      {collapsed ? (
        <Pressable
          accessibilityLabel={collapsedA11y}
          accessibilityRole="button"
          style={({ pressed }) => [styles.collapsedButton, pressed && styles.pressed]}
          onPress={expand}
        >
          {dockSide === 'right' ? (
            <ChevronLeft size={16} color={colors.brandDark} strokeWidth={2.8} style={styles.collapsedChevron} />
          ) : (
            <ChevronRight size={16} color={colors.brandDark} strokeWidth={2.8} style={styles.collapsedChevron} />
          )}
          <PetAvatar pet={pet} size="small" mood={summary.status?.mood} state={summary.status?.state} />
          <View style={[styles.miniHint, canClaim && styles.rewardHint]}>
            <Text style={styles.miniHintText}>{canClaim ? '奖' : '聊'}</Text>
          </View>
        </Pressable>
      ) : (
        <View accessibilityLabel={expandedA11y} style={styles.card}>
          <Pressable
            accessibilityLabel={`和${pet?.name || '成长伙伴'}聊天`}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
            onPress={openChat}
          >
            <PetAvatar pet={pet} size="small" mood={summary.status?.mood} state={summary.status?.state} />
            <View style={styles.copy}>
              <View style={styles.headerRow}>
                <Text numberOfLines={1} style={styles.name}>{pet?.name || '成长伙伴'}</Text>
                {canClaim ? <Text style={styles.rewardBadge}>可领奖</Text> : null}
              </View>
              <Text numberOfLines={1} style={styles.meta}>Lv.{pet?.level || 1} · {stateText} · 习惯分 {summary.today?.habit_score || 0}</Text>
              <Text numberOfLines={1} style={styles.message}>{message}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${levelProgress}%` }]} />
              </View>
            </View>
          </Pressable>
          <View style={styles.actions}>
            {canClaim ? (
              <Pressable accessibilityLabel="领取伙伴奖励" accessibilityRole="button" disabled={claiming} style={[styles.iconButton, styles.rewardIconButton, claiming && styles.disabledButton]} onPress={claimEvent}>
                <Gift size={17} color="#b7791f" strokeWidth={2.5} />
              </Pressable>
            ) : null}
            <Pressable accessibilityLabel="打开伙伴主页" accessibilityRole="button" style={styles.iconButton} onPress={openHome}>
              <PawPrint size={17} color={colors.brandDark} strokeWidth={2.5} />
            </Pressable>
            <Pressable accessibilityLabel="和伙伴聊天" accessibilityRole="button" style={styles.iconButton} onPress={openChat}>
              <MessageCircle size={17} color={colors.brandDark} strokeWidth={2.5} />
            </Pressable>
            <Pressable accessibilityLabel="收起伙伴" accessibilityRole="button" style={styles.iconButton} onPress={collapse}>
              <Minus size={17} color={colors.textSecondary} strokeWidth={2.7} />
            </Pressable>
          </View>
        </View>
      )}
    </Animated.View>
  )
}

interface PetFloatMetrics {
  width: number
  height: number
  margin: number
  minTop: number
  maxTop: number
  defaultLeft: number
  defaultTop: number
  windowWidth: number
}

function getPetFloatMetrics(
  windowWidth: number,
  windowHeight: number,
  topInset: number,
  bottomInset: number,
  collapsed: boolean,
): PetFloatMetrics {
  const width = collapsed ? COLLAPSED_SIZE : Math.min(EXPANDED_WIDTH, Math.max(190, windowWidth - EDGE_MARGIN * 2))
  const height = collapsed ? COLLAPSED_SIZE : EXPANDED_HEIGHT
  const minTop = Math.max(EDGE_MARGIN, topInset + 82)
  const bottomGuard = bottomInset + 112
  const maxTop = Math.max(minTop, windowHeight - bottomGuard - height)
  const defaultTop = Math.max(minTop, Math.min(topInset + 126, maxTop))

  return {
    width,
    height,
    margin: EDGE_MARGIN,
    minTop,
    maxTop,
    defaultLeft: Math.max(EDGE_MARGIN, windowWidth - width - EDGE_MARGIN - (collapsed ? 0 : 4)),
    defaultTop,
    windowWidth,
  }
}

function defaultPetFloatPosition(metrics: PetFloatMetrics): HomePetFloatPosition {
  return { left: metrics.defaultLeft, top: metrics.defaultTop }
}

function clampPetFloatPosition(
  position: HomePetFloatPosition,
  metrics: PetFloatMetrics,
  collapsed: boolean,
): HomePetFloatPosition {
  const maxLeft = Math.max(metrics.margin, metrics.windowWidth - metrics.width - metrics.margin)
  const clamped = {
    left: Math.max(metrics.margin, Math.min(position.left, maxLeft)),
    top: Math.max(metrics.minTop, Math.min(position.top, metrics.maxTop)),
  }
  if (!collapsed) return clamped
  const rightLeft = maxLeft
  const side = clamped.left + metrics.width / 2 < metrics.windowWidth / 2 ? 'left' : 'right'
  return { ...clamped, left: side === 'left' ? metrics.margin : rightLeft }
}

function resolveDockSide(position: HomePetFloatPosition, windowWidth: number, collapsed: boolean): DockSide {
  if (!collapsed) return position.left + EXPANDED_WIDTH / 2 < windowWidth / 2 ? 'left' : 'right'
  return position.left + COLLAPSED_SIZE / 2 < windowWidth / 2 ? 'left' : 'right'
}

const styles = StyleSheet.create({
  float: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 20,
    elevation: 10,
  },
  dragging: {
    opacity: 0.92,
  },
  card: {
    minHeight: EXPANDED_HEIGHT,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.16)',
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'visible',
    ...shadow,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    minHeight: EXPANDED_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 10,
    paddingVertical: 10,
  },
  pressed: {
    opacity: 0.72,
  },
  disabledButton: {
    opacity: 0.55,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  headerRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  rewardBadge: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: '#fff7ed',
    color: colors.orange,
    fontSize: 11,
    fontWeight: '900',
  },
  meta: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  message: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  progressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  actions: {
    width: 39,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingRight: 7,
  },
  iconButton: {
    width: 30,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(241, 245, 249, 0.82)',
  },
  rewardIconButton: {
    backgroundColor: '#fff7e6',
  },
  collapsedButton: {
    width: COLLAPSED_SIZE,
    height: COLLAPSED_SIZE,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.16)',
    ...shadow,
    shadowOpacity: 0.09,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 7,
  },
  collapsedChevron: {
    position: 'absolute',
    left: 2,
  },
  miniHint: {
    position: 'absolute',
    right: 2,
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  rewardHint: {
    backgroundColor: colors.orange,
  },
  miniHintText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 13,
  },
})
