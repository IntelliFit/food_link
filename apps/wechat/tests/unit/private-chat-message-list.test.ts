import {
  mergeMessagesByID,
  orderMessagesByTime,
  type ChronologicalMessage,
} from '../../src/packageExtra/pages/private-chat/message-list'

interface TestMessage extends ChronologicalMessage {
  content: string
}

describe('private chat message list', () => {
  test('orders messages chronologically without mutating the source list', () => {
    const source: TestMessage[] = [
      { id: 'newer', created_at: '2026-07-30T12:01:00+08:00', content: 'newer' },
      { id: 'older', created_at: '2026-07-30T12:00:00+08:00', content: 'older' },
    ]

    const ordered = orderMessagesByTime(source)

    expect(ordered.map((message) => message.id)).toEqual(['older', 'newer'])
    expect(source.map((message) => message.id)).toEqual(['newer', 'older'])
  })

  test('deduplicates by id and lets the incoming message replace stale data', () => {
    const current: TestMessage[] = [
      { id: 'same', created_at: '2026-07-30T12:00:00+08:00', content: 'stale' },
      { id: 'older', created_at: '2026-07-30T11:59:00+08:00', content: 'older' },
    ]
    const incoming: TestMessage[] = [
      { id: 'same', created_at: '2026-07-30T12:00:00+08:00', content: 'fresh' },
      { id: 'newer', created_at: '2026-07-30T12:01:00+08:00', content: 'newer' },
    ]

    const merged = mergeMessagesByID(current, incoming)

    expect(merged.map((message) => message.id)).toEqual(['older', 'same', 'newer'])
    expect(merged.find((message) => message.id === 'same')?.content).toBe('fresh')
  })

  test('uses message id as a deterministic tie-breaker', () => {
    const messages: TestMessage[] = [
      { id: 'b', created_at: 'invalid', content: 'b' },
      { id: 'a', created_at: 'invalid', content: 'a' },
    ]

    expect(orderMessagesByTime(messages).map((message) => message.id)).toEqual(['a', 'b'])
  })
})
