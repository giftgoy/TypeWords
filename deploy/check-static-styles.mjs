import { readFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

export function assertHomepageStyles(html, css) {
  for (const className of ['home', 'home-header', 'home-main', 'demo']) {
    const tags = html.match(/<[a-z][^>]*>/gi) ?? []
    const tag = tags.find(tag => {
      const classes = tag.match(/\bclass="([^"]*)"/)?.[1]?.split(/\s+/) ?? []
      return classes.includes(className)
    })
    if (!tag) throw new Error(`Homepage element .${className} is missing`)
    const scopes = tag.match(/data-v-[a-z0-9]+/gi) ?? []
    if (!scopes.some(scope => css.includes(`.${className}[${scope}]`))) {
      throw new Error(`Homepage scoped CSS mismatch: .${className} has ${scopes.join(', ') || 'no scope'}, but no matching stylesheet rule`)
    }
  }
}

export async function checkStaticStyles(publicDir) {
  const root = resolve(publicDir)
  const html = await readFile(resolve(root, 'index.html'), 'utf8')
  const sheets = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => ({ rel: tag.match(/\brel="([^"]+)"/)?.[1], href: tag.match(/\bhref="([^"]+)"/)?.[1] }))
    .filter(link => link.rel === 'stylesheet' && link.href)
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1])
  for (const { href } of sheets) {
    const url = new URL(href, 'http://build.local')
    if (url.origin !== 'http://build.local') throw new Error(`Stylesheet is not included in the local build: ${href}`)
    const file = resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''))
    const target = relative(root, file)
    if (target.startsWith('..') || isAbsolute(target)) throw new Error(`Invalid stylesheet path: ${href}`)
    css.push(await readFile(file, 'utf8'))
  }
  assertHomepageStyles(html, css.join('\n'))
  return sheets.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const count = await checkStaticStyles(process.argv[2] ?? '.output/public')
  console.log(`Static style check passed: homepage scope IDs match ${count} linked stylesheets.`)
}
