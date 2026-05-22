import { describe, expect, it } from 'vitest'

import { db } from './client'

describe('db client', () => {
  it('exports a Drizzle handle', () => {
    expect(db).toBeDefined()
  })

  it('exposes the canonical Drizzle query methods', () => {
    expect(typeof db.select).toBe('function')
    expect(typeof db.insert).toBe('function')
    expect(typeof db.update).toBe('function')
    expect(typeof db.delete).toBe('function')
    expect(typeof db.transaction).toBe('function')
  })
})
