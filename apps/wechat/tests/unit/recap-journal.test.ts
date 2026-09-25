import { journalBody, journalBookTitle, journalFeedPhotos, journalHealth, journalPhotos, journalSwipeTarget } from '../../src/utils/recap-journal'
import type { BodyMetricsSummary, CommunityFeedItem, FoodRecord, StatsSummary } from '../../src/utils/api'

test('photos count a China-day meal once, never library images or out-of-period photos', () => {
  const row = { id: 'one', record_time: '2026-09-07T23:30:00Z', meal_type: 'breakfast', image_path: 'https://example.com/food.jpg', entry_type: 'food_image' } as FoodRecord
  const data = journalPhotos([row, { ...row, id: 'two' }, { ...row, id: 'library', meal_type: 'lunch', entry_type: 'food_library' }, { ...row, id: 'old', record_time: '2026-09-01T01:00:00Z' }], '2026-09-08', '2026-09-13')
  expect(data.counts).toEqual({ breakfast: 1, lunch: 0, dinner: 0 })
  expect(data.images[0].date).toBe('2026-09-08')
})

test('incomplete water coverage remains unavailable; actual weights retain date spacing', () => {
  const body = { start_date: '2026-09-09', end_date: '2026-09-13', water_daily: [{ date: '2026-09-10', total: 500 }], weight_entries: [{ date: '2026-09-07', value: 62 }, { date: '2026-09-13', value: 62.1 }] } as BodyMetricsSummary
  const result = journalBody(body, '2026-09-07', '2026-09-13')
  expect(result.cups).toBeNull()
  expect(result.points.map(p => p.x)).toEqual([0, 1])
  expect(Math.abs(result.points[0].y - result.points[1].y)).toBeLessThan(.1)
  expect(journalBody({ ...body, start_date: '2026-01-01' }, '2026-09-07', '2026-09-13').cups).toBe(2)
})

test('photo preview reserves room for each meal instead of filling every slot with breakfast', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), record_time: '2026-09-08T08:00:00+08:00', meal_type: 'breakfast', image_path: 'breakfast.jpg', entry_type: 'food_image' } as FoodRecord))
  const result = journalPhotos([...rows, { ...rows[0], id: 'lunch', meal_type: 'lunch', image_path: 'lunch.jpg' }], '2026-09-07', '2026-09-13')
  expect(result.images.some(photo => photo.meal === 'lunch')).toBe(true)
  expect(result.counts).toEqual({ breakfast: 1, lunch: 1, dinner: 0 })
})

test('circle flashbacks keep personal posts separate from public inspiration', () => {
  const item = (id: string, author: string, mine: boolean, date: string, paths: string[]): CommunityFeedItem => ({
    target_type: 'circle_post', target_id: id, is_mine: mine,
    author: { id: author, nickname: mine ? '我' : '邻居', avatar: '' }, like_count: 0, liked: false,
    record: { id, user_id: author, meal_type: 'lunch', image_paths: paths, items: [], total_calories: 0, total_protein: 0, total_carbs: 0, total_fat: 0, total_weight_grams: 0, record_time: `${date}T12:00:00+08:00`, created_at: `${date}T12:00:00+08:00` },
  })
  const rows = [item('mine', 'owner', true, '2026-09-09', ['mine.jpg']), item('public', 'other', false, '2026-09-10', ['public.jpg'])]
  expect(journalFeedPhotos(rows, '2026-09-07', '2026-09-13', 'owner', 'personal').images.map(photo => photo.src)).toEqual(['mine.jpg'])
  const inspiration = journalFeedPhotos(rows, '2026-09-07', '2026-09-13', 'owner', 'community')
  expect(inspiration.images.map(photo => photo.src)).toEqual(['public.jpg'])
  expect(inspiration.images[0].author).toBe('邻居')
})

test('a health score from a different period never becomes this book stars', () => {
  const summary = { start_date: '2026-09-07', end_date: '2026-09-13', health_index: { overall_score: 80 } } as StatsSummary
  expect(journalHealth(summary, '2026-09-07', '2026-09-13')?.stars).toBe(4)
  expect(journalHealth(summary, '2026-09-14', '2026-09-20')).toBeNull()
})

test('horizontal journal gestures reject jitter and vertical interactions and respect edges', () => {
  expect(journalSwipeTarget(0, -80, 5)).toBe(1)
  expect(journalSwipeTarget(2, 100, 6)).toBe(1)
  expect(journalSwipeTarget(2, 20, 100)).toBe(2)
  expect(journalSwipeTarget(2, 25, 0)).toBe(2)
  expect(journalSwipeTarget(7, -100, 0)).toBe(7)
  expect(journalSwipeTarget(0, 100, 0)).toBe(0)
})

test('book spine uses ISO week year at a calendar-year boundary', () => {
  expect(journalBookTitle({ id: 'a', kind: 'week', anchor: '2021-01-04', start: '2020-12-28', end: '2021-01-03' })).toBe('2020年 第53周')
})
