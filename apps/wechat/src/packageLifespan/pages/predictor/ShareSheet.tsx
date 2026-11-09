import { Button, Canvas, Image, ScrollView, Switch, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { isShowShareImageMenuCancel } from '../../../utils/weapp-share-image'
import type { PosterContent, ShareOptions } from '../../model/share'
import { loadPosterAssets, POSTER_CANVAS_ID, renderLifespanPoster, type PosterAssets } from './poster'

interface ShareSheetProps {
  build: (options: ShareOptions) => PosterContent
  onClose: () => void
}

export function ShareSheet({ build, onClose }: ShareSheetProps) {
  const [options, setOptions] = useState<ShareOptions>({ showWeight: false, showAge: false })
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const generation = useRef(0)
  const assets = useRef<Promise<PosterAssets> | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    generation.current += 1
    const id = generation.current
    setImage('')
    setError('')
    // Toggling quickly must not let an older card draw over a newer one on the shared canvas.
    queue.current = queue.current
      .then(async () => {
        if (id !== generation.current) return
        assets.current = assets.current ?? loadPosterAssets()
        const path = await renderLifespanPoster(await assets.current, build(options))
        if (id === generation.current) setImage(path)
      })
      .catch((reason: Error) => {
        assets.current = null
        if (id === generation.current) setError(reason.message || '分享图未生成，请重试。')
      })
    // build is recreated by the parent on every render; the card only changes with the options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options])

  useEffect(() => () => { generation.current += 1 }, [])

  const send = async (save: boolean) => {
    if (!image || sending) return
    setSending(true)
    try {
      if (save) {
        await Taro.saveImageToPhotosAlbum({ filePath: image })
        void Taro.showToast({ title: '已保存到相册', icon: 'success' })
      } else {
        await Taro.showShareImageMenu({ path: image })
      }
    } catch (reason) {
      if (!isShowShareImageMenuCancel(reason as { errMsg?: string })) {
        void Taro.showToast({ title: save ? '请允许保存到相册后重试' : '分享未完成，可先保存图片', icon: 'none' })
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <View className='lp-sheet' catchMove>
      <View className='lp-sheet__mask' onClick={onClose} />
      <View className='lp-sheet__body' role='dialog' aria-label='分享卡片预览'>
        <View className='lp-sheet__head'>
          <Text className='lp-sheet__title'>分享卡片预览</Text>
          <Button className='lp-btn lp-btn--small lp-btn--line' onClick={onClose}>返回</Button>
        </View>
        <ScrollView scrollY className='lp-sheet__scroll'>
        <View className='lp-poster'>
          {image ? <Image src={image} mode='widthFix' className='lp-poster__image' showMenuByLongpress /> : !error && <View className='lp-spinner' aria-label='正在生成分享图' />}
          {error && <Text className='lp-error'>{error}</Text>}
        </View>
        <View className='lp-option'>
          <Text>显示体重</Text>
          <Switch checked={options.showWeight} color='#00bc7d' onChange={(e) => setOptions(prev => ({ ...prev, showWeight: e.detail.value }))} />
        </View>
        <View className='lp-option'>
          <Text>显示年龄</Text>
          <Switch checked={options.showAge} color='#00bc7d' onChange={(e) => setOptions(prev => ({ ...prev, showAge: e.detail.value }))} />
        </View>
        <Text className='lp-fine'>默认不含体重和年龄，人物体型也不随体重变化。先看完整图片，再决定是否发送。</Text>
        </ScrollView>
        <View className='lp-row'>
          <Button className='lp-btn lp-btn--line lp-grow' disabled={!image || sending} onClick={() => void send(true)}>保存图片</Button>
          <Button className='lp-btn lp-grow' disabled={!image || sending} onClick={() => void send(false)}>分享给朋友</Button>
        </View>
      </View>
      <Canvas type='2d' id={POSTER_CANVAS_ID} className='lp-poster__canvas' />
    </View>
  )
}
