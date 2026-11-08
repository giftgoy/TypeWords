import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReadingScript,
  estimateSpeechSeconds,
  groupScriptByParagraph,
  indexOfSentenceWithWord,
  splitSentences,
  totalSpeechSeconds,
} from '../app/core/reading/sentences.ts'

test('按句号、问号、感叹号断句，并保留句末引号', () => {
  assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?'])
  assert.deepEqual(splitSentences('He said "no." Then he left.'), ['He said "no."', 'Then he left.'])
})

test('缩写与小数不被误判为句末', () => {
  assert.deepEqual(splitSentences('J.D. Vance beat Mr Smith by 3.5 points. It held.'), [
    'J.D. Vance beat Mr Smith by 3.5 points.',
    'It held.',
  ])
  assert.deepEqual(splitSentences('   '), [])
})

test('段落展平成从句脚本，句序号连续且带段落归属', () => {
  const script = buildReadingScript(['First one. Second one.', 'Third one.'])
  assert.deepEqual(
    script.map(item => item.text),
    ['First one.', 'Second one.', 'Third one.']
  )
  assert.deepEqual(
    script.map(item => item.index),
    [0, 1, 2]
  )
  assert.deepEqual(
    script.map(item => item.paragraph),
    [0, 0, 1]
  )
})

test('按段落分组保持原顺序', () => {
  const groups = groupScriptByParagraph(buildReadingScript(['A1. A2.', 'B1.']))
  assert.equal(groups.length, 2)
  assert.deepEqual(
    groups[0].map(item => item.text),
    ['A1.', 'A2.']
  )
  assert.deepEqual(
    groups[1].map(item => item.text),
    ['B1.']
  )
})

test('朗读时长按语速折算', () => {
  const text = Array.from({ length: 160 }, () => 'word').join(' ')
  assert.equal(estimateSpeechSeconds(text, 1), 60)
  assert.equal(estimateSpeechSeconds(text, 2), 30)
  assert.equal(estimateSpeechSeconds('', 1), 0)
  const script = buildReadingScript([text, 'It held.'])
  assert.equal(totalSpeechSeconds(script, 1), 60 + estimateSpeechSeconds('It held.', 1))
})

test('重点词能定位到所在句子，含复数与所有格', () => {
  const script = buildReadingScript([
    'Nothing here. A landslide followed.',
    "Majority rule, and the administration's tone.",
  ])
  assert.equal(indexOfSentenceWithWord(script, 'landslide'), 1)
  assert.equal(indexOfSentenceWithWord(script, 'majority'), 2)
  assert.equal(indexOfSentenceWithWord(script, 'administration'), 2)
  assert.equal(indexOfSentenceWithWord(script, 'missing'), -1)
})
