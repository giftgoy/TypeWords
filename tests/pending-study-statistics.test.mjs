import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pendingStudyRows } from '../app/core/utils/pending-study-statistics.ts'

test('unfinished study is visible without counting scheduled words as learned', () => {
  const startDate = new Date(2026, 10, 4, 9).getTime()
  const rows = pendingStudyRows({ startDate, spend: 60000, total: 5, newWordNumber: 5, wrong: 1 }, 'CET-4')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].spend, 60000)
  assert.equal(rows[0].pending, true)
  assert.equal(rows[0].total, 0)
  assert.equal(rows[0].wrong, 1)
  assert.deepEqual(pendingStudyRows(null, ''), [])
})

test('multi-day unfinished sessions retain daily duration without duplicating errors', () => {
  const first = new Date(2026, 10, 3, 23, 59).getTime()
  const second = new Date(2026, 10, 4, 9).getTime()
  const rows = pendingStudyRows({ spend: 90000, segments: [[first, first + 30000], [second, second + 60000]], wrong: 2 }, 'CET-4')
  assert.deepEqual(rows.map(row => row.spend), [30000, 60000])
  assert.equal(rows.reduce((sum, row) => sum + row.wrong, 0), 2)
})
