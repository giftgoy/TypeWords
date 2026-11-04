import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { annotationLanes } from '../app/core/immersive/annotations.ts'

test('three overlapping glosses get separate lanes and reuse available lanes', () => {
  assert.deepEqual(annotationLanes([
    { top: 20, left: 0, right: 100 },
    { top: 20, left: 30, right: 130 },
    { top: 20, left: 60, right: 160 },
    { top: 20, left: 103, right: 180 },
    { top: 80, left: 0, right: 100 },
  ]), [0, 1, 2, 0, 0])
  assert.deepEqual(annotationLanes([]), [])
})
import {
  lemmaCandidates,
  pickLemma,
  normalizeToken,
} from '../app/core/immersive/lemmatize.ts'

test('token normalization folds case, curly apostrophes and edge punctuation', () => {
  assert.equal(normalizeToken('Studies,'), 'studies')
  assert.equal(normalizeToken('“Lin’s”'), 'lin’s'.replace('’', "'"))
  assert.equal(normalizeToken('  Flat  '), 'flat')
  assert.equal(normalizeToken('A1'), 'a')
})

test('regular inflections map back to dictionary lemmas', () => {
  const has = (set) => (w) => set.includes(w)
  assert.equal(pickLemma('studies', has(['study'])), 'study')
  assert.equal(pickLemma('studied', has(['study'])), 'study')
  assert.equal(pickLemma('studying', has(['study'])), 'study')
  assert.equal(pickLemma('stopped', has(['stop'])), 'stop')
  assert.equal(pickLemma('running', has(['run'])), 'run')
  assert.equal(pickLemma('making', has(['make'])), 'make')
  assert.equal(pickLemma('hoped', has(['hope'])), 'hope')
  assert.equal(pickLemma('quickly', has(['quick'])), 'quick')
  assert.equal(pickLemma('happier', has(['happy'])), 'happy')
})

test('irregular forms and contractions are resolved before suffix rules', () => {
  assert.equal(pickLemma('went', w => w === 'go'), 'go')
  assert.equal(pickLemma('children', w => w === 'child'), 'child')
  assert.equal(pickLemma("it's", w => w === 'it'), 'it')
  assert.equal(pickLemma("don't", w => w === 'do'), 'do')
  assert.equal(pickLemma("Lin's", w => w === 'lin'), 'lin')
  assert.equal(pickLemma('flats', w => w === 'flat'), 'flat')
})

test('candidates are deduplicated and never invent a lemma for short words', () => {
  const words = lemmaCandidates('is')
  assert.equal(words[0], 'is')
  assert.equal(new Set(words).size, words.length)
  assert.deepEqual(lemmaCandidates('.'), [])
  assert.deepEqual(lemmaCandidates(''), [])
})

test('generated CET-4 gloss index keeps the shape the reader relies on', () => {
  const file = JSON.parse(
    readFileSync(new URL('../public/dicts/en/word/cet4-gloss.json', import.meta.url), 'utf8')
  )
  assert.equal(file.v, 1)
  assert.ok(file.count > 2000, `expected a few thousand words, got ${file.count}`)
  assert.equal(Object.keys(file.words).length, file.count)

  const flat = file.words.flat
  assert.ok(flat, 'flat should be indexed')
  assert.ok(flat.t.length > 0, 'entries need a short translation')
  assert.ok(Array.isArray(flat.ph) && flat.ph.length > 0, 'flat should carry phrases')
  for (const [phrase, cn] of flat.ph) {
    assert.equal(typeof phrase, 'string')
    assert.equal(typeof cn, 'string')
    assert.ok(phrase.split(' ').length >= 2, 'only multi-word phrases belong in the index')
  }

  // 索引只覆盖四级词（不含 water 这类基础词），提醒后续不要按“覆盖所有单词”理解
  assert.equal(file.words.water, undefined)
})
