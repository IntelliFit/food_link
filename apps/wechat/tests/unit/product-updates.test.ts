import Taro from '@tarojs/taro'
import { ProductUpdatePrompt, pendingProductUpdates, PRODUCT_UPDATE_GUEST_KEY } from '../../src/utils/product-updates'

const notice = { id: 'update-1', title: '新功能上线', content: '可以邀请好友一起吃饭了。' }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const ok = (data: unknown) => ({ statusCode: 200, data: { code: 0, message: 'ok', data }, header: {} })

describe('product update confirmation through the real API envelope', () => {
  let storage: Record<string, unknown>
  let prompt: ProductUpdatePrompt | undefined
  beforeEach(() => {
    jest.clearAllMocks()
    storage = { access_token: 'token-a', user_id: 'user-a' }
    ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage[key])
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => { storage[key] = value })
  })
  afterEach(() => { prompt?.dispose(); prompt = undefined })

  it('keeps the dialog open until explicit confirmation and prevents duplicate prompts', async () => {
    let confirm: (result: { confirm: boolean; cancel: boolean }) => void = () => {}
    ;(Taro.request as jest.Mock).mockImplementation(options => Promise.resolve(ok(options.method === 'POST' ? { success: true } : { items: [notice] })))
    ;(Taro.showModal as jest.Mock).mockImplementation(() => new Promise(resolve => { confirm = resolve }))
    prompt = new ProductUpdatePrompt()
    prompt.check(); prompt.check(); prompt.show()
    await tick()
    expect(Taro.showModal).toHaveBeenCalledTimes(1)
    expect(Taro.showModal).toHaveBeenCalledWith(expect.objectContaining({ showCancel: false, confirmText: '我知道了', content: notice.content }))
    expect((Taro.request as jest.Mock).mock.calls.some(([o]) => o.method === 'POST')).toBe(false)
    confirm({ confirm: true, cancel: false }); await tick()
    const posts = (Taro.request as jest.Mock).mock.calls.filter(([o]) => o.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0][0]).toMatchObject({ header: { Authorization: 'Bearer token-a' }, data: { app_version: expect.any(String) } })
  })

  it('retries a failed receipt without discarding or advancing the notice', async () => {
    let postCount = 0
    ;(Taro.request as jest.Mock).mockImplementation(options => {
      if (options.method === 'POST' && ++postCount === 1) return Promise.resolve({ statusCode: 503, data: { message: '服务暂不可用' } })
      return Promise.resolve(ok(options.method === 'POST' ? { success: true } : { items: [notice, { ...notice, id: 'update-2', title: '第二条更新' }] }))
    })
    ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true, cancel: false })
    prompt = new ProductUpdatePrompt(); prompt.check(); await tick(); await tick()
    expect((Taro.showModal as jest.Mock).mock.calls.map(([o]) => o.title)).toEqual([notice.title, notice.title, '第二条更新'])
    expect((Taro.showModal as jest.Mock).mock.calls[1][0].content).toContain('确认未保存')
    expect(postCount).toBe(3)
  })

  it('never writes a receipt for a dismissed dialog or a changed account', async () => {
    let confirm: (value: { confirm: boolean; cancel: boolean }) => void = () => {}
    ;(Taro.request as jest.Mock).mockResolvedValue(ok({ items: [notice] }))
    ;(Taro.showModal as jest.Mock).mockImplementation(() => new Promise(resolve => { confirm = resolve }))
    prompt = new ProductUpdatePrompt(); prompt.check(); await tick()
    confirm({ confirm: false, cancel: true }); await tick()
    expect(Taro.showModal).toHaveBeenCalledTimes(2)
    storage.access_token = 'token-b'; storage.user_id = 'user-b'
    prompt.hide()
    confirm({ confirm: true, cancel: false }); await tick()
    expect((Taro.request as jest.Mock).mock.calls.some(([o]) => o.method === 'POST')).toBe(false)
  })

  it('persists guest confirmation on this device and does not suppress a logged-in user', async () => {
    storage = {}
    ;(Taro.request as jest.Mock).mockResolvedValue(ok({ items: [notice] }))
    ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true, cancel: false })
    prompt = new ProductUpdatePrompt(); prompt.check(); await tick()
    expect(storage[PRODUCT_UPDATE_GUEST_KEY]).toEqual([notice.id])
    expect(await pendingProductUpdates()).toEqual([])
    storage.access_token = 'token-b'; storage.user_id = 'user-b'
    expect(await pendingProductUpdates()).toEqual([notice])
    expect((Taro.request as jest.Mock).mock.calls.some(([o]) => o.method === 'POST')).toBe(false)
  })

  it('keeps failed fetches pending and checks again on the next foreground', async () => {
    ;(Taro.request as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(ok({ items: [notice] }))
    ;(Taro.showModal as jest.Mock).mockImplementation(() => new Promise(() => {}))
    prompt = new ProductUpdatePrompt(); prompt.check(); await tick()
    expect(Taro.showModal).not.toHaveBeenCalled()
    prompt.hide(); prompt.show(); await tick()
    expect(Taro.showModal).toHaveBeenCalledTimes(1)
  })
})
