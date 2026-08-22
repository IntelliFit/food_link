import { appendBoundedUnique, getFeedPageRequest, getLatestFeedCursor } from '../../src/utils/list-pagination'

describe('bounded list pagination', () => {
  it('caps accumulated items without duplicating existing keys', () => {
    const result = appendBoundedUnique(
      [{ id: '1' }, { id: '2' }],
      [{ id: '2' }, { id: '3' }, { id: '4' }],
      (item) => item.id,
      3,
    )

    expect(result.list.map((item) => item.id)).toEqual(['1', '2', '3'])
    expect(result.added).toBe(1)
    expect(result.reachedLimit).toBe(true)
  })

  it('builds a stable latest-feed cursor from the last item', () => {
    expect(getLatestFeedCursor([
      { target_type: 'food_record', target_id: 'r2', record: { id: 'r2', created_at: '2026-08-22T08:00:00Z' } },
      { target_type: 'circle_post', target_id: 'p1', record: { id: 'p1', created_at: '2026-08-22T07:00:00Z' } },
    ])).toEqual({
      before_time: '2026-08-22T07:00:00Z',
      before_key: 'circle_post:p1',
    })
  })

  it('preserves sub-millisecond precision in the server timestamp', () => {
    expect(getLatestFeedCursor([
      { target_type: 'food_record', target_id: 'r1', record: { created_at: '2026-08-22T07:00:00.123456Z' } },
    ])).toEqual({
      before_time: '2026-08-22T07:00:00.123456Z',
      before_key: 'food_record:r1',
    })
  })

  it('resets refreshes to the first page and uses the latest cursor only for load more', () => {
    const cursor = {
      before_time: '2026-08-22T07:00:00.000Z',
      before_key: 'circle_post:p1',
    }

    expect(getFeedPageRequest('latest', cursor, 40, true)).toEqual({ cursor: null, offset: 0 })
    expect(getFeedPageRequest('latest', cursor, 40, false)).toEqual({ cursor, offset: 0 })
    expect(getFeedPageRequest('hot', cursor, 40, false)).toEqual({ cursor: null, offset: 40 })
  })
})
