import { View, Text, PageMeta } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useCallback, useMemo, useEffect, useRef, type CSSProperties } from 'react'
import type { OnboardingGuideStorageKey } from '../../utils/onboarding-guide-storage'
import { markGuideCompleted } from '../../utils/onboarding-guide-storage'
import { checkIsLoggedIn } from '../../utils/withAuth'
import type { HighlightRect, OnboardingGuideStep } from './types'
import { useHighlightRect } from './useHighlightRect'
import { PAGE_SCROLL_LOCK_STYLE, usePageScrollLock } from '../../utils/page-scroll-lock'
import './index.scss'

export type OnboardingGuideProps = {
  visible: boolean
  steps: OnboardingGuideStep[]
  storageKey: OnboardingGuideStorageKey
  onClose: () => void
  /** 进入下一步前（stepIndex → nextIndex） */
  onBeforeNext?: (stepIndex: number, nextIndex: number) => void | Promise<void>
}

type PanelPlacement = 'top' | 'bottom' | 'center' | 'anchored-above'

const HIGHLIGHT_RECT_OPTIONS = { allowPageScroll: false } as const

function panelPlacement(
  step: OnboardingGuideStep | null,
  rect: HighlightRect | null,
  ready: boolean,
  winHeight: number,
): { placement: PanelPlacement; style?: CSSProperties } {
  if (step?.preset === 'tab-record-center' && rect && ready) {
    const gapPx = 24
    return {
      placement: 'anchored-above',
      style: {
        top: 'auto',
        bottom: `${winHeight - rect.top + gapPx}px`,
        transform: 'none',
      },
    }
  }
  if (!rect) {
    return { placement: 'center' }
  }
  const mid = rect.top + rect.height / 2
  if (mid < winHeight * 0.45) {
    return { placement: 'bottom' }
  }
  if (mid > winHeight * 0.55) {
    return { placement: 'top' }
  }
  return { placement: 'bottom' }
}

export default function OnboardingGuide({
  visible,
  steps,
  storageKey,
  onClose,
  onBeforeNext,
}: OnboardingGuideProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const wasVisibleRef = useRef(false)
  const showGuide = visible && checkIsLoggedIn()

  useEffect(() => {
    if (showGuide && !wasVisibleRef.current) {
      setStepIndex(0)
    }
    wasVisibleRef.current = showGuide
  }, [showGuide])

  const currentStep = showGuide && steps.length > 0 ? steps[stepIndex] ?? null : null
  usePageScrollLock(showGuide)
  const { rect, ready, refresh } = useHighlightRect(currentStep, showGuide, HIGHLIGHT_RECT_OPTIONS)
  const isLast = stepIndex >= steps.length - 1

  const winHeight = useMemo(() => {
    try {
      return Taro.getSystemInfoSync().windowHeight
    } catch {
      return 667
    }
  }, [showGuide, stepIndex])

  const finish = useCallback(() => {
    markGuideCompleted(storageKey)
    setStepIndex(0)
    onClose()
  }, [storageKey, onClose])

  const handleSkip = useCallback(() => {
    finish()
  }, [finish])

  const handleAction = useCallback(async () => {
    if (!currentStep?.action) return
    finish()
    await currentStep.action.onPress()
  }, [currentStep, finish])

  const handleNext = useCallback(async () => {
    if (!showGuide || steps.length === 0) return
    const nextIndex = stepIndex + 1
    if (onBeforeNext) {
      await onBeforeNext(stepIndex, nextIndex)
    }
    if (nextIndex >= steps.length) {
      finish()
      return
    }
    const nextStep = steps[nextIndex]
    setStepIndex(nextIndex)
    await refresh(nextStep)
  }, [showGuide, steps, stepIndex, onBeforeNext, finish, refresh])

  if (!showGuide || !currentStep) return null

  const { placement, style: panelStyle } = panelPlacement(currentStep, rect, ready, winHeight)
  const isRoundHole = currentStep.preset === 'tab-record-center'

  return (
    <>
      <PageMeta pageStyle={PAGE_SCROLL_LOCK_STYLE} />
      <View className='onboarding-guide' catchMove>
        <View className='onboarding-guide__touch-blocker' catchMove />
      {rect && ready ? (
        <View
          className={`onboarding-guide__hole${isRoundHole ? ' onboarding-guide__hole--round' : ''}`}
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
        />
      ) : (
        <View className='onboarding-guide__fallback-mask' />
      )}

      <View
        className={
          placement === 'anchored-above'
            ? 'onboarding-guide__panel'
            : `onboarding-guide__panel onboarding-guide__panel--${placement}`
        }
        style={panelStyle}
      >
        <Text className='onboarding-guide__step-label'>
          {stepIndex + 1} / {steps.length}
        </Text>
        <Text className='onboarding-guide__title'>{currentStep.title}</Text>
        <Text className='onboarding-guide__desc'>{currentStep.description}</Text>
        <View className='onboarding-guide__actions'>
          {currentStep.action ? (
            <Text className='onboarding-guide__skip' onClick={handleAction}>
              {currentStep.action.label}
            </Text>
          ) : (
            <Text className='onboarding-guide__skip' onClick={handleSkip}>
              跳过全部
            </Text>
          )}
          <Text className='onboarding-guide__next' onClick={handleNext}>
            {currentStep.confirmLabel ?? (isLast ? '知道了' : '下一步')}
          </Text>
        </View>
      </View>
      </View>
    </>
  )
}
