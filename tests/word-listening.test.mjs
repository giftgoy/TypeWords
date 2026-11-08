import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildListeningQueue,
  seededShuffle,
  stepQueueIndex,
  toListeningItem,
} from '../app/core/word/listening-queue.ts'

const word = (overrides = {}) => ({
  word: 'neighbourhood',
  phonetic0: 'ˈneɪbəhʊd',
  phonetic1: '',
  trans: [
    { pos: 'n.', cn: '街区；邻里' },
    { pos: 'adj.', cn: '邻近的' },
  ],
  sentences: [{ c: 'A comfortable neighbourhood.', cn: '一个舒适的街区。' }],
  ...overrides,
})

test('词条转换：拼释义、取音标和第一条例句', () => {
  const item = toListeningItem(word())
  assert.deepEqual(item, {
    word: 'neighbourhood',
    phonetic: 'ˈneɪbəhʊd',
    meaning: 'n. 街区；邻里；adj. 邻近的',
    spoken: '街区',
    example: 'A comfortable neighbourhood.',
    exampleCn: '一个舒适的街区。',
  })
})

test('朗读用的释义只取最常用那条，并去掉括号里的补充', () => {
  const item = toListeningItem(
    word({ trans: [{ pos: 'v.', cn: '取消（计划好的事情）；终止' }, { pos: 'n.', cn: '抵消' }] })
  )
  assert.equal(item.spoken, '取消')
  assert.ok(item.meaning.includes('抵消'))
})

test('没有单词的条目直接丢弃，释义过长会截断', () => {
  assert.equal(toListeningItem({ word: '  ', trans: [] }), null)
  assert.equal(toListeningItem(null), null)
  const long = toListeningItem(word({ trans: [{ pos: 'n.', cn: '很长的释义'.repeat(40) }] }))
  assert.ok(long.meaning.length <= 140)
  assert.ok(long.spoken.length <= 40)
})

test('队列按小写去重，顺序模式下保持原顺序', () => {
  const queue = buildListeningQueue([word(), word({ word: 'NEIGHBOURHOOD' }), word({ word: 'distance' })])
  assert.deepEqual(
    queue.map(item => item.word),
    ['neighbourhood', 'distance']
  )
})

test('随机模式是确定性的：同一个 seed 得到同一个顺序', () => {
  const words = Array.from({ length: 30 }, (_, index) => word({ word: `word${index}` }))
  const first = buildListeningQueue(words, 'random', 42).map(item => item.word)
  const second = buildListeningQueue(words, 'random', 42).map(item => item.word)
  const other = buildListeningQueue(words, 'random', 7).map(item => item.word)
  assert.deepEqual(first, second)
  assert.notDeepEqual(first, other)
  assert.deepEqual([...first].sort(), words.map(item => item.word).sort())
})

test('seededShuffle 不修改入参', () => {
  const source = [1, 2, 3, 4]
  const shuffled = seededShuffle(source, 9)
  assert.deepEqual(source, [1, 2, 3, 4])
  assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4])
})

test('前后翻页在边界处绕回，空队列保持 0', () => {
  assert.equal(stepQueueIndex(0, 3, -1), 2)
  assert.equal(stepQueueIndex(2, 3, 1), 0)
  assert.equal(stepQueueIndex(1, 3, 1), 2)
  assert.equal(stepQueueIndex(0, 0, 1), 0)
})
