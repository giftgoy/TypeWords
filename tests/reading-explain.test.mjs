import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasExplanation, normalizeExplanation } from '../app/core/reading/explain.ts'

test('讲解结果缺失字段时按空处理，不抛异常', () => {
  const empty = normalizeExplanation(null)
  assert.deepEqual(empty, { title: '', theme: '', summary: [], sentences: [], words: [], highlights: [] })
  assert.equal(hasExplanation(empty), false)
  assert.equal(hasExplanation(normalizeExplanation('不是对象')), false)
})

test('字符串去空白并按上限截断，空条目被丢弃', () => {
  const result = normalizeExplanation({
    title: '  市议会的计划  ',
    theme: '讲一个计划',
    summary: ['  要点一 ', '', 42, '要点二'],
    sentences: [
      { en: '  The council approved the plan.  ', cn: ' 议会批准了计划。 ', note: 'approve 直接接宾语' },
      { en: '   ', cn: '没有原句' },
      { cn: '缺 en' },
    ],
    words: [
      { word: ' council ', meaning: '市政委员会', usage: '' },
      { meaning: '缺 word' },
    ],
    highlights: ['doubt it will help', ''],
  })
  assert.equal(result.title, '市议会的计划')
  assert.deepEqual(result.summary, ['要点一', '要点二'])
  assert.equal(result.sentences.length, 1)
  assert.deepEqual(result.sentences[0], {
    en: 'The council approved the plan.',
    cn: '议会批准了计划。',
    note: 'approve 直接接宾语',
  })
  assert.deepEqual(result.words, [{ word: 'council', meaning: '市政委员会', usage: '' }])
  assert.deepEqual(result.highlights, ['doubt it will help'])
  assert.equal(hasExplanation(result), true)
})

test('条目数量有上限，防止异常长回答刷屏', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ en: `sentence ${i}`, cn: `句 ${i}`, note: '' }))
  const words = Array.from({ length: 40 }, (_, i) => ({ word: `word${i}`, meaning: `词 ${i}`, usage: '' }))
  const result = normalizeExplanation({ sentences: many, words, summary: Array.from({ length: 12 }, (_, i) => `要点 ${i}`) })
  assert.equal(result.sentences.length, 40)
  assert.equal(result.words.length, 30)
  assert.equal(result.summary.length, 6)
})

test('只有单句讲解也算有内容', () => {
  const result = normalizeExplanation({ sentences: [{ en: 'One sentence.', cn: '一句。' }] })
  assert.equal(hasExplanation(result), true)
})
