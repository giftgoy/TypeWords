import { test } from 'node:test'
import assert from 'node:assert/strict'
import { excludeSimpleAnnotations } from '../app/core/immersive/simple-annotations.ts'

test('late annotation filtering removes hints from simple words and inflections while keeping click lookup data', () => {
  const tokens = [
    { text: 'The', lemma: 'the', target: true, gloss: '那个', fullGloss: '冠词', title: '那个' },
    { text: 'studied', lemma: 'study', target: true, gloss: '学习' },
    { text: 'isn’t', target: true, gloss: '不是' },
    { text: 'business', lemma: 'business', target: true, gloss: '商业' },
  ]
  const original = structuredClone(tokens)
  const filtered = excludeSimpleAnnotations(tokens, new Set(['the', 'study', 'be', 'bus']), true)
  assert.deepEqual(
    filtered.map(t => !!t.target),
    [false, false, false, true]
  )
  assert.equal(filtered[0].gloss, undefined)
  assert.equal(filtered[0].title, undefined)
  assert.equal(filtered[0].fullGloss, '冠词')
  assert.equal(filtered[0].lemma, 'the')
  assert.deepEqual(tokens, original)
  assert.equal(excludeSimpleAnnotations(tokens, new Set(['the']), false)[0].gloss, '那个')
})
test('simple phrase members lose markings without discarding a meaningful phrase on the content word', () => {
  const tokens = ['in', 'charge', 'of'].map(text => ({
    text,
    phrase: 'in charge of',
    phraseSpace: text !== 'of',
    target: true,
    gloss: '负责',
  }))
  const filtered = excludeSimpleAnnotations(tokens, new Set(['in', 'of']), true)
  assert.equal(filtered[0].phrase, undefined)
  assert.equal(filtered[1].phrase, 'in charge of')
  assert.equal(filtered[1].gloss, '负责')
  assert.equal(filtered[1].phraseSpace, false)
  assert.equal(filtered[2].phrase, undefined)
})
test('explicitly excluded full expressions cannot be reintroduced by contextual annotations', () => {
  const tokens = [
    { text: 'in', form: 'in fact', lemma: 'in fact', target: true, gloss: '事实上', phrase: 'in fact' },
    { text: 'fact', form: 'in fact', lemma: 'in fact', target: true, gloss: '事实上', phrase: 'in fact' },
  ]
  assert.ok(excludeSimpleAnnotations(tokens, new Set(['in fact']), true).every(t => !t.target && !t.gloss && !t.phrase))
})
