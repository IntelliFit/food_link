import { render, screen } from '@testing-library/react'
import { PetAvatar } from '../../src/components/PetAvatar'

describe('pet avatar loading state', () => {
  it('does not render a deleted fallback appearance before the current pet loads', () => {
    const { rerender } = render(<PetAvatar size={67} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    rerender(
      <PetAvatar
        pet={{
          name: '华佗',
          avatar_type: 'builtin_person',
          builtin_avatar_id: 'huatuo-01',
        } as any}
        size={67}
      />,
    )

    expect(screen.getByLabelText(/华佗/)).toBeInTheDocument()
  })
})
