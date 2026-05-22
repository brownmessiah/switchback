/**
 * FAQPage JSON-LD per ADR-0013. Composed into activity-city collection
 * pages, Experience detail pages, and city landing pages whenever
 * editorial content surfaces an FAQ block.
 *
 * Question text MUST NOT contain HTML — schema.org's FAQPage spec
 * requires plain text. Answer text supports HTML but the renderer
 * passes through whatever the editor wrote; we validate at the
 * boundary that question and answer strings are non-empty.
 */

export interface FaqItem {
  question: string
  answer: string
}

export interface FaqPageJsonLd {
  '@context': 'https://schema.org'
  '@type': 'FAQPage'
  mainEntity: Array<{
    '@type': 'Question'
    name: string
    acceptedAnswer: {
      '@type': 'Answer'
      text: string
    }
  }>
}

export function faqPage(items: FaqItem[]): FaqPageJsonLd {
  if (items.length === 0) {
    throw new Error('faqPage requires at least one FAQ item')
  }
  for (const item of items) {
    if (!item.question.trim()) {
      throw new Error('faqPage question must be non-empty')
    }
    if (!item.answer.trim()) {
      throw new Error('faqPage answer must be non-empty')
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}
