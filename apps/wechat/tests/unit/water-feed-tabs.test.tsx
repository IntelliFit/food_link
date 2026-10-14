import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { WaterFeedTabs } from '../../src/pages/community/components/WaterFeedTabs'

it('keeps scope selection and publishing as separate actions in the feed toolbar', () => {
  const select = jest.fn(), publish = jest.fn()
  const { rerender } = render(<WaterFeedTabs scope='public' onSelect={select} onPublish={publish} />)
  expect(screen.getByRole('button', { name: '发现' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '关注' }))
  expect(select).toHaveBeenCalledWith('priority')
  expect(publish).not.toHaveBeenCalled()
  rerender(<WaterFeedTabs scope='priority' onSelect={select} onPublish={publish} />)
  expect(screen.getByRole('button', { name: '关注' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '发布动态' }))
  expect(publish).toHaveBeenCalledTimes(1)
  expect(select).toHaveBeenCalledTimes(1)
})
