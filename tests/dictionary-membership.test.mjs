import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyzeDictionaryMembership, withPersonalDictionaries } from '../app/core/immersive/dictionary-membership.ts'

const index = {
  v: 1,
  dictionaries: [
    { id: 'a', name: '四级', size: 4 },
    { id: 'b', name: '雅思', size: 3 },
  ],
  words: { study: [0, 1], go: [0], a: [0], novel: [1], hop: [0], hope: [1], saw: [0], see: [1] },
}
test('article forms preserve repetition, cross-dictionary overlap, irregulars and single-letter words', () => {
  const result = analyzeDictionaryMembership('Studies studied studied. Went! A novel, Qwerty.', index)
  assert.equal(result.tokens, 7)
  assert.equal(result.uniqueForms, 6)
  const studied = result.rows.find(r => r.form === 'studied')
  assert.equal(studied.count, 2)
  assert.deepEqual(studied.dictionaries, ['a', 'b'])
  assert.deepEqual(
    result.rows.find(r => r.form === 'went').candidates.map(c => c.lemma),
    ['go']
  )
  assert.equal(result.rows.find(r => r.form === 'a').exact, true)
  assert.equal(result.unmatchedForms, 1)
  assert.equal(result.summaries.find(s => s.id === 'a').occurrences, 5)
})
test('ambiguous derivations remain candidates and existing exact terms are not silently reinterpreted', () => {
  const result = analyzeDictionaryMembership('Hoping saw.', index)
  assert.deepEqual(
    result.rows.find(r => r.form === 'hoping').candidates.map(c => c.lemma),
    ['hop', 'hope']
  )
  assert.equal(result.rows.find(r => r.form === 'hoping').exact, false)
  assert.deepEqual(result.rows.find(r => r.form === 'saw').exactDictionaries, ['a'])
  assert.deepEqual(result.rows.find(r => r.form === 'saw').candidates, [{ lemma: 'see', dictionaries: ['b'] }])
  assert.deepEqual(analyzeDictionaryMembership('saw', index, false).rows[0].dictionaries, ['a'])
})
test('personal dictionaries add membership without mutating or duplicating the built-in index', () => {
  const copy = structuredClone(index)
  const personal = withPersonalDictionaries(index, [
    {
      id: 7,
      name: '我的词',
      custom: true,
      language: 'en',
      words: [{ word: 'STUDY' }, { word: 'study' }, { word: 'qwerty' }],
    },
  ])
  assert.equal(
    analyzeDictionaryMembership('study qwerty', personal).summaries.find(s => s.id === 'personal:7').forms,
    2
  )
  assert.deepEqual(index, copy)
})
test('shipped index covers all local English dictionaries and exact members agree with source files', () => {
  const built = JSON.parse(
    fs.readFileSync(new URL('../public/dicts/en/word/dictionary-membership.json', import.meta.url))
  )
  const catalog = JSON.parse(fs.readFileSync(new URL('../public/list/word.json', import.meta.url))).filter(
    d => d.language === 'en'
  )
  assert.equal(built.dictionaries.length, catalog.length)
  for (const [i, dict] of built.dictionaries.entries()) {
    const raw = JSON.parse(fs.readFileSync(new URL('../public/dicts/en/word/' + dict.url, import.meta.url)))
    const source = Array.isArray(raw) ? raw : raw.words
    const sample = source[Math.floor(source.length / 2)].word.toLowerCase().replace(/’/g, "'").trim()
    assert.ok(built.words[sample].includes(i), dict.name)
  }
})
