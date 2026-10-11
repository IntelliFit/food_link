import { act, render, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { CurrentPetCompanion } from '../../src/components/CurrentPetCompanion'
import { getAccessToken, getPetSummary, type PetProfile } from '../../src/utils/api'
import { HOME_COMPANION_PREFERENCE_KEY, ORIGINAL_COMPANION_SRC, JIANWEN_COMPANION_SRC } from '../../src/utils/pet-companion-preference'

jest.mock('../../src/utils/api', () => ({ getAccessToken: jest.fn(), getPetSummary: jest.fn() }))
const pet = { id: 'a', name: '鬼鬼', builtin_avatar_id: 'jianwen-01' } as PetProfile
let owner: string
let choice: string
beforeEach(() => {
  jest.clearAllMocks(); owner = 'owner-a'; choice = 'original'
  ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => key === 'user_id' ? owner : key === `${HOME_COMPANION_PREFERENCE_KEY}:${owner}` ? { enabledOriginal: true, selected: choice } : '')
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet })
})

test('report companion follows the approved original, not the nickname or red cloud template', async () => {
  const { container } = render(<CurrentPetCompanion />)
  await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', ORIGINAL_COMPANION_SRC))
})

test('a selected Jianwen uses its red companion sheet in reports', async () => {
  choice = 'follow'
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { ...pet, name: '健文伙伴' } })
  const { container } = render(<CurrentPetCompanion />)
  await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', JIANWEN_COMPANION_SRC))
})

test('a late previous account response cannot display the wrong report character', async () => {
  let resolve!: (value: { pet: PetProfile }) => void
  ;(getPetSummary as jest.Mock).mockReturnValueOnce(new Promise(done => { resolve = done }))
  const { container, rerender } = render(<CurrentPetCompanion />)
  owner = 'owner-b'; choice = 'follow'
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { ...pet, id: 'b' } })
  rerender(<CurrentPetCompanion />)
  await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', JIANWEN_COMPANION_SRC))
  await act(async () => { resolve({ pet }); await Promise.resolve() })
  expect(container.querySelector('img')).toHaveAttribute('src', JIANWEN_COMPANION_SRC)
})

test('missing account or failed profile never substitutes an arbitrary character', async () => {
  ;(getAccessToken as jest.Mock).mockReturnValue('')
  const { container, rerender } = render(<CurrentPetCompanion />)
  expect(getPetSummary).not.toHaveBeenCalled()
  expect(container.querySelector('img')).toBeNull()
  ;(getAccessToken as jest.Mock).mockReturnValue('test-token')
  ;(getPetSummary as jest.Mock).mockRejectedValue(new Error('offline'))
  rerender(<CurrentPetCompanion />)
  await act(async () => { await Promise.resolve() })
  expect(container.querySelector('img')).toBeNull()
  ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: null })
  rerender(<CurrentPetCompanion active={false} />)
  rerender(<CurrentPetCompanion />)
  await act(async () => { await Promise.resolve() })
  expect(container.querySelector('img')).toBeNull()
})
