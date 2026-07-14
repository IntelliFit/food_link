import { render } from '@testing-library/react'
import { PetMarkdown } from '../../src/packageExtra/pages/pet-chat/pet-markdown'

describe('PetMarkdown', () => {
  it('renders single, double, and triple asterisk emphasis without exposing markers', () => {
    const { container } = render(
      <PetMarkdown text='*先补一份主食*，**再补蛋白质**，***连续观察三天***。' />
    )

    expect(container).toHaveTextContent('先补一份主食，再补蛋白质，连续观察三天。')
    expect(container.textContent).not.toContain('*')
  })

  it('renders Markdown list markers as bullets instead of raw asterisks', () => {
    const { container } = render(<PetMarkdown text={'* 第一项\n* 第二项'} />)

    expect(container).toHaveTextContent('•第一项')
    expect(container).toHaveTextContent('•第二项')
    expect(container.textContent).not.toContain('*')
  })
})
