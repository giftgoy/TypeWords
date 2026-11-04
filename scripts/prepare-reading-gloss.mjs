import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'public/dicts/en/word')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/list/word.json'), 'utf8'))
const words = {}
for (const resource of catalog) {
  if (resource.language !== 'en') continue
  const entries = JSON.parse(fs.readFileSync(path.join(dir, resource.url), 'utf8'))
  for (const w of entries) {
    const key = w.word.trim().toLowerCase()
    if (words[key]) continue
    words[key] = {
      p: w.phonetic1 || w.phonetic0 || '',
      t: (w.trans || []).map(t => `${t.pos || ''} ${t.cn}`).join('；'),
      ph: (w.phrases || []).map(p => [p.c, p.cn]),
    }
  }
}
const output = path.join(dir, 'reading-gloss.json')
fs.writeFileSync(output, JSON.stringify({ v: 1, count: Object.keys(words).length, words }))
console.log(`Reading index: ${Object.keys(words).length} words from all ${catalog.length} libraries`)
