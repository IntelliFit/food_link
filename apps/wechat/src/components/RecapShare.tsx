import { Canvas, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getAccessToken, getShareQrEnvVersion, getUnlimitedQRCode } from '../utils/api'
import { resolveCanvasImageSrc } from '../utils/weapp-canvas-image'
import type { RecapJourney } from '../utils/recap-story'
import type { JournalPhotos } from '../utils/recap-journal'
import type { RecapKind } from '../utils/health-recap'
import { isShowShareImageMenuCancel } from '../utils/weapp-share-image'

type Props = { recipient?: string; cups?: number | null; photos?: JournalPhotos | null; onShelf?: () => void; kind: RecapKind; start: string; end: string; recorded: number; longest: number; journey: RecapJourney; title: string; onClose: () => void }
type MiniCanvas = HTMLCanvasElement & { createImage: () => HTMLImageElement }

export function RecapShare({ kind, recipient, cups, photos, onShelf, start, end, recorded, longest, journey, onClose }: Props) {
  const [withQR, setWithQR] = useState(true)
  const [image, setImage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const pending = useRef(false)
  const generatedInput = useRef('')
  const owner = useRef(getAccessToken())
  useEffect(() => () => { alive.current = false }, [])
  const valid = () => alive.current && owner.current === getAccessToken()
  const generate = async () => {
    if (pending.current || !valid()) return
    pending.current = true; setBusy(true); setError(''); setImage('')
    try {
      const canvas = await new Promise<MiniCanvas>((resolve, reject) => {
        Taro.createSelectorQuery().select('#recapShareCanvas').fields({ node: true, size: true }).exec(result => result?.[0]?.node ? resolve(result[0].node) : reject(new Error('画布尚未就绪，请再试一次。')))
      })
      const load = async (src: string) => {
        const path = await resolveCanvasImageSrc(src)
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const item = canvas.createImage()
          const timeout = setTimeout(() => reject(new Error('海报图片读取超时，请重试。')), 15000)
          item.onload = () => { clearTimeout(timeout); resolve(item) }; item.onerror = () => { clearTimeout(timeout); reject(new Error('海报图片未能打开，请重试。')) }; item.src = path
        })
      }
      const background = await load(`/assets/recap-v5/${kind === 'year' ? 'annual-cover' : 'weekly-cover'}.jpg`)
      let qr: HTMLImageElement | null = null
      if (withQR) {
        try {
          const result = await getUnlimitedQRCode('share=1', 'pages/index/index', getShareQrEnvVersion())
          qr = await load(result.base64)
        } catch { throw new Error('二维码暂未生成。可以重试，或关闭二维码后导出海报。') }
      }
      if (!valid()) return
      const width = 750, height = 2400
      canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前环境暂不支持海报画布。')
      context.fillStyle = '#f5f0e6'; context.fillRect(0, 0, width, height)
      context.drawImage(background, 0, 0, width, 820)
      context.fillStyle = '#fff7e9'; context.globalAlpha = .96; context.fillRect(50, 150, 650, 610); context.globalAlpha = 1
      context.textAlign = 'center'; context.fillStyle = '#786343'; context.font = '25px serif'
      context.fillText('食探 · 把生活讲成故事', width / 2, 225)
      context.font = '38px KaiTi, serif'; context.fillStyle = '#885637'
      context.fillText(`${recipient?.trim() || '亲爱的朋友'}的${kind === 'year' ? '年报' : kind === 'month' ? '月报' : '周报'}`, width / 2, 305, 570)
      context.font = '20px serif'; context.fillText(`${start} — ${end}`, width / 2, 356)
      context.font = '75px serif'; context.fillText(String(recorded), width / 2, 490)
      context.font = '29px KaiTi, serif'; context.fillText('天生活足迹，被轻轻点亮', width / 2, 550)
      context.font = '24px KaiTi, serif'; context.fillText(`最长相伴 ${longest} 天`, width / 2, 613)
      context.fillStyle = '#a6845f'; context.font = '23px KaiTi, serif'; context.fillText('日子不必完美，认真生活就值得珍藏。', width / 2, 700)
      context.fillStyle = '#e8dfcc'; context.fillRect(60, 875, 630, 2)
      context.fillStyle = '#785c42'; context.font = '39px KaiTi, serif'; context.fillText('光影日记', width / 2, 960)
      context.font = '28px KaiTi, serif'
      const lines = photos ? [`${photos.counts.breakfast} 次早餐的温暖`, `${photos.counts.lunch} 次午餐的相遇`, `${photos.counts.dinner} 次晚餐的陪伴`] : ['留一页，等那些温暖的三餐']
      lines.forEach((line, i) => context.fillText(line, width / 2, 1040 + i * 64))
      context.fillStyle = '#58765d'; context.font = '38px KaiTi, serif'; context.fillText('慢慢浇灌，慢慢生长', width / 2, 1320)
      context.font = '27px KaiTi, serif'; context.fillText(cups == null ? '清泉的这一页，先温柔留白' : `为身体浇灌了 ${cups} 杯清泉`, width / 2, 1394)
      if (cups != null) { context.font = '19px serif'; context.fillText('依饮水记录折算 · 每杯 250 mL', width / 2, 1440) }
      context.fillStyle = '#8c7156'; context.font = '29px KaiTi, serif'; context.fillText('每一道起伏，都是生活的痕迹。', width / 2, 1565)
      context.fillText('愿你三餐有暖，心中有光。', width / 2, 1630)
      if (journey.letter) {
        context.font = '24px KaiTi, serif'
        const chars = Array.from(journey.letter)
        for (let i = 0; i < Math.min(5, Math.ceil(chars.length / 24)); i++) context.fillText(chars.slice(i * 24, i * 24 + 24).join(''), width / 2, 1710 + i * 40, 610)
      }
      if (qr) {
        // Keep the original QR and its quiet zone intact; the postmark surrounds it.
        context.fillStyle = '#fff'; context.fillRect(257, 1917, 236, 236); context.drawImage(qr, 275, 1935, 200, 200)
        context.strokeStyle = '#c4a484'; context.lineWidth = 3; context.setLineDash([5, 5]); context.strokeRect(244, 1904, 262, 262); context.setLineDash([])
        context.fillStyle = '#806344'; context.font = '23px KaiTi, serif'; context.fillText('扫码打开食探', width / 2, 2220)
      }
      context.fillStyle = '#a38461'; context.font = '28px KaiTi, serif'; context.fillText('食探', width / 2, 2310)
      const exported = await Taro.canvasToTempFilePath({ canvas: canvas as unknown as NonNullable<Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas']>, fileType: 'jpg', quality: .95, destWidth: width, destHeight: height })
      if (valid()) setImage(exported.tempFilePath)
    } catch (reason) { if (valid()) setError(reason instanceof Error ? reason.message : '海报生成失败，请重试。') }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  const share = async () => {
    if (!image || !valid()) return
    try { await Taro.showShareImageMenu({ path: image }) }
    catch (reason) { if (!isShowShareImageMenuCancel(reason as { errMsg?: string })) setError('当前环境无法打开分享菜单，可保存图片后发送到朋友圈。') }
  }
  const save = async () => {
    if (!image || !valid()) return
    try { await Taro.saveImageToPhotosAlbum({ filePath: image }); Taro.showToast({ title: '已保存到相册', icon: 'success' }) }
    catch { setError('尚未保存。请允许相册权限，或长按预览图片保存。') }
  }
  useEffect(() => {
    const input = JSON.stringify([photos?.counts, cups, recipient, journey.letter, withQR])
    if (busy || generatedInput.current === input) return
    const timer = setTimeout(() => { generatedInput.current = input; void generate() }, 250)
    return () => clearTimeout(timer)
  }, [photos, cups, recipient, journey.letter, withQR, busy])
  return <View className='recap-share journal-share' role='dialog' aria-label='生活纪念长图'>
    <View className='recap-share__bar'><Text>{recipient?.trim() || '亲爱的朋友'}的{kind === 'year' ? '年报' : kind === 'month' ? '月报' : '周报'}</Text></View>
    <View className='recap-share__preview'>{image ? <Image src={image} mode='aspectFit' showMenuByLongpress onLongPress={() => { void Taro.previewImage({ current: image, urls: [image] }) }} /> : busy ? <View className='recap-share__spinner' /> : <View role='button' onClick={generate}><Text>展开纪念长卷</Text></View>}</View>
    <Text className='recap-share__note'>长按放大 · 邮戳二维码打开食探</Text>
    {error && <View className='recap-share__error'><Text>{error}</Text><View role='button' onClick={generate}>轻点重试</View>{withQR && <View role='button' onClick={() => { setWithQR(false); setError(''); setImage('') }}>先保存不含二维码的版本</View>}</View>}
    {image && <View className='recap-share__actions'><View role='button' onClick={save}>保存图片</View><View role='button' onClick={share}>分享给朋友</View></View>}
    <View role='button' className='journal-shelf-return' onClick={onShelf || onClose}>放入书架</View>
    <Canvas type='2d' id='recapShareCanvas' className='recap-share__canvas' />
  </View>
}
