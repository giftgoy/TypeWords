import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildListeningQueue,
  seededShuffle,
  sliceQueueRange,
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

test('词条转换：拼释义、取音标和例句（examples 含全部例句，example 恒为第一条）', () => {
  const item = toListeningItem(word())
  assert.deepEqual(item, {
    word: 'neighbourhood',
    phonetic: 'ˈneɪbəhʊd',
    meaning: 'n. 街区；邻里；adj. 邻近的',
    spoken: '街区',
    examples: ['A comfortable neighbourhood.'],
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

test('limit 只截取每轮数量：顺序取前 N 个，随机是随机抽样', () => {
  const words = Array.from({ length: 30 }, (_, index) => word({ word: `word${index}` }))
  const all = buildListeningQueue(words, 'sequence', 1)
  assert.equal(buildListeningQueue(words, 'sequence', 1, 0).length, 30)
  assert.deepEqual(
    buildListeningQueue(words, 'sequence', 1, 10).map(item => item.word),
    all.slice(0, 10).map(item => item.word)
  )
  const sampled = buildListeningQueue(words, 'random', 42, 10)
  assert.equal(sampled.length, 10)
  // 抽样必须来自同一洗牌结果的前缀，同一 seed 下可复现
  assert.deepEqual(
    sampled.map(item => item.word),
    buildListeningQueue(words, 'random', 42, 0).slice(0, 10).map(item => item.word)
  )
})

test('seededShuffle 不修改入参', () => {
  const source = [1, 2, 3, 4]
  const shuffled = seededShuffle(source, 9)
  assert.deepEqual(source, [1, 2, 3, 4])
  assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4])
})

test('起点/终点/数量切队：起点生效、终点含头含尾、终点优先于数量、非法输入安全回退', () => {
  const words = Array.from({ length: 10 }, (_, index) => word({ word: `w${index}` }))
  const queue = buildListeningQueue(words, 'sequence', 1)
  const names = items => items.map(item => item.word)
  // 无参数 = 原队列
  assert.deepEqual(names(sliceQueueRange(queue)), names(queue))
  // 起点：从 w3 开始听到队尾
  assert.deepEqual(names(sliceQueueRange(queue, 'w3')), ['w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9'])
  // 起点 + 数量：数量从起点起算
  assert.deepEqual(names(sliceQueueRange(queue, 'w3', '', 2)), ['w3', 'w4'])
  // 起点 + 终点：含头含尾，数量让位
  assert.deepEqual(names(sliceQueueRange(queue, 'w2', 'w5', 3)), ['w2', 'w3', 'w4', 'w5'])
  // 只设终点：从队首听到终点
  assert.deepEqual(names(sliceQueueRange(queue, '', 'w1')), ['w0', 'w1'])
  // 终点在起点之前 → 忽略终点，按数量截
  assert.deepEqual(names(sliceQueueRange(queue, 'w5', 'w2', 2)), ['w5', 'w6'])
  // 起点词不在队列里 → 从第一个开始
  assert.deepEqual(names(sliceQueueRange(queue, 'nope', '', 2)), ['w0', 'w1'])
  // 大小写不敏感匹配
  assert.deepEqual(names(sliceQueueRange(queue, 'W3', '', 1)), ['w3'])
  // 空队列不炸
  assert.deepEqual(sliceQueueRange([]), [])
})

test('前后翻页在边界处绕回，空队列保持 0', () => {
  assert.equal(stepQueueIndex(0, 3, -1), 2)
  assert.equal(stepQueueIndex(2, 3, 1), 0)
  assert.equal(stepQueueIndex(1, 3, 1), 2)
  assert.equal(stepQueueIndex(0, 0, 1), 0)
})
