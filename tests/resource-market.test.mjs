import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  READING_LEVELS,
  readMarketCatalog,
  readMarketContent,
  filterMarketResources,
  addResourceToLibrary,
} from '../app/core/utils/resource-market.ts'

const readJson = async path => JSON.parse(await readFile(new URL(`../public/${path}`, import.meta.url), 'utf8'))
const words = readMarketCatalog(await readJson('list/word.json'))
const articles = readMarketCatalog(await readJson('list/article.json'))

test('all catalog entries have real, compatible content and accurate counts', async () => {
  assert.ok(words.length >= 14)
  assert.ok(articles.length >= 7)
  for (const [kind, catalog] of [
    ['word', words],
    ['article', articles],
  ]) {
    for (const resource of catalog) {
      const payload = await readJson(`dicts/en/${kind}/${resource.url}`)
      const result = readMarketContent(resource, kind, payload)
      assert.equal(result.length, resource.length, resource.name)
      if (resource.id.toString().startsWith('market-')) {
        assert.equal(new Set(payload.map(word => word.word.toLowerCase())).size, payload.length, resource.name)
        for (const word of payload) {
          for (const key of ['sentences', 'phrases', 'synos', 'etymology']) assert.ok(Array.isArray(word[key]))
          assert.ok(Array.isArray(word.relWords.rels))
        }
      }
    }
  }
})

test('all six reading levels have four distinct bilingual articles with aligned paragraphs', async () => {
  const ids = new Set()
  for (const { value: level } of READING_LEVELS) {
    const book = articles.find(book => book.id === `graded-${level.toLowerCase()}`)
    assert.equal(book.level, level)
    const content = await readJson(`dicts/en/article/${book.url}`)
    assert.equal(content.length, 4)
    for (const article of content) {
      assert.ok(!ids.has(article.id))
      ids.add(article.id)
      const english = article.text.split('\n\n')
      const chinese = article.textTranslate.split('\n\n')
      assert.equal(english.length, chinese.length)
      assert.ok(english.every(line => /[a-z]/i.test(line)))
      assert.ok(chinese.every(line => /[\u4e00-\u9fff]/.test(line)))
    }
  }
  assert.equal(ids.size, 24)
  assert.equal(articles.find(book => book.id === 246).length, 5)
})

test('search combines keywords, category, reading level and installation status', () => {
  assert.deepEqual(
    filterMarketResources(words, { query: '  iElTs 雅思  ' }).map(book => book.id),
    ['market-ielts']
  )
  assert.equal(filterMarketResources(words, { category: '职业英语' }).length, 2)
  const b2 = articles.find(book => book.level === 'B2')
  assert.deepEqual(filterMarketResources(articles, { level: 'B2', installedOnly: true }, [b2]), [b2])
  assert.equal(filterMarketResources(articles, { level: 'B2', category: '经典教材' }).length, 0)
  assert.equal(filterMarketResources(words, { query: 'does-not-exist' }).length, 0)
  const before = words.map(book => book.id)
  const sorted = filterMarketResources(words, { sort: 'count-asc' })
  assert.ok(sorted.every((book, index) => !index || sorted[index - 1].length <= book.length))
  assert.deepEqual(
    words.map(book => book.id),
    before
  )
})

test('adding is idempotent across numeric IDs and aliases and preserves progress and statistics', () => {
  const record = { id: '1', enName: 'cet4', lastLearnIndex: 52, statistics: [{ total: 20 }] }
  const library = [record]
  assert.equal(addResourceToLibrary({ id: 1 }, library), false)
  assert.equal(addResourceToLibrary({ id: 'cet4' }, library), false)
  assert.equal(library[0], record)
  assert.equal(record.lastLearnIndex, 52)
  assert.deepEqual(record.statistics, [{ total: 20 }])
  const next = { id: 'market-cet6' }
  assert.equal(addResourceToLibrary(next, library), true)
  assert.equal(addResourceToLibrary(next, library), false)
  assert.equal(library.length, 2)
})

test('bad catalogs, empty files and wrong content types cannot be added as working resources', () => {
  assert.throws(() => readMarketCatalog({ error: 'failed' }))
  assert.throws(() => readMarketCatalog([{ ...words[0], url: '../secret.json' }]))
  assert.throws(() => readMarketCatalog([words[0], words[0]]))
  assert.throws(() => readMarketContent(words[0], 'word', []))
  assert.throws(() => readMarketContent(words[0], 'word', [{ word: 'test', trans: [] }]))
  assert.throws(() => readMarketContent(articles[0], 'article', [{ title: 'Empty', text: '' }]))
})
