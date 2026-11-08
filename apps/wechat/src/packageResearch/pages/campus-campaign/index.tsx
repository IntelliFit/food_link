import { Input, Text, View } from '@tarojs/components'
import { useCallback, useState } from 'react'
import Taro, { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { getAccessToken, showUnifiedApiError } from '../../../utils/api'
import {
  getCampaignByCode,
  getCampaignLeader,
  getCampaignMembersBoard,
  getCampaignsBoard,
  getMyCampaign,
  joinCampaign,
  type BoardEntry,
  type CampaignLeader,
  type CampaignMine,
  type CampusCampaign,
  type JoinInput,
} from '../../../utils/campus-campaign-api'
import { ensureLoggedIn } from '../research-weight/media'
import { JoinCard } from './join-card'
import { LeaderPanel } from './leader-panel'
import { MemberHome } from './member-home'
import { joinCodeFrom } from './labels'
import { HowTo, JOIN_STEPS } from './how-to'
import './index.scss'

type Tab = 'home' | 'board' | 'leader'

const formatDay = (iso: string) => iso.slice(5, 10).replace('-', '月') + '日'

function Board({ title, entries, showSchool }: { title: string; entries: BoardEntry[]; showSchool?: boolean }) {
  return (
    <View className='rw-card'>
      <Text className='rw-card__title'>{title}</Text>
      {entries.length === 0 ? <Text className='rw-tip'>还没有通过的称重样本</Text> : null}
      {entries.slice(0, 30).map((entry, index) => (
        <View key={`${entry.name}-${index}`} className='cc-board'>
          <Text className={`cc-board__rank ${entry.rank <= 3 ? 'cc-board__rank--top' : ''}`}>{entry.rank}</Text>
          <View className='cc-board__copy'>
            <Text className='cc-board__name'>{entry.name}</Text>
            {showSchool && entry.school_name ? <Text className='cc-board__meta'>{entry.school_name} · {entry.members ?? 0} 人 · 人均 {entry.per_member ?? 0}</Text> : null}
          </View>
          <Text className='cc-board__value'>{entry.approved} 份{entry.dishes ? ` · ${entry.dishes} 道菜` : ''}</Text>
        </View>
      ))}
    </View>
  )
}

/** 高校共建活动页：游客能看活动和排行，加入后是成员首页，负责人多一个管理页。 */
export default function CampusCampaignPage() {
  const { scheme } = useAppColorScheme()
  const router = useRouter()
  const [code, setCode] = useState(() => joinCodeFrom(router.params || {}))
  const [codeInput, setCodeInput] = useState('')
  const [campaign, setCampaign] = useState<CampusCampaign | null>(null)
  const [mine, setMine] = useState<CampaignMine | null>(null)
  const [leader, setLeader] = useState<CampaignLeader | null>(null)
  const [members, setMembers] = useState<BoardEntry[]>([])
  const [schools, setSchools] = useState<BoardEntry[]>([])
  const [tab, setTab] = useState<Tab>('home')
  const [joining, setJoining] = useState(false)
  const source: JoinInput['join_source'] = router.params?.scene ? 'qr' : router.params?.code ? 'link' : 'code'

  const load = useCallback(async (joinCode: string) => {
    let current: CampaignMine | null = null
    if (getAccessToken()) {
      try {
        current = await getMyCampaign()
        setMine(current)
      } catch (error) {
        console.warn('[campus-campaign] load mine failed', error)
      }
    }
    const shownCode = joinCode || current?.campaign?.join_code || ''
    try {
      const [shown, schoolBoard] = await Promise.all([shownCode ? getCampaignByCode(shownCode) : Promise.resolve(null), getCampaignsBoard()])
      setCampaign(shown)
      setSchools(schoolBoard)
      setMembers(shownCode ? await getCampaignMembersBoard(shownCode) : [])
    } catch (error) {
      await showUnifiedApiError(error, '活动加载失败')
    }
    if (current?.campaign && current.role === 'leader') {
      try {
        setLeader(await getCampaignLeader(current.campaign.id))
      } catch (error) {
        console.warn('[campus-campaign] load leader failed', error)
      }
    }
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    void load(code)
  })

  useShareAppMessage(() => {
    const shown = mine?.campaign || campaign
    return {
      title: shown ? `加入${shown.school_name}${shown.org_name}「${shown.title}」` : '高校共建：和社团一起称一称食堂的饭',
      path: `/packageResearch/pages/campus-campaign/index${shown ? `?code=${shown.join_code}` : ''}`,
    }
  })

  const join = async (input: JoinInput) => {
    if (!campaign || !ensureLoggedIn()) return
    setJoining(true)
    try {
      setMine(await joinCampaign(campaign.join_code, input))
      Taro.showToast({ title: '已加入', icon: 'success' })
      void load(campaign.join_code)
    } catch (error) {
      await showUnifiedApiError(error, '加入失败')
    } finally {
      setJoining(false)
    }
  }

  const openCode = () => {
    const next = joinCodeFrom({ code: codeInput })
    if (!next) {
      Taro.showToast({ title: '加入码是 6 位字母和数字', icon: 'none' })
      return
    }
    setCode(next)
    void load(next)
  }

  const memberOfShown = Boolean(mine?.campaign && campaign && mine.campaign.id === campaign.id)
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'home', label: '活动' }, { key: 'board', label: '排行' }]
  if (memberOfShown && mine?.role === 'leader') tabs.push({ key: 'leader', label: '管理' })

  return (
    <View className={`research-weight-page campus-campaign-page ${scheme === 'dark' ? 'research-weight-page--dark' : ''}`}>
      {campaign ? (
        <View className='rw-hero'>
          <Text className='rw-hero__eyebrow'>{campaign.school_name} · {campaign.org_name}</Text>
          <Text className='rw-hero__title'>{campaign.title}</Text>
          <Text className='rw-hero__desc'>
            {formatDay(campaign.starts_at)}–{formatDay(campaign.ends_at)} · {campaign.member_count} 人参加 · 已通过 {campaign.approved_count} 份称重
          </Text>
          {campaign.club_reward_note ? <Text className='rw-hero__reward'>社团奖励：{campaign.club_reward_note}</Text> : null}
          {!campaign.open ? <Text className='rw-hero__reward'>活动已结束</Text> : null}
        </View>
      ) : (
        <View className='rw-hero'>
          <Text className='rw-hero__eyebrow'>高校共建</Text>
          <Text className='rw-hero__title'>和健身社团一起，称一称食堂的饭</Text>
          <Text className='rw-hero__desc'>有秤的用秤称，没秤的拍照记录。称出来的克重会进入中餐克重评测集，也会变成本校食堂每道菜的份量和营养数据。</Text>
          <View className='cc-code'>
            <Input className='rw-input cc-code__input' value={codeInput} maxlength={8} placeholder='输入社团给的加入码' onInput={(e) => setCodeInput(e.detail.value)} />
            <View className='cc-code__button' onClick={openCode}><Text>查看</Text></View>
          </View>
        </View>
      )}

      {campaign ? (
        <View className='cc-tabs'>
          {tabs.map((item) => (
            <Text key={item.key} className={`cc-tab ${tab === item.key ? 'cc-tab--active' : ''}`} onClick={() => setTab(item.key)}>{item.label}</Text>
          ))}
        </View>
      ) : null}

      {tab === 'home' && campaign && memberOfShown && mine ? <MemberHome mine={mine} /> : null}
      {!campaign ? <HowTo title='怎么参加' steps={JOIN_STEPS} /> : null}
      {tab === 'home' && campaign && !memberOfShown && campaign.open ? <HowTo title='怎么参加' steps={JOIN_STEPS.slice(1)} /> : null}
      {tab === 'home' && campaign && !memberOfShown && campaign.open ? (
        mine?.campaign ? (
          <View className='rw-card'><Text className='rw-tip'>你已加入「{mine.campaign.title}」，同一时间只能参加一个活动。</Text></View>
        ) : <JoinCard source={source} busy={joining} onJoin={(input) => void join(input)} />
      ) : null}
      {tab === 'board' || !campaign ? (
        <View>
          {campaign ? <Board title='社团内排行（按通过的称重样本）' entries={members} /> : null}
          <Board title='各校社团排行' entries={schools} showSchool />
        </View>
      ) : null}
      {tab === 'leader' && leader ? <LeaderPanel leader={leader} onChange={setLeader} onStationCreated={() => void load(code)} /> : null}
    </View>
  )
}
