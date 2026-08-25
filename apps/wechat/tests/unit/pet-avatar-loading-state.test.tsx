import { fireEvent, render, screen } from '@testing-library/react'
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

  it('falls back to the generated avatar when a bundled image cannot load', () => {
    const { container } = render(
      <PetAvatar
        pet={{
          pet_seed: 'huatuo-seed',
          name: '华佗',
          avatar_type: 'builtin_person',
          builtin_avatar_id: 'huatuo-01',
        } as any}
        size={67}
      />,
    )

    const image = container.querySelector('img')
    expect(image).toHaveAttribute('src', '/assets/pets/huatuo-01.png')

    fireEvent.error(image as HTMLImageElement)

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    )
  })
})
