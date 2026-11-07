import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyGrowthDeferrals } from '../app/core/growth/scheduling.ts'

test('held targets are deferred and reappear after the ordinary dictionary cursor has passed them', () => {
  const words = ['coat', 'ticket', 'book', 'apple', 'chair'].map(word => ({ word }))
  const original = { new: words.slice(0, 4), review: [words[0]] }
  const held = applyGrowthDeferrals(original, words, ['coat', 'ticket'], new Set(['coat', 'ticket']), new Set(), 4)
  assert.deepEqual(
    held.new.map(w => w.word),
    ['book', 'apple']
  )
  assert.deepEqual(held.review, [])
  const afterCursorMoved = applyGrowthDeferrals(
    { new: [words[4]], review: [words[0]] },
    words,
    ['coat', 'ticket'],
    new Set(),
    new Set(['ticket']),
    2
  )
  assert.deepEqual(
    afterCursorMoved.new.map(w => w.word),
    ['coat', 'chair']
  )
  assert.deepEqual(afterCursorMoved.review, [])
  assert.equal(original.new.length, 4)
})

test('unregistered held new words stay in ordinary tasks so an unavailable ledger cannot lose them', () => {
  const words = [{ word: 'coat' }]
  assert.deepEqual(
    applyGrowthDeferrals({ new: words, review: [] }, words, [], new Set(['coat']), new Set(), 20).new,
    words
  )
})
