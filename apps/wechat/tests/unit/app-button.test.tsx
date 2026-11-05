import { fireEvent, render, screen } from '@testing-library/react'

import { AppButton } from '../../src/components/AppButton'

describe('AppButton', () => {
  it('keeps the class names the replaced pages style', () => {
    render(<AppButton className='card-next-btn' color='primary' shape='round' block>下一步</AppButton>)
    const button = screen.getByRole('button')
    expect(button.className).toBe('app-btn app-btn--contained app-btn--primary app-btn--round app-btn--block card-next-btn')
    expect(screen.getByRole('button', { name: '下一步' })).toBeInTheDocument()
  })

  it('does not fire while disabled or loading', () => {
    const onClick = jest.fn()
    const { rerender } = render(<AppButton disabled onClick={onClick}>提交</AppButton>)
    fireEvent.click(screen.getByRole('button'))
    rerender(<AppButton loading onClick={onClick}>提交</AppButton>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button').className).toContain('app-btn--loading')

    rerender(<AppButton onClick={onClick}>提交</AppButton>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('adds a native button only when it has to submit a form', () => {
    const { container, rerender } = render(<AppButton>普通</AppButton>)
    expect(container.querySelector('.app-btn__native')).toBeNull()
    rerender(<AppButton formType='submit'>下一步</AppButton>)
    expect(container.querySelector('.app-btn__native')).not.toBeNull()
  })
})
