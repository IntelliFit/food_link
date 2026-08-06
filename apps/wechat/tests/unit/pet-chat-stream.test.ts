import Taro from '@tarojs/taro'

import { streamGeneratePetChat } from '../../src/utils/api'

type RequestOptions = {
  complete?: () => void
}

type ChunkHandler = (result: { data: ArrayBuffer }) => void

function utf8Buffer(text: string): ArrayBuffer {
  return Uint8Array.from(Buffer.from(text, 'utf8')).buffer
}

describe('streamGeneratePetChat', () => {
  const originalTextDecoder = globalThis.TextDecoder
  const request = Taro.request as jest.Mock
  const getStorageSync = Taro.getStorageSync as jest.Mock

  beforeEach(() => {
    request.mockReset()
    getStorageSync.mockReset()
    getStorageSync.mockReturnValue('test-access-token')
  })

  afterEach(() => {
    jest.useRealTimers()
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      writable: true,
      value: originalTextDecoder,
    })
  })

  it('still starts the request without a global TextDecoder and decodes split Chinese chunks', () => {
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      writable: true,
      value: undefined,
    })

    let onChunkReceived: ChunkHandler | undefined
    request.mockReturnValue({
      onChunkReceived: jest.fn((handler: ChunkHandler) => {
        onChunkReceived = handler
      }),
      abort: jest.fn(),
    })

    const onChunk = jest.fn()
    const onDone = jest.fn()
    const onError = jest.fn()

    streamGeneratePetChat('最近吃得怎么样？', 'week', '', true, {
      onChunk,
      onDone,
      onError,
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(onChunkReceived).toBeDefined()

    const chunkEvent = utf8Buffer('data: {"type":"chunk","text":"你好"}\n\n')
    const bytes = new Uint8Array(chunkEvent)
    const splitAt = bytes.indexOf(0xe5) + 1
    onChunkReceived?.({ data: bytes.slice(0, splitAt).buffer })
    onChunkReceived?.({ data: bytes.slice(splitAt).buffer })
    onChunkReceived?.({
      data: utf8Buffer('data: {"type":"done","meta":{"session_id":"session-1"}}\n\n'),
    })

    expect(onChunk).toHaveBeenCalledWith('你好')
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'session-1' }))
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a synchronous request initialization failure instead of throwing', () => {
    request.mockImplementation(() => {
      throw new Error('request init failed')
    })
    const onError = jest.fn()

    expect(() =>
      streamGeneratePetChat('测试', 'week', '', true, {
        onChunk: jest.fn(),
        onDone: jest.fn(),
        onError,
      })
    ).not.toThrow()

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'request init failed' }))
  })

  it('reports an error when the connection completes without a done event', () => {
    request.mockReturnValue({
      onChunkReceived: jest.fn(),
      abort: jest.fn(),
    })
    const onError = jest.fn()

    streamGeneratePetChat('测试', 'week', '', true, {
      onChunk: jest.fn(),
      onDone: jest.fn(),
      onError,
    })

    const options = request.mock.calls[0][0] as RequestOptions
    options.complete?.()

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('未收到完整结果') })
    )
  })

  it('aborts and reports an error after the three-minute hard timeout', () => {
    jest.useFakeTimers()
    const abort = jest.fn()
    request.mockReturnValue({
      onChunkReceived: jest.fn(),
      abort,
    })
    const onError = jest.fn()

    streamGeneratePetChat('测试', 'week', '', true, {
      onChunk: jest.fn(),
      onDone: jest.fn(),
      onError,
    })
    jest.advanceTimersByTime(180000)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('回答超时') })
    )
    expect(abort).toHaveBeenCalledTimes(1)
  })
})
