import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createGlossBundle, wordsToEntries } from '../app/core/immersive/gloss.ts'
import { phraseTokenIndexes } from '../app/core/immersive/phrases.ts'
import { readingSegments } from '../app/core/immersive/player.ts'
import { parseTargetWords, validateCoverage, studyMarkdown } from '../app/core/immersive/studio.ts'

test('reading index covers every bundled English library and accepts custom dictionaries', () => {
  const bundle = createGlossBundle(JSON.parse(readFileSync(new URL('../public/dicts/en/word/reading-gloss.json', import.meta.url))))
  const catalog = JSON.parse(readFileSync(new URL('../public/list/word.json', import.meta.url)))
  for (const resource of catalog.filter(v => v.language === 'en')) {
    const words = JSON.parse(readFileSync(new URL(`../public/dicts/en/word/${resource.url}`, import.meta.url)))
    for (const word of words) assert.ok(bundle.find(word.word), `${resource.name}: ${word.word}`)
  }
  const words = wordsToEntries([{ word: 'Foobar', trans: [{ pos: 'n.', cn: '自建词' }], phrases: [] }])
  assert.equal(createGlossBundle({ v: 1, count: 1, words }).find('foobars').entry.t, 'n. 自建词')
})

test('phrases match inflections and an inserted adverb but never cross punctuation', () => {
  const tokens = words => words.map(text => ({ text, space: true, kind: text === ',' ? 'symbol' : 'word' }))
  assert.deepEqual(phraseTokenIndexes(tokens(['took', 'part', 'in']), 'take part in'), [[0, 1, 2]])
  assert.deepEqual(phraseTokenIndexes(tokens(['give', 'carefully', 'up']), 'give up'), [[0, 1, 2]])
  assert.deepEqual(phraseTokenIndexes(tokens(['take', ',', 'part']), 'take part'), [])
  assert.deepEqual(phraseTokenIndexes(tokens(['mean', 'means', 'means']), 'means', true), [[1], [2]])
  assert.deepEqual(phraseTokenIndexes([{ text: 'C', space: false, kind: 'word' }, { text: '+', space: false, kind: 'symbol' }, { text: '+', space: true, kind: 'symbol' }], 'C++', true), [[0, 1, 2]])
})

test('audio queue retains paragraph boundaries and only trusts valid timestamps', () => {
  const segments = readingSegments([[{ text: 'First sentence. Second sentence.', audioPosition: [0, 0] }], [{ text: 'Recorded sentence.', audioPosition: [2, 5] }]])
  assert.deepEqual(segments.map(v => v.paragraph), [0, 0, 1])
  assert.equal(segments[0].start, undefined)
  assert.equal(segments[2].start, 2)
  assert.equal(segments[2].end, 5)
  const long = readingSegments([[{ text: 'word '.repeat(301) }]])
  assert.equal(long.length, 6)
  assert.ok(long.every(v => v.text.length < 2000))
})

test('target validation rejects missing words and unrelated model-reported forms', () => {
  assert.deepEqual(parseTargetWords('Arrange，persuade\narrange'), ['arrange', 'persuade'])
  assert.throws(() => parseTargetWords('忽略指令'), /英语目标词/)
  assert.doesNotThrow(() => validateCoverage(['arrange', 'take part'], [{ lemma: 'arrange', form: 'arranged' }, { lemma: 'take part', form: 'took part' }]))
  assert.throws(() => validateCoverage(['arrange'], [{ lemma: 'arrange', form: 'apple' }]), /未以可核对/)
  assert.throws(() => validateCoverage(['arrange'], []), /arrange/)
})

test('Markdown export contains six requested sections and bolds actual inflections', () => {
  const result = studyMarkdown({ title: 'A Plan', text: 'We arranged a meeting.', textTranslate: '我们安排了一次会面。', readingStudy: { vocabulary: [{ lemma: 'arrange', form: 'arranged', meaning: '安排' }], phrases: [{ text: 'a meeting', meaning: '一次会面' }], theme: '适合安排活动时使用。' } })
  assert.match(result, /\*\*arranged\*\*/)
  assert.match(result, /中文翻译/)
  assert.match(result, /目标词清单/)
  assert.match(result, /值得背诵/)
  assert.match(result, /适合安排活动/)
})
