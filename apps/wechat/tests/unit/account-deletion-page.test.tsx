import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import AccountDeletionPage from '../../src/packageExtra/pages/account-deletion'
import { cancelAccountDeletion, deleteAccount, getAccountDeletionStatus } from '../../src/utils/api'

jest.mock('../../src/utils/api', () => ({
  cancelAccountDeletion: jest.fn(), clearAllStorage: jest.fn(), deleteAccount: jest.fn(),
  getAccountDeletionStatus: jest.fn(), showUnifiedApiError: jest.fn(),
}))
jest.mock('../../src/utils/withAuth', () => ({ withAuth: (page: unknown) => page }))
jest.mock('../../src/components/FlPageThemeRoot', () => ({ FlPageThemeRoot: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Button: ({ children, ...props }: any) => React.createElement('button', props, children),
    Input: ({ onInput, ...props }: any) => React.createElement('input', { ...props, onChange: (event: any) => onInput({ detail: { value: event.target.value } }) }),
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => React.useEffect(() => { callback() }, []))
  ;(getAccountDeletionStatus as jest.Mock).mockResolvedValue({ state: 'active', can_cancel: false })
  ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: true })
})

it('defaults to seven days and requires typing confirmation', async () => {
  ;(deleteAccount as jest.Mock).mockResolvedValue({ status: { state: 'pending', can_cancel: true } })
  render(<AccountDeletionPage />)
  const submit = await screen.findByText('申请注销，保留 7 天撤销机会')
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByPlaceholderText('输入“注销账号”确认'), { target: { value: '注销账号' } })
  fireEvent.click(submit)
  await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('注销账号', 7))
})

it('requires a separate confirmation to skip the cooling period', async () => {
  ;(Taro.showModal as jest.Mock).mockResolvedValue({ confirm: false })
  render(<AccountDeletionPage />)
  fireEvent.click(await screen.findByText(/立即注销，跳过冷静期/))
  fireEvent.change(screen.getByPlaceholderText('输入“注销账号”确认'), { target: { value: '注销账号' } })
  fireEvent.click(screen.getByText('确认立即注销'))
  await waitFor(() => expect(Taro.showModal).toHaveBeenCalled())
  expect(deleteAccount).not.toHaveBeenCalled()
})

it('opening pending status never cancels until the user confirms', async () => {
  ;(getAccountDeletionStatus as jest.Mock).mockResolvedValue({ state: 'pending', can_cancel: true, execute_at: '2026-11-19T12:00:00+08:00' })
  ;(cancelAccountDeletion as jest.Mock).mockResolvedValue(undefined)
  render(<AccountDeletionPage />)
  const cancel = await screen.findByText('撤销注销并恢复账号')
  expect(cancelAccountDeletion).not.toHaveBeenCalled()
  fireEvent.click(cancel)
  await waitFor(() => expect(cancelAccountDeletion).toHaveBeenCalledTimes(1))
  expect(Taro.reLaunch).toHaveBeenCalledWith({ url: '/packageExtra/pages/login/index' })
})

it('does not offer restoration once permanent cleanup starts', async () => {
  ;(getAccountDeletionStatus as jest.Mock).mockResolvedValue({ state: 'cleaning', can_cancel: false })
  render(<AccountDeletionPage />)
  await screen.findByText('正在永久清理')
  expect(screen.queryByText('撤销注销并恢复账号')).not.toBeInTheDocument()
})
