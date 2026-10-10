import { View, Text, Input, Button, Switch, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../../utils/api'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { MICRONUTRIENT_PREFERENCE_CONFIGS } from '../../pages/index/utils/micronutrientPreferences'
import {
  getPlanLibrary, getNutritionDay, createNutritionPlans, updateNutritionPlan, deleteNutritionPlan,
  setDefaultNutritionPlan, changeNutritionDay, PLAN_STYLES, planFromPreset, planToday,
  type NutritionPlan, type PlanLibrary, type NutritionDay, type PlanValues, type DayChange,
} from '../../utils/nutrition-plans'
import './index.scss'

type Props = { date?: string; manager?: boolean; onClose?: () => void; onApplied?: (change: DayChange) => void; onEditBase?: () => void }
type Draft = Omit<PlanValues, 'targets' | 'fat_min' | 'fat_max'> & { targets: Record<string, string>; fat_min: string; fat_max: string; id?: string; revision?: number }
const microConfigs = MICRONUTRIENT_PREFERENCE_CONFIGS.filter(c => !['sugar', 'cholesterolMg'].includes(c.nutrientKey))
const snakeKey = (key: string) => key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`)
const toDraft = (v: PlanValues, id?: string, revision?: number): Draft => ({ ...v, id, revision, targets: Object.fromEntries(Object.entries(v.targets).map(([k, x]) => [k, String(x)])), fat_min: String(v.fat_min), fat_max: String(v.fat_max) })
const numberText = (value: number) => Number.isFinite(value) ? `${Math.round(value * 10) / 10}` : '—'
const macroText = (v: PlanValues) => `蛋白 ${numberText(v.targets.protein_target)} · 碳水 ${numberText(v.targets.carbs_target)} · 脂肪 ${numberText(v.fat_min)}–${numberText(v.fat_max)} g`

export default function NutritionPlans({ date = planToday(), manager = false, onClose, onApplied, onEditBase }: Props) {
  const [library, setLibrary] = useState<PlanLibrary | null>(null)
  const [day, setDay] = useState<NutritionDay | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<'list' | 'presets' | 'detail' | 'editor'>('list')
  const [preset, setPreset] = useState<typeof PLAN_STYLES[number]>(PLAN_STYLES[0])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [temporary, setTemporary] = useState(false)
  const [microOpen, setMicroOpen] = useState(false)
  const epoch = useRef(0)
  const alive = useRef(true)
  const account = useRef(getAccessToken())
  const locked = useRef(false)
  const operationEpoch = useRef(-1)
  const canAccept = () => alive.current && operationEpoch.current === epoch.current && account.current === getAccessToken()
  const refresh = async () => {
    const turn = ++epoch.current; const token = getAccessToken()
    account.current = token; setLoading(true); setError(''); setLibrary(null); setDay(null)
    try {
      const [nextLibrary, nextDay] = await Promise.all([getPlanLibrary(), getNutritionDay(date)])
      if (alive.current && turn === epoch.current && token === getAccessToken()) { setLibrary(nextLibrary); setDay(nextDay) }
    } catch (e) { if (alive.current && turn === epoch.current && token === getAccessToken()) setError(e instanceof Error ? e.message : '获取方案失败') }
    finally { if (alive.current && turn === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true; setView('list'); void refresh()
    return () => { alive.current = false; epoch.current++ }
  }, [date]) // date owns the draft and optimistic concurrency token.

  const run = async (operation: () => Promise<void>) => {
    if (locked.current) return
    if (account.current !== getAccessToken()) { setView('list'); void refresh(); return }
    locked.current = true; setBusy(true); setError('')
    const turn = epoch.current; const token = getAccessToken()
    operationEpoch.current = turn
    try { await operation() }
    catch (e) { if (alive.current && turn === epoch.current && token === getAccessToken()) setError(e instanceof Error ? e.message : '操作失败，请重试') }
    finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  const accept = (next: PlanLibrary) => { if (canAccept()) setLibrary(next) }
  const apply = (plan: NutritionPlan) => void run(async () => {
    if (!day) return
    const change = await changeNutritionDay(date, day.change_token, { plan_id: plan.id })
    if (canAccept()) { setDay(change.day); onApplied?.(change); onClose?.() }
  })
  const edit = (v: PlanValues, isTemporary = false, id?: string, revision?: number) => {
    setDrafts([toDraft(v, id, revision)]); setTemporary(isTemporary); setMicroOpen(false); setError(''); setView('editor')
  }
  const updateDraft = (index: number, next: Partial<Draft>) => setDrafts(current => current.map((v, i) => i === index ? { ...v, ...next } : v))
  const targetChange = (index: number, key: string, value: string) => {
    const v = drafts[index]; const targets = { ...v.targets, [key]: value }
    if (v.auto_carb && ['calorie_target', 'protein_target', 'fat_target'].includes(key)) {
      const carb = (Number(targets.calorie_target) - Number(targets.protein_target) * 4 - Number(targets.fat_target) * 9) / 4
      targets.carbs_target = numberText(carb)
    }
    if (!v.auto_carb && ['carbs_target', 'protein_target', 'fat_target'].includes(key)) targets.calorie_target = numberText(Number(targets.protein_target) * 4 + Number(targets.carbs_target) * 4 + Number(targets.fat_target) * 9)
    updateDraft(index, { targets })
  }
  const save = () => void run(async () => {
    const values = drafts.map(v => {
      if (!v.name.trim()) throw new Error('请填写方案名称')
      const targets = Object.fromEntries(Object.entries(v.targets).filter(([k, x]) => (v.micro_mode === 'custom' || ['calorie_target', 'protein_target', 'carbs_target', 'fat_target'].includes(k)) && x.trim() !== '').map(([k, x]) => [k, Number(x)]))
      for (const k of ['calorie_target', 'protein_target', 'carbs_target', 'fat_target']) if (v.targets[k]?.trim() === '' || !Number.isFinite(targets[k])) throw new Error('请填写完整的热量与三大营养素')
      if (Object.values(targets).some(x => !Number.isFinite(x) || x < 0) || !v.fat_min.trim() || !v.fat_max.trim()) throw new Error('请检查营养目标与脂肪范围')
      return { name: v.name.trim(), targets, fat_min: Number(v.fat_min), fat_max: Number(v.fat_max), micro_mode: v.micro_mode, auto_carb: v.auto_carb, style: v.style } satisfies PlanValues
    })
    if (temporary && day) {
      const change = await changeNutritionDay(date, day.change_token, { values: values[0] })
      if (canAccept()) { setDay(change.day); onApplied?.(change); onClose?.() }
    } else if (drafts[0].id) {
      accept(await updateNutritionPlan({ ...values[0], id: drafts[0].id, revision: drafts[0].revision || 1 }))
    } else accept(await createNutritionPlans(values))
    if (canAccept()) {
      setView('list'); void Taro.showToast({ title: temporary ? '当天目标已更新' : '方案已保存', icon: 'success' })
    }
  })
  const remove = (plan: NutritionPlan) => void run(async () => {
    const answer = await Taro.showModal({ title: `删除「${plan.name}」？`, content: '已保存日期的营养目标会保留。', confirmText: '删除', confirmColor: '#b85f4c' })
    if (answer.confirm && alive.current && account.current === getAccessToken()) accept(await deleteNutritionPlan(plan.id))
  })
  const back = () => { if (busy) return; setError(''); setView(view === 'editor' && drafts.length > 1 ? 'detail' : view === 'detail' ? 'presets' : 'list') }
  const title = view === 'editor' ? temporary ? '只调这一天' : drafts[0]?.id ? '编辑方案' : drafts.length === 2 ? '创建训练／休息方案' : '新建方案' : view === 'presets' ? '经典预设' : view === 'detail' ? preset.name : manager ? '饮食方案' : `${date === planToday() ? '今天' : date.slice(5)}用哪套？`
  const newPreset = () => { if (!library) return; setDrafts(planFromPreset(preset.id, library.base_targets).map(v => toDraft(v))); setTemporary(false); setMicroOpen(false); setView('editor') }

  return <View className={`nutrition-plans ${manager ? 'np-page' : 'np-overlay'}`} onClick={manager ? undefined : () => { if (!busy) onClose?.() }}>
    <View className='np-panel' onClick={e => e.stopPropagation()}>
      {!manager && <View className='np-grabber' />}
      <View className='np-header'>
        <View><Text className='np-eyebrow'>{view === 'list' ? manager ? 'MY NUTRITION' : '每日目标' : '饮食方案'}</Text><Text className='np-title'>{title}</Text></View>
        {view !== 'list' ? <Button className='np-icon-btn' disabled={busy} onClick={back}>返回</Button> : !manager ? <Button className='np-icon-btn' disabled={busy} onClick={onClose}>×</Button> : null}
      </View>
      <ScrollView scrollY className='np-scroll'>
        {loading && <View className='np-skeleton'><View /><View /><View /></View>}
        {error && <View className='np-error'><Text>{error}</Text>{view === 'editor' && <Button disabled={busy} onClick={() => setError('')}>继续修改</Button>}<Button disabled={busy} onClick={() => { setView('list'); void refresh() }}>刷新重试</Button></View>}
        {library && day && view === 'list' && <>
          <Text className='np-intro'>{manager ? '把常用目标存好，需要时一键选择。' : '切换只更新这个日期；已经记录的食物保留。'}</Text>
          {!manager && <View className='np-current'><Text className='np-tag'>当前 · {day.source === 'temporary_plan' ? '当天微调' : day.source === 'default_plan' ? '默认方案' : day.historical_reference ? '历史参考' : '已选目标'}</Text><Text className='np-current-name'>{day.snapshot.name}</Text><Text className='np-caption'>{Math.round(day.snapshot.targets.calorie_target)} kcal · 微量{day.snapshot.micro_mode === 'custom' ? '独立设置' : '沿用基础目标'}</Text></View>}
          <View className='np-section-row'><Text className='np-section-title'>我的方案</Text><Text className='np-count'>{library.plans.length - 1} / 20</Text></View>
          {library.plans.map(plan => <View className={`np-plan ${!manager && day.snapshot.plan_id === plan.id && day.source !== 'temporary_plan' ? 'is-selected' : ''}`} key={plan.id}>
            <View className='np-plan-main' onClick={manager ? undefined : () => apply(plan)}>
              <View className='np-plan-top'><Text className='np-plan-name'>{plan.name}</Text>{library.default_id === plan.id && <Text className='np-tag'>默认</Text>}<Text className='np-kcal'>{Math.round(plan.targets.calorie_target)}<Text className='np-unit'> kcal</Text></Text></View>
              <Text className='np-caption'>{macroText(plan)}</Text><Text className='np-muted'>微量营养{plan.micro_mode === 'custom' ? '独立设置' : '沿用基础目标'}</Text>
              {!manager && <Button className='np-use' disabled={busy} onClick={e => { e.stopPropagation(); apply(plan) }}>选用</Button>}
            </View>
            {manager && <View className='np-plan-actions'>
              {plan.id !== 'base' && <Button disabled={busy} onClick={() => edit(plan, false, plan.id, plan.revision)}>编辑</Button>}
              <Button disabled={busy} onClick={() => edit({ ...plan, name: `${plan.name.slice(0, 16)}副本` })}>复制</Button>
              <Button disabled={busy || library.default_id === plan.id} onClick={() => void run(async () => { accept(await setDefaultNutritionPlan(plan.id)); const nextDay = await getNutritionDay(date); if (canAccept()) setDay(nextDay) })}>{library.default_id === plan.id ? '已默认' : '设为默认'}</Button>
              {plan.id !== 'base' && <Button className='np-delete' disabled={busy} onClick={() => remove(plan)}>删除</Button>}
            </View>}
          </View>)}
          {!manager && <Button className='np-secondary' disabled={busy} onClick={() => edit({ ...day.snapshot, name: `${date.slice(5)}临时目标` }, true)}>只调这一天 <Text>›</Text></Button>}
          <Button className='np-secondary' disabled={busy} onClick={() => setView('presets')}>从经典预设创建 <Text>›</Text></Button>
          {manager ? <Button className='np-secondary' disabled={busy || library.plans.length > 20} onClick={() => edit({ ...library.plans[0], name: '新方案' })}>自定义新方案 <Text>＋</Text></Button> : <Button className='np-link' disabled={busy} onClick={() => { onClose?.(); void Taro.navigateTo({ url: extraPkgUrl('/pages/nutrition-plans/index') }) }}>管理全部方案 ›</Button>}
          <Text className='np-footnote'>默认方案用于未单独选择的日期。编辑默认模板从明天生效；已保存日期保留快照。</Text>
        </>}
        {library && view === 'presets' && <><Text className='np-intro'>基于你的基础目标生成，创建前可以调整。</Text>{PLAN_STYLES.map(style => <View className='np-preset' key={style.id} onClick={() => { setPreset(style); setView('detail') }}><View className={`np-preset-icon style-${style.id}`}><Text className='iconfont icon-shiwu' /></View><View className='np-preset-copy'><Text className='np-plan-name'>{style.name}</Text><Text className='np-caption'>{style.caption}</Text></View><Text>›</Text></View>)}</>}
        {library && view === 'detail' && <><View className='np-style-hero'><Text className='np-hero-label'>食物与营养，安排得更顺手</Text><Text className='np-title'>{preset.name}</Text><Text className='np-intro'>{preset.foods}</Text></View><Text className='np-detail'>{preset.detail}</Text><View className='np-preview'>{planFromPreset(preset.id, library.base_targets).map(v => <View key={v.name}><Text className='np-plan-name'>{v.name} · {Math.round(v.targets.calorie_target)} kcal</Text><Text className='np-caption'>{macroText(v)}</Text></View>)}</View><Text className='np-footnote'>这是可编辑起点，创建后保存到“我的方案”，不会自动切换今天。</Text><Button className='np-primary' disabled={busy || library.plans.length - 1 + (preset.id === 'cycle' ? 2 : 1) > 20} onClick={newPreset}>调整并创建{preset.id === 'cycle' ? '两套方案' : ''}</Button></>}
        {library && view === 'editor' && <>
          <Text className='np-intro'>{temporary ? `${date} 的专用目标，保存不修改模板。` : drafts[0]?.id ? '模板修改保留已保存日期的目标。' : '创建后再选择使用日期。'}</Text>
          {drafts.map((v, index) => <View className='np-editor-card' key={index}>
            <Text className='np-label'>方案名称</Text><Input className='np-name-input' maxlength={20} value={v.name} disabled={busy} onInput={e => updateDraft(index, { name: e.detail.value })} />
            <View className='np-field np-calorie-field'><View><Text className='np-label'>热量</Text><Text className='np-muted'>{v.auto_carb ? '蛋白质、脂肪保持，碳水补足差额' : '由三大营养素换算'}</Text></View><Input type='digit' value={v.targets.calorie_target} disabled={busy || !v.auto_carb} onInput={e => targetChange(index, 'calorie_target', e.detail.value)} /><Text className='np-unit'>kcal</Text></View>
            <View className='np-toggle'><Text>碳水自动补足热量</Text><Switch color='#477c68' checked={v.auto_carb} disabled={busy} onChange={e => {
              const targets = { ...v.targets }; const automatic = e.detail.value
              if (automatic) targets.carbs_target = numberText((Number(targets.calorie_target) - Number(targets.protein_target) * 4 - Number(targets.fat_target) * 9) / 4)
              else targets.calorie_target = numberText(Number(targets.protein_target) * 4 + Number(targets.carbs_target) * 4 + Number(targets.fat_target) * 9)
              updateDraft(index, { auto_carb: automatic, targets })
            }}
            /></View>
            {[['protein_target', '蛋白质'], ['carbs_target', '碳水'], ['fat_target', '脂肪参考值']].map(([key, label]) => <View className='np-field' key={key}><Text>{label}</Text><Input type='digit' disabled={busy || key === 'carbs_target' && v.auto_carb} value={v.targets[key]} onInput={e => targetChange(index, key, e.detail.value)} /><Text className='np-unit'>g</Text></View>)}
            <View className='np-field'><Text>脂肪范围</Text><Input type='digit' disabled={busy} value={v.fat_min} onInput={e => updateDraft(index, { fat_min: e.detail.value })} /><Text>–</Text><Input type='digit' disabled={busy} value={v.fat_max} onInput={e => updateDraft(index, { fat_max: e.detail.value })} /><Text className='np-unit'>g</Text></View>
            <Text className='np-footnote'>脂肪在范围内即可，无需补到上限。参考值用于热量分配。</Text>
            <View className='np-micro-head' onClick={() => setMicroOpen(x => !x)}><View><Text className='np-section-title'>微量营养目标</Text><Text className='np-muted'>维生素、矿物质、纤维与控制项</Text></View><Text>{microOpen ? '收起 −' : '展开 ＋'}</Text></View>
            {microOpen && <><View className='np-segment'>{(['profile', 'custom'] as const).map(mode => <Button key={mode} className={v.micro_mode === mode ? 'active' : ''} disabled={busy} onClick={() => updateDraft(index, { micro_mode: mode })}>{mode === 'profile' ? '沿用基础目标' : '独立设置'}</Button>)}</View>
              <Text className='np-footnote'>微量目标不随热量缩放。独立设置留空的项目仍沿用基础值；总糖与胆固醇只做摄入记录。</Text>
              {microConfigs.map(c => { const key = snakeKey(c.targetFormKey); const base = temporary && v.micro_mode === 'profile' && day?.snapshot.micro_mode === 'profile' ? day.snapshot.targets[key] : library.base_targets[key]; return <View className='np-field np-micro-field' key={key}><Text>{c.label}{['saturatedFat', 'sodiumMg'].includes(c.nutrientKey) ? ' · 控制值' : ' · 参考值'}</Text>{v.micro_mode === 'custom' ? <Input type='digit' disabled={busy} placeholder={numberText(base)} value={v.targets[key] || ''} onInput={e => targetChange(index, key, e.detail.value)} /> : <Text className='np-inherited'>{numberText(base)}</Text>}<Text className='np-unit'>{c.unit === 'mcg' ? 'μg' : c.unit}</Text></View> })}</>}
            {v.style && <Text className='np-food-guide'>{PLAN_STYLES.find(s => s.id === v.style)?.foods}</Text>}
          </View>)}
          <Button className='np-primary' disabled={busy} onClick={save}>{busy ? <View className='np-spinner' /> : temporary ? '保存到这一天' : drafts.length === 2 ? '创建两套方案' : '保存方案'}</Button>
        </>}
        {view === 'list' && onEditBase && <Button className='np-link' disabled={busy} onClick={onEditBase}>基础目标与显示设置 ›</Button>}
        <View className='np-bottom-space' />
      </ScrollView>
    </View>
  </View>
}
