import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertHomepageStyles, checkStaticStyles } from '../deploy/check-static-styles.mjs'

const html = scope => `<div class="home" ${scope}><header class="home-header" ${scope}></header><main class="home-main" ${scope}><section class="demo" ${scope}></section></main></div>`
const css = scope => ['home', 'home-header', 'home-main', 'demo'].map(name => `.${name}[${scope}]{display:flex}`).join('')

test('generated markup and stylesheet selectors must have the same component scope', () => {
  assert.doesNotThrow(() => assertHomepageStyles(html('data-v-same'), css('data-v-same')))
  assert.throws(() => assertHomepageStyles(html('data-v-server'), css('data-v-client')), /scoped CSS mismatch/)
  assert.throws(() => assertHomepageStyles(html('data-v-same'), ''), /scoped CSS mismatch/)
})

test('a partially styled homepage is rejected even when its root scope matches', () => {
  const broken = html('data-v-same').replace('class="home-main" data-v-same', 'class="home-main" data-v-other')
  assert.throws(() => assertHomepageStyles(broken, css('data-v-same')), /home-main/)
})

test('the build check reads linked local CSS files and rejects missing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'typewords-style-check-'))
  try {
    await mkdir(join(root, '_nuxt'))
    await writeFile(join(root, 'index.html'), `<link rel="stylesheet" href="/_nuxt/page.css">${html('data-v-same')}`)
    await writeFile(join(root, '_nuxt/page.css'), css('data-v-same'))
    assert.equal(await checkStaticStyles(root), 1)
    await rm(join(root, '_nuxt/page.css'))
    await assert.rejects(checkStaticStyles(root), /ENOENT/)
  } finally {
    await rm(join(root, '_nuxt/page.css'), { force: true })
    await rm(join(root, 'index.html'), { force: true })
    await rmdir(join(root, '_nuxt'))
    await rmdir(root)
  }
})
