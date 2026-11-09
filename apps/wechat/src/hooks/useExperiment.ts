import { useEffect, useState } from 'react'
import { experiments } from '../utils/experiments'
import type { ExperimentSnapshot } from '../utils/experiment-client'

interface UseExperimentOptions {
  /** 拿到分组后自动记一次曝光；只在真正渲染实验界面的组件里保持 true */
  expose?: boolean
}

/**
 * 读取某个实验的分组。fallback 是对照组标识：未分组、不在实验人群或接口失败时都返回它。
 * 首次进入时 ready 可能为 false，需要避免界面闪变的页面可先显示骨架，等 ready 再渲染。
 */
export function useExperiment(key: string, fallback: string, options: UseExperimentOptions = {}): ExperimentSnapshot {
  const expose = options.expose !== false
  const [snapshot, setSnapshot] = useState<ExperimentSnapshot>(() => experiments.get(key, fallback))

  useEffect(() => {
    setSnapshot(experiments.get(key, fallback))
    return experiments.subscribe(() => setSnapshot(experiments.get(key, fallback)))
  }, [key, fallback])

  useEffect(() => {
    if (expose && snapshot.ready && snapshot.tracked) experiments.expose(key)
  }, [expose, key, snapshot.ready, snapshot.tracked, snapshot.variant])

  return snapshot
}
