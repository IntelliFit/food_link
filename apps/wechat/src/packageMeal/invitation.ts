import Taro from '@tarojs/taro'
import { mealBudgetLabel, mealPath, mealWhen, type MealMeetup } from '../utils/meal-meetup'

export type MealInvitation = {
  title: string
  when: string
  venue: string
  budget: string
  places: string
  shareTitle: string
  path: string
  text: string
}

export function getMealInvitation(row?: MealMeetup, now = Date.now()): MealInvitation | undefined {
  if (!row || row.status !== 'active' || Date.parse(row.starts_at) <= now || !Number.isFinite(Date.parse(row.starts_at))) return
  const remaining = Math.max(0, row.capacity - row.member_count)
  if (!remaining) return
  const when = `${mealWhen(row.starts_at)} · 北京时间`
  const budget = mealBudgetLabel(row)
  const places = `还差 ${remaining} 位 · 共 ${row.capacity} 人`
  const shareTitle = `还差${remaining}位！${mealWhen(row.starts_at)}，${row.venue_name.slice(0, 24)}一起吃饭`
  return {
    title: row.title, when, venue: row.venue_name, budget, places, shareTitle,
    path: mealPath('detail', row.id),
    text: [`一起吃饭吧｜${row.title}`, when, `地点：${row.venue_name}`, `地址：${row.address}`, budget, places, '点开约饭卡片申请，发起人同意后加入。名额以详情页为准。'].join('\n'),
  }
}

export function drawMealInvitation(ctx: CanvasRenderingContext2D, invitation: MealInvitation): void {
  const text = (value: string, x: number, y: number, width = 412) => {
    let fitted = value
    while (fitted.length && ctx.measureText(fitted).width > width) fitted = fitted.slice(0, -1)
    if (fitted !== value) {
      while (fitted.length && ctx.measureText(`${fitted}…`).width > width) fitted = fitted.slice(0, -1)
      fitted += '…'
    }
    ctx.fillText(fitted, x, y)
  }
  ctx.fillStyle = '#f6f5ed'; ctx.fillRect(0, 0, 500, 400)
  ctx.fillStyle = '#21543e'; ctx.fillRect(0, 0, 500, 78)
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 25px sans-serif'; text('约饭邀请单', 34, 49)
  ctx.fillStyle = '#243d31'; ctx.font = 'bold 30px sans-serif'; text(invitation.title, 34, 128)
  ctx.font = '24px sans-serif'; text(invitation.when, 34, 183)
  ctx.font = 'bold 28px sans-serif'; text(invitation.venue, 34, 230)
  ctx.fillStyle = '#626f65'; ctx.font = '21px sans-serif'; text(invitation.budget, 34, 272)
  ctx.fillStyle = '#e5eddf'; ctx.fillRect(26, 297, 448, 72)
  ctx.fillStyle = '#21543e'; ctx.font = 'bold 23px sans-serif'; text(invitation.places, 42, 329)
  ctx.fillStyle = '#626f65'; ctx.font = '17px sans-serif'; text('点开申请 · 名额以详情页为准', 42, 354)
}

export async function createMealInvitationCover(invitation: MealInvitation): Promise<string> {
  await new Promise<void>(resolve => Taro.nextTick(resolve))
  const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('邀请卡画布暂不可用')), 2500)
    Taro.createSelectorQuery().select('#mealInvitationCanvas').fields({ node: true }).exec(result => {
      clearTimeout(timeout)
      if (result?.[0]?.node) resolve(result[0].node)
      else reject(new Error('邀请卡画布暂不可用'))
    })
  })
  canvas.width = 500; canvas.height = 400
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持邀请卡画布')
  drawMealInvitation(ctx, invitation)
  const result = await Taro.canvasToTempFilePath({
    canvas: canvas as unknown as NonNullable<Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas']>,
    destWidth: 500, destHeight: 400, fileType: 'jpg', quality: .9,
  })
  return result.tempFilePath
}
