import { render } from '@testing-library/react'
import PetThinking from '../../src/components/PetThinking'

jest.mock('../../src/components/PetAvatar', () => ({
  PetAvatar: ({ pet }: { pet?: { name?: string } }) => (pet ? <div data-testid='pet-avatar'>{pet.name || 'default'}</div> : null),
}))

describe('PetThinking', () => {
  it('says the newest step and lists earlier ones as done', () => {
    const { container, getByTestId } = render(<PetThinking pet={{ name: '团子' }} steps={['在找你附近开着的店…', '在算你今天还差多少营养…']} />)
    expect(container.querySelector('.pet-thinking__bubble')?.textContent).toBe('在算你今天还差多少营养…')
    expect(container.querySelector('.pet-thinking__done')?.textContent).toContain('在找你附近开着的店')
    expect(container.querySelector('.pet-thinking__done')?.textContent).not.toContain('…')
    expect(getByTestId('pet-avatar').textContent).toBe('团子')
  })

  it('shows the default partner before the user’s partner has loaded', () => {
    const { getByTestId } = render(<PetThinking pet={null} steps={['在找你附近开着的店…']} />)
    expect(getByTestId('pet-avatar').textContent).toBe('default')
  })

  it('shows only the words when the user hid the partner', () => {
    const { container, queryByTestId } = render(<PetThinking steps={['在找你附近开着的店…']} hidePet size='chat' />)
    expect(queryByTestId('pet-avatar')).toBeNull()
    expect(container.querySelector('.pet-thinking--chat')).not.toBeNull()
    expect(container.querySelector('.pet-thinking__done')).toBeNull()
  })
})
