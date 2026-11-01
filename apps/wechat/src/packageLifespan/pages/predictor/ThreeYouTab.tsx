import { Button, Slider, Text, View } from '@tarojs/components'
import { useMemo, useState, type ReactNode } from 'react'
import { engine } from '../../engine/engine'
import { LifeCanvas } from '../../charts/LifeCanvas'
import { drawDistribution, drawFork, drawSurvival, drawTrioFigures, type Palette } from '../../charts/draw'
import type { Predictee } from '../../model/people'
import { atAge, axisEndAge, deathAge, DISCLAIMER, percent, signedPoints, signedYears, todayWarnings, topChanges, years, type PredictorModel, type TopChange } from '../../model/predictor'
import { threeYouPoster, type PosterContent, type ShareOptions } from '../../model/share'

interface ThreeYouTabProps {
  model: PredictorModel
  person: Predictee
  palette: Palette
  header: ReactNode
  onAction: (target: TopChange['action']['target']) => void
  onShare: (build: (options: ShareOptions) => PosterContent) => void
  onPlay: () => void
  onDeleteData: () => void
}

const TONE_CLASSES = ['is-a', 'is-b', 'is-c']

const shift = (value: number): string => `${value >= 0 ? '往右推了' : '往左拉了'}约 ${years(Math.abs(value))} 年`

export function ThreeYouTab({ model, person, palette, header, onAction, onShare, onPlay, onDeleteData }: ThreeYouTabProps) {
  const { branches } = model
  const [today, right, loose] = branches
  const lastAge = axisEndAge(person)
  const [age, setAge] = useState(Math.min(lastAge, person.age + 18))
  const [chart, setChart] = useState<'alive' | 'dist'>('alive')
  const [life, setLife] = useState(0)
  const changes = useMemo(() => topChanges(model), [model])
  const warnings = useMemo(() => todayWarnings(model), [model])
  const gain = right.le.mean - today.le.mean
  const alive = branches.map(branch => atAge(person, branch, age))

  return (
    <View>
      <View className='lp-hero'>
        {header}
        <Text className='lp-hero__title'>
          {gain >= 0.3 ? <>把饮食吃对，平均多活 <Text className='lp-hero__num'>{years(gain)}</Text> 年</> : '吃法已经接近“吃对”，去自己调试试别的习惯'}
        </Text>
        <LifeCanvas id='lpFork' className='lp-canvas lp-canvas--fork' deps={[model, age]} draw={(ctx, w, h) => drawFork(ctx, w, h, person, branches, age)} />
        <View className='lp-age'>
          <Text className='lp-hero__dim'>拖动年龄</Text>
          <Text className='lp-age__num'>{age}</Text>
          <Text className='lp-hero__dim'>岁</Text>
          <Text className='lp-hero__dim lp-age__note'>线越淡 = 活到这个年龄的人越少</Text>
        </View>
        <Slider
          className='lp-slider'
          min={person.age}
          max={lastAge}
          step={1}
          value={age}
          activeColor='#45eaa9'
          backgroundColor='rgba(255,255,255,0.2)'
          blockSize={22}
          onChanging={(e) => setAge(e.detail.value)}
          onChange={(e) => setAge(e.detail.value)}
        />
        <View className='lp-trio'>
          <LifeCanvas id='lpTrio' className='lp-canvas lp-canvas--trio' deps={[model, age]} draw={(ctx, w, h) => drawTrioFigures(ctx, w, h, person, branches, age)} />
          <View className='lp-trio__stats'>
            {branches.map((branch, index) => (
              <View key={branch.key} className={`lp-trio__col ${TONE_CLASSES[index]}`}>
                <Text className='lp-trio__name'>{branch.name}</Text>
                <Text className='lp-trio__weight'>{alive[index].weight.toFixed(0)} kg</Text>
                <Text className='lp-hero__dim'>在世 {percent(alive[index].alive)}</Text>
              </View>
            ))}
          </View>
        </View>
        {warnings.map(warning => <Text key={warning.message} className='lp-hero__warn'>外推：{warning.message}</Text>)}
        <Text className='lp-hero__hint'>人物为示意，体型随 BMI 变化 · {DISCLAIMER}</Text>
      </View>

      <View className='lp-card'>
        <View className='lp-tabs'>
          <View className={`lp-tabs__item${chart === 'alive' ? ' is-on' : ''}`} role='tab' onClick={() => setChart('alive')}>活到各年龄的概率</View>
          <View className={`lp-tabs__item${chart === 'dist' ? ' is-on' : ''}`} role='tab' onClick={() => setChart('dist')}>寿命分布</View>
        </View>
        <LifeCanvas
          id='lpChart'
          className='lp-canvas lp-canvas--chart'
          deps={[model, age, chart, palette]}
          draw={(ctx, w, h) => {
            if (chart === 'alive') drawSurvival(ctx, w, h, person, branches, age, palette)
            else drawDistribution(ctx, w, h, person, branches, palette)
          }}
        />
        <View className='lp-legend'>
          {branches.map((branch, index) => <Text key={branch.key} className={`lp-legend__item ${TONE_CLASSES[index]}`}>{branch.name}</Text>)}
        </View>
        <Text className='lp-reading'>
          {chart === 'alive'
            ? `活到 ${age} 岁的概率：照现在这样吃 ${percent(alive[0].alive)}，把饮食吃对 ${percent(alive[1].alive)}，放飞自我 ${percent(alive[2].alive)}。`
            : `离世年龄是一条分布，不是一个日期。吃对把分布${shift(gain)}，放飞把分布${shift(loose.le.mean - today.le.mean)}，三条分布大量重叠。`}
        </Text>
        <View className='lp-le'>
          {branches.map((branch, index) => (
            <View key={branch.key} className='lp-le__col'>
              <Text className={`lp-le__name ${TONE_CLASSES[index]}`}>{branch.name}</Text>
              <Text className='lp-le__value'>{years(branch.le.mean)}</Text>
              <Text className='lp-fine'>平均寿命 · 80% 在 {Math.round(branch.le.p10)}–{Math.round(branch.le.p90)} 岁</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='lp-card'>
        <Text className='lp-card__title'>最值得改的三件事</Text>
        {changes.length === 0 && <Text className='lp-fine'>按引擎目前能算的三项（水果、鱼、体重），这个人的吃法已经达标了。去“自己调”试试其他习惯。</Text>}
        {changes.map((change, index) => (
          <View key={change.factor} className='lp-change'>
            <View className='lp-change__top'>
              <Text className='lp-change__rank'>{index + 1}</Text>
              <Text className='lp-change__name'>{change.name}</Text>
              <Text className='lp-change__gain'>{signedYears(change.gain)} 年</Text>
            </View>
            <Text className='lp-change__detail'>现在 {change.from} → {change.to}</Text>
            {change.p85Points !== null && <Text className='lp-fine'>活到 85 岁的概率 {signedPoints(change.p85Points)} 个百分点</Text>}
            <View className='lp-badges'>
              {change.evidence.map(item => <Text key={item} className='lp-badge'>{item}</Text>)}
              {change.extrapolated && <Text className='lp-badge lp-badge--warn'>目标超出队列观察范围 · 外推</Text>}
            </View>
            <Button className='lp-btn lp-btn--small lp-btn--ghost' onClick={() => onAction(change.action.target)}>{change.action.label} ›</Button>
          </View>
        ))}
        <Text className='lp-fine'>每一项单独计算，各项收益合计不等于全部一起改的收益。</Text>
        <Button className='lp-btn lp-btn--ghost lp-btn--block' onClick={onPlay}>不只这三件，自己调调看 ›</Button>
      </View>

      <View className='lp-card'>
        <View className='lp-row'>
          <Text className='lp-card__title lp-grow'>跑一次人生</Text>
          <Text className='lp-fine'>第 {life + 1} 次</Text>
        </View>
        <Text className='lp-fine'>三个你掷同一颗骰子，差别只来自吃法。这只是一次随机结果，不是你的命运。</Text>
        <View className='lp-dice'>
          {branches.map((branch, index) => (
            <View key={branch.key} className='lp-dice__col'>
              <Text className={`lp-le__name ${TONE_CLASSES[index]}`}>{branch.name}</Text>
              <Text className='lp-dice__value'>{Math.floor(deathAge(person, branch, life))}<Text className='lp-dice__unit'> 岁</Text></Text>
              <Text className='lp-fine'>这次模拟离世</Text>
            </View>
          ))}
        </View>
        <View className='lp-row'>
          <Button className='lp-btn lp-btn--ghost lp-grow' onClick={() => setLife(life + 1)}>再掷一次</Button>
          <Button className='lp-btn lp-grow' onClick={() => onShare(options => threeYouPoster(person.label, model, life, options))}>做成分享卡片</Button>
        </View>
      </View>

      <View className='lp-card'>
        <Text className='lp-card__title'>这一版还没算的</Text>
        <Text className='lp-note'><Text className='lp-note__key'>疾病 </Text>高血压、糖尿病、心脏病等还没有模块，所以不显示“健康年数”和“哪一年生病”。</Text>
        <Text className='lp-note'><Text className='lp-note__key'>盐、蔬菜 </Text>引擎目前只用 CKB 模型里的水果和鱼两个饮食变量。</Text>
        <Text className='lp-note'><Text className='lp-note__key'>坚持程度 </Text>三个你假设长期坚持。到“自己调”里可以改成晚几年开始、只坚持一部分。</Text>
      </View>

      <View className='lp-card'>
        <Text className='lp-card__title'>数据与依据</Text>
        <Text className='lp-note'>{person.label}的信息由你填写，只在这台手机上计算，不上传。</Text>
        <Text className='lp-note'>三个你之间只有水果、鱼和热量不同，其他保持一致。</Text>
        <Text className='lp-note'>基础死亡率来自 2020 年人口普查生命表；饮食和体重系数来自中国慢性病前瞻性研究（CKB）与 2025 年 Nature Communications 中国生活方式与预期寿命研究。没有论文的参数在参数表中标为“估计”。</Text>
        <Text className='lp-note'>模型 {engine.version.engine} · 参数 {engine.version.registry}</Text>
        <Text className='lp-note'>引擎开源：github.com/SmallHorseBrother/lifespan-predictor（MIT 许可证）</Text>
        <Text className='lp-link lp-link--danger' onClick={onDeleteData}>清除这台手机上的寿命预测器数据</Text>
      </View>
      <Text className='lp-foot'>{DISCLAIMER}</Text>
    </View>
  )
}
