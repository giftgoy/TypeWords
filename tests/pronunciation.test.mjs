import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { startPronunciation } from '../app/core/utils/pronunciation.ts'

function setup(extra = {}) {
  const calls = { played: 0, ended: 0, errors: [], fallback: 0 }
  const audio = { play: () => Promise.resolve(), pause() {}, onplay: null, onended: null, onerror: null }
  let fallbackCallbacks
  const options = {
    audio,
    source: '/test.mp3',
    volume: 1,
    rate: 1,
    timeoutMs: 30,
    isCurrent: () => true,
    onPlay: () => calls.played++,
    onEnd: () => calls.ended++,
    onError: error => calls.errors.push(error),
    fallback: callbacks => {
      calls.fallback++
      fallbackCallbacks = callbacks
    },
    ...extra,
  }
  return { calls, audio, options, fallback: () => fallbackCallbacks }
}

test('normal playback completes once and never reports an error', async () => {
  const fixture = setup()
  startPronunciation(fixture.options)
  fixture.audio.onplay()
  fixture.audio.onended()
  fixture.audio.onended()
  await delay(40)
  assert.equal(fixture.calls.played, 1)
  assert.equal(fixture.calls.ended, 1)
  assert.deepEqual(fixture.calls.errors, [])
  assert.equal(fixture.calls.fallback, 0)
})

test('blocked autoplay gives an actionable error and does not pretend the pronunciation ended', async () => {
  const fixture = setup()
  fixture.audio.play = () => Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' }))
  startPronunciation(fixture.options)
  await delay(1)
  assert.match(fixture.calls.errors[0], /重试发音/)
  assert.equal(fixture.calls.ended, 0)
  assert.equal(fixture.calls.fallback, 0)
})

test('duplicate network failures start a single fallback and cannot disable its timeout', async () => {
  const fixture = setup()
  let rejectPlay
  fixture.audio.play = () =>
    new Promise((_, reject) => {
      rejectPlay = reject
    })
  startPronunciation(fixture.options)
  fixture.audio.onerror()
  rejectPlay(new Error('network failed'))
  await delay(45)
  assert.equal(fixture.calls.fallback, 1)
  assert.equal(fixture.calls.errors.length, 1)
  assert.equal(fixture.calls.ended, 0)
})

test('fallback succeeds once and stale callbacks cannot change the next word', async () => {
  let current = true
  const fixture = setup({ isCurrent: () => current })
  startPronunciation(fixture.options)
  fixture.audio.onerror()
  fixture.fallback().onPlay()
  current = false
  fixture.fallback().onError('old error')
  fixture.fallback().onEnd()
  await delay(40)
  assert.equal(fixture.calls.played, 1)
  assert.equal(fixture.calls.ended, 0)
  assert.deepEqual(fixture.calls.errors, [])
})
