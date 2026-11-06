import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createWordExampleLoader, normalizeExampleWord, wordExampleBucket, withWordExamples } from '../app/core/utils/word-examples.ts'

const example = {
  c: 'I think this coat should fit you.',
  cn: '我认为这外套应该适合你。',
  attribution: 'CC-BY 2.0 (France) Attribution: tatoeba.org #2408203 (CK) & #5931766 (verdastelo9604)',
  sourceUrl: 'https://tatoeba.org/en/sentences/show/2408203',
}

test('example keys normalize case, apostrophes and phrase spacing without matching word fragments', () => {
  assert.equal(normalizeExampleWord('  COAT '), 'coat')
  assert.equal(normalizeExampleWord('don’t   worry'), "don't worry")
  assert.equal(wordExampleBucket(' Coat '), 'c')
  assert.equal(wordExampleBucket('123'), 'other')
})

test('simultaneous words share a bucket request and unknown words remain empty', async () => {
  let calls = 0
  const load = createWordExampleLoader(async () => { calls++; return { coat: [example] } })
  assert.deepEqual(await Promise.all([load('Coat'), load('coat'), load('cat')]), [[example], [example], []])
  assert.equal(calls, 1)
  assert.deepEqual(await load('constructor'), [])
  assert.deepEqual(await load(''), [])
})

test('a failed bucket request can be retried instead of permanently caching an empty list', async () => {
  let attempts = 0
  const load = createWordExampleLoader(async () => {
    if (++attempts === 1) throw new Error('offline')
    return { coat: [example] }
  })
  await assert.rejects(load('coat'), /offline/)
  assert.deepEqual(await load('coat'), [example])
  assert.equal(attempts, 2)
})

test('malformed examples and untrusted attribution URLs are not rendered', async () => {
  const load = createWordExampleLoader(async () => ({ coat: [example, null,
    { ...example, cn: '' }, { ...example, sourceUrl: 'javascript:alert(1)' },
    { ...example, attribution: '' }, { ...example, sourceUrl: 'https://tatoeba.org.attacker.invalid/en/sentences/show/1' },
  ] }))
  assert.deepEqual(await load('coat'), [example])
  await assert.rejects(createWordExampleLoader(async () => [])('coat'), /Invalid/)
})

test('supplemental examples keep word identity and existing or edited sentences intact', () => {
  const original = { id: 'market-nce1-words-15', word: 'coat', trans: [{ cn: '外套' }], sentences: [] }
  const filled = withWordExamples(original, [example])
  assert.equal(filled.id, original.id)
  assert.equal(filled.trans, original.trans)
  assert.deepEqual(original.sentences, [])
  const custom = { ...original, sentences: [{ c: 'My own coat example.', cn: '我自己的例句。' }] }
  assert.equal(withWordExamples(custom, [example]), custom)
  assert.equal(withWordExamples(original, []), original)
})

test('the shipped corpus supplies bilingual coat examples with attribution and exact word boundaries', async () => {
  const root = new URL('../public/dicts/en/examples/', import.meta.url)
  let count = 0
  for (const file of await readdir(root)) {
    const entries = JSON.parse(await readFile(new URL(file, root), 'utf8'))
    for (const [word, examples] of Object.entries(entries)) {
      assert.equal(file, wordExampleBucket(word) + '.json')
      assert.ok(examples.length >= 1 && examples.length <= 2)
      assert.equal(new Set(examples.map(row => row.c.toLowerCase())).size, examples.length)
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      for (const row of examples) {
        assert.match(normalizeExampleWord(row.c), new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`))
        assert.match(row.cn, /\p{Script=Han}/u)
        assert.match(row.attribution, /^CC-BY 2\.0 \(France\) Attribution:/)
        assert.match(row.sourceUrl, /^https:\/\/tatoeba\.org\/en\/sentences\/show\/\d+$/)
      }
      count++
    }
  }
  const coat = JSON.parse(await readFile(new URL('c.json', root), 'utf8')).coat
  assert.equal(coat.length, 2)
  assert.ok(coat.every(row => /外套|大衣|上衣/.test(row.cn)))
  const provenance = JSON.parse(await readFile(new URL('../public/list/word-example-sources.json', import.meta.url), 'utf8'))
  assert.equal(count, provenance.matchedWords)
  assert.equal(provenance.coverage.find(row => row.filename === 'market-nce1-words.json').supplementalExamples, 752)
})
