// Node 22.13+; no audio hardware or network required.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import { test } from 'node:test'

const source = stripTypeScriptTypes(readFileSync(new URL('../app/core/hooks/sound.ts', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')
  .replaceAll('import.meta.server', 'false')

function setup({ voices = [], online = true, selected = '' } = {}) {
  const audio = []
  const spoken = []
  const listeners = new Set()
  const synthesis = {
    onvoiceschanged: () => {},
    getVoices: () => voices,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    pause() {},
    cancel() {},
    resume() {},
    speak: msg => spoken.push(msg),
  }
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    URLSearchParams,
    AbortSignal,
    navigator: { userAgent: 'Windows Chrome/' },
    Audio: class {
      constructor() {
        audio.push(this)
      }
      pause() {
        this.paused = true
      }
      play() {
        this.paused = false
        return Promise.resolve()
      }
    },
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text
      }
    },
    speechSynthesis: synthesis,
    useSettingStore: () => ({
      wordSoundSpeed: 1.2,
      wordSoundVolume: 65,
      articleSoundVolume: 75,
      articleSoundSpeed: 1.1,
      soundType: 'uk',
      ttsVoiceMap: [{ key: 'windows+chrome', voice: selected }],
    }),
    withAppBaseURL: path => path,
    fetch: async () => ({
      ok: true,
      json: async () => (online ? [{ id: 'en-GB-SoniaNeural', lang: 'en-GB', gender: 'female' }] : []),
    }),
  })
  vm.runInContext(source + '\nthis.api = { useTTsPlayAudio, cancelTtsAudio, getVoicesAsync };', context)
  return {
    ...context.api,
    context,
    audio,
    spoken,
    listeners,
    synthesis,
    setVoices: next => {
      voices = next
    },
  }
}

test('natural voice uses the selected accent, default settings and a single completion callback', async () => {
  const env = setup()
  let ended = 0
  await env.useTTsPlayAudio()('Hello', { onEnd: () => ended++ })
  const player = env.audio[0]
  assert.match(player.src, /voice=en-GB-SoniaNeural/)
  assert.equal(player.volume, 0.65)
  assert.equal(player.playbackRate, 1.2)
  assert.equal(player.preservesPitch, true)
  player.onended()
  player.onended()
  assert.equal(ended, 1)
})

test('cancellation and rapid replacement cannot complete an obsolete sentence', async () => {
  const env = setup()
  let ended = 0
  const play = env.useTTsPlayAudio()
  await play('Old', { onEnd: () => ended++ })
  const oldEnd = env.audio[0].onended
  env.cancelTtsAudio()
  oldEnd()
  assert.equal(ended, 0)
  await Promise.all([play('Superseded'), play('Latest')])
  assert.match(env.audio[0].src, /text=Latest/)
})

test('natural speech notifies both the preview and the pronunciation watchdog when playback starts', async () => {
  const env = setup()
  let previewStarted = 0
  let pronunciationStarted = 0
  await env.useTTsPlayAudio()('Hello', {
    onStart: () => previewStarted++,
    onPlay: () => pronunciationStarted++,
  })
  const started = env.audio[0].onplaying
  started()
  assert.equal(previewStarted, 1)
  assert.equal(pronunciationStarted, 1)
  env.cancelTtsAudio()
  started()
  assert.equal(pronunciationStarted, 1)
})

test('voice loading preserves other listeners and cleans up concurrent waiters', async () => {
  const env = setup()
  const original = env.synthesis.onvoiceschanged
  const pending = [env.getVoicesAsync(), env.getVoicesAsync()]
  env.setVoices([{ name: 'English', lang: 'en-US' }])
  for (const listener of [...env.listeners]) listener()
  assert.equal((await Promise.all(pending))[0][0].name, 'English')
  assert.equal(env.synthesis.onvoiceschanged, original)
  assert.equal(env.listeners.size, 0)
})

test('a failed natural voice falls back once and ignores obsolete system speech callbacks', async () => {
  const env = setup({ voices: [{ name: 'English', lang: 'en-GB' }] })
  let ended = 0
  await env.useTTsPlayAudio()('Hello', { onEnd: () => ended++ })
  const fail = env.audio[0].onerror
  fail()
  fail()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.spoken.length, 1)
  env.cancelTtsAudio()
  env.spoken[0].onend()
  assert.equal(ended, 0)
})

test('non-English system voices do not suppress the online fallback', async () => {
  const env = setup({ online: false, voices: [{ name: 'Chinese', lang: 'zh-CN' }] })
  await env.useTTsPlayAudio()('Hello')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.spoken.length, 0)
  assert.match(env.audio[0].src, /fanyi.baidu.com/)
  assert.equal(env.audio[0].volume, 0.65)
})

test('switching from title TTS to an article recording stops obsolete network speech', async () => {
  const env = setup()
  let ended = 0
  await env.useTTsPlayAudio()('Article title', { onEnd: () => ended++ })
  const oldEnd = env.audio[0].onended
  const articleSource = stripTypeScriptTypes(
    readFileSync(new URL('../app/core/hooks/article.ts', import.meta.url), 'utf8')
  )
    .replaceAll('\r\n', '\n')
    .replace(/^import .*\n/gm, '')
    .replace(/^export /gm, '')
  vm.runInContext(articleSource + '\nthis.articleAudio = usePlayArticleTextAudio();', env.context)
  const recording = { src: 'recording.mp3', pause() {}, play() {} }
  env.context.articleAudio.playArticleTextAudio({ text: 'Question', start: 1, end: -1 }, recording)
  assert.equal(env.audio[0].paused, true)
  assert.equal(recording.currentTime, 1)
  oldEnd()
  assert.equal(ended, 0)
})
