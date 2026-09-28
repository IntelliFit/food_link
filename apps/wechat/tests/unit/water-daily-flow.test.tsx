import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { WaterDailyFlow, waterFlowDays } from '../../src/components/WaterDailyFlow'

describe('water daily records', () => {
  const days = [{ date: '2026-09-27', calories: 1640 }, { date: '2026-09-28', calories: 0 }]
  it('fills calendar gaps across month boundaries without fabricating intake', () => {
    const result = waterFlowDays('2026-03-03', [{ date: '2026-02-27', calories: 1230 }])
    expect(result.map(day => day.date)).toEqual(['2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03'])
    expect(result[2].calories).toBe(1230)
    expect(result[3].calories).toBeNull()
  })
  it('selects an actual day, preserves water-only records, and delegates recording', () => {
    const record = jest.fn()
    render(<WaterDailyFlow endDate='2026-09-28' days={days} water={[{ date: '2026-09-28', total: 850 }]} onRecord={record} />)
    expect(screen.getByText('850 ml')).toBeInTheDocument()
    expect(screen.getByText('暂无记录')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2026-09-27，有记录，查看详情' }))
    expect(screen.getByText('1640 kcal')).toBeInTheDocument()
    expect(screen.queryByText('850 ml')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2026-09-27，有记录，查看详情' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /回首页记录/ }))
    expect(record).toHaveBeenCalledTimes(1)
  })
  it('does not expose cached records to guests and reconciles a different date range', () => {
    const { rerender } = render(<WaterDailyFlow endDate='2026-09-28' days={days} guest onRecord={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '2026-09-27，暂无记录，查看详情' }))
    expect(screen.queryByText('1640 kcal')).not.toBeInTheDocument()
    rerender(<WaterDailyFlow endDate='2026-08-28' days={[]} onRecord={jest.fn()} />)
    expect(screen.getByText('08 / 28')).toBeInTheDocument()
    expect(screen.getAllByText('暂无记录')).toHaveLength(2)
  })
  it('rejects invalid, negative and non-finite values instead of rendering misleading numbers', () => {
    expect(waterFlowDays('2026-09-28', [{ date: '2026-09-28', calories: NaN }], [{ date: '2026-09-28', total: -2 }])[6]).toEqual({ date: '2026-09-28', calories: null, waterMl: null })
  })
})
