import { describe, expect, it } from 'vitest'

describe('vitest sanity', () => {
  it('arithmetic still works', () => {
    expect(2 + 2).toBe(4)
  })

  it('async resolves', async () => {
    const value = await Promise.resolve('ok')
    expect(value).toBe('ok')
  })
})
