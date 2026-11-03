import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SIMPLE_WORDS,
  parseSimpleWords,
  buildIgnoreWordsSet,
  advanceFilteredStudyIndex,
} from '../app/core/utils/simple-word-filter.ts'

test('custom list accepts Chinese punctuation, mixed case and phrases without splitting phrase spaces', () => {
  assert.deepEqual(parseSimpleWords(' A, a，THE；\n the ; New York、look up\t I \n'), [
    'a',
    'the',
    'new york',
    'look up',
    'i',
  ])
  assert.deepEqual(parseSimpleWords([' A ', '', 'a', 'THE']), ['a', 'the'])
  assert.deepEqual(parseSimpleWords(' , ，；\n'), [])
  assert.equal(DEFAULT_SIMPLE_WORDS.length, 42)
})

test('disabling filtering restores simple words while mastered words remain excluded and lists stay intact', () => {
  const simple = [' A ', 'THE', 'look up']
  const known = ['Known', ' A ']
  const original = structuredClone({ simple, known })
  assert.deepEqual([...buildIgnoreWordsSet(simple, known, false)], ['known', 'a'])
  assert.deepEqual([...buildIgnoreWordsSet(simple, known, true)], ['known', 'a', 'the', 'look up'])
  assert.deepEqual({ simple, known }, original)
})

test('study progress advances over filtered gaps and remains idempotent when settling and continuing', () => {
  const words = ['a', 'apple', 'the', 'book', 'i', 'cat'].map((word, id) => ({ id: String(id), word }))
  const task = [words[1], words[3]]
  const ignore = buildIgnoreWordsSet(['A', 'the', 'I'], [], true)
  const next = advanceFilteredStudyIndex(words, task, 0, ignore)
  assert.equal(next, 5)
  assert.equal(advanceFilteredStudyIndex(words, task, next, ignore), 5)
  assert.equal(advanceFilteredStudyIndex(words, task, 0, new Set()), 4)
  assert.equal(advanceFilteredStudyIndex(words, [words[5]], 5, ignore), words.length)
  assert.equal(words.length, 6)
  assert.deepEqual(
    task.map(word => word.word),
    ['apple', 'book']
  )
})

test('all-filtered dictionaries finish without creating a task and duplicate spellings respect word IDs', () => {
  const allSimple = [{ word: 'A' }, { word: ' the ' }]
  assert.equal(advanceFilteredStudyIndex(allSimple, [], 0, buildIgnoreWordsSet(['a', 'the'], [], true)), 2)
  const duplicates = [
    { id: 'first', word: 'lead' },
    { id: 'second', word: 'lead' },
    { id: 'last', word: 'end' },
  ]
  assert.equal(advanceFilteredStudyIndex(duplicates, [duplicates[0]], 0, new Set()), 1)
  assert.equal(advanceFilteredStudyIndex(duplicates, [duplicates[1]], 1, new Set()), 2)
  assert.equal(advanceFilteredStudyIndex([], [], 99, new Set()), 0)
})
