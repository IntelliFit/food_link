import { fireEvent, render } from '@testing-library/react'
import { ExerciseActivityCards } from '../../src/pages/community/components/ExerciseActivityCards'

function makeItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `运动${i + 1}`,
    duration_min: 30,
    calories_kcal: 100 + i,
  }))
}

describe('ExerciseActivityCards', () => {
  it('renders all items when count is less than or equal to 3', () => {
    const { container, queryByText } = render(<ExerciseActivityCards items={makeItems(3)} />)
    expect(container.querySelectorAll('.feed-exercise-activity-card').length).toBe(3)
    expect(queryByText(/更多/)).toBeNull()
  })

  it('collapses to 3 items and expands on "更多" click', () => {
    const { container, getByText, queryByText } = render(<ExerciseActivityCards items={makeItems(5)} />)
    expect(container.querySelectorAll('.feed-exercise-activity-card').length).toBe(3)
    expect(getByText('更多 2 项运动')).toBeInTheDocument()

    fireEvent.click(getByText('更多 2 项运动'))
    expect(container.querySelectorAll('.feed-exercise-activity-card').length).toBe(5)
    expect(queryByText('更多 2 项运动')).toBeNull()
    expect(getByText('收起')).toBeInTheDocument()

    fireEvent.click(getByText('收起'))
    expect(container.querySelectorAll('.feed-exercise-activity-card').length).toBe(3)
    expect(getByText('更多 2 项运动')).toBeInTheDocument()
  })

  it('renders nothing for empty items', () => {
    const { container } = render(<ExerciseActivityCards items={[]} />)
    expect(container.querySelectorAll('.feed-exercise-activity-card').length).toBe(0)
  })
})
