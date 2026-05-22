import { describe, expect, it } from 'vitest'

import { faqPage } from './faq-page'

describe('faqPage JSON-LD', () => {
  it('emits a FAQPage with Question/Answer pairs', () => {
    const json = faqPage([
      {
        question: 'Is rafting in Rishikesh safe in monsoon?',
        answer: 'Operators close the upper stretches when water levels exceed the regulated threshold.',
      },
      {
        question: 'What permits are required?',
        answer: 'No special permit for Rishikesh rafting; Sikkim ILP applies for cross-border treks.',
      },
    ])
    expect(json['@context']).toBe('https://schema.org')
    expect(json['@type']).toBe('FAQPage')
    expect(json.mainEntity).toHaveLength(2)
    expect(json.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: 'Is rafting in Rishikesh safe in monsoon?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Operators close the upper stretches when water levels exceed the regulated threshold.',
      },
    })
  })

  it('throws on empty FAQs', () => {
    expect(() => faqPage([])).toThrow(/at least one/i)
  })

  it('rejects FAQs with empty questions or answers', () => {
    expect(() =>
      faqPage([{ question: '', answer: 'a' }]),
    ).toThrow(/question/i)
    expect(() =>
      faqPage([{ question: 'q', answer: '' }]),
    ).toThrow(/answer/i)
  })
})
