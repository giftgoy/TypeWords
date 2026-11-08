import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSettingStore } from '../stores/setting'
import { cancelTtsAudio, getVoicesAsync } from '../hooks/sound'
import { withAppBaseURL } from '../utils/base-url'
import { estimateSpeechSeconds, totalSpeechSeconds, type SentenceSpan } from './sentences'

/**
 * 阅读页的逐句朗读引擎。
 *
 * 两种语音：
 * - natural：先请求 `/api/tts/speak` 拿到自然语音音频（按句缓存 blob），
 *   用 <audio> 播放，能真实暂停/继续、实时改语速、给出句内进度。
 * - browser：浏览器 speechSynthesis，离线可用；进度来自 onboundary。
 *
 * 在线语音第一次失败后就整篇切到浏览器语音，避免每句都等一次网络超时才出声。
 */

export type SpeechState = 'idle' | 'loading' | 'playing' | 'paused'
export type SpeechEngine = 'natural' | 'browser'

const TTS_VOICE = 'en-US-AriaNeural'
const MIN_RATE = 0.5
const MAX_RATE = 3

export function useArticleSpeech(script: () => SentenceSpan[]) {
  const setting = useSettingStore()

  const state = ref<SpeechState>('idle')
  const index = ref(0)
  const progress = ref(0)
  const engine = ref<SpeechEngine>('natural')
  const loop = ref(false)
  const error = ref('')
  const notice = ref('')

  let generation = 0
  let audio: HTMLAudioElement | null = null
  let utterance: SpeechSynthesisUtterance | null = null
  let controller: AbortController | null = null
  let networkOk = true
  const cache = new Map<string, string>()

  const rate = computed({
    get: () => Math.min(MAX_RATE, Math.max(MIN_RATE, setting.articleSoundSpeed || 1)),
    set: value => {
      setting.articleSoundSpeed = Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, value)) * 100) / 100
    },
  })
  const volume = computed(() => Math.min(1, Math.max(0, (setting.articleSoundVolume ?? 100) / 100)))
  const total = computed(() => script().length)
  const duration = computed(() => totalSpeechSeconds(script(), rate.value))
  const elapsed = computed(() => {
    const list = script()
    let seconds = 0
    for (let i = 0; i < Math.min(index.value, list.length); i++) seconds += estimateSpeechSeconds(list[i].text, rate.value)
    const current = list[index.value]
    if (current && state.value !== 'idle') seconds += estimateSpeechSeconds(current.text, rate.value) * progress.value
    return Math.min(duration.value, Math.round(seconds))
  })

  function getAudio(): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null
    audio ??= new Audio()
    return audio
  }

  function detachPlayback() {
    controller?.abort()
    controller = null
    if (audio) {
      audio.onplay = null
      audio.onended = null
      audio.onerror = null
      audio.ontimeupdate = null
      audio.pause()
    }
    if (utterance) {
      utterance.onstart = null
      utterance.onend = null
      utterance.onerror = null
      utterance.onboundary = null
    }
    utterance = null
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }

  function stop() {
    generation++
    detachPlayback()
    cancelTtsAudio()
    state.value = 'idle'
    progress.value = 0
  }

  function fail(message: string) {
    stop()
    error.value = message
  }

  function advance(ticket: number) {
    if (ticket !== generation || error.value) return
    if (loop.value) {
      playAt(index.value)
      return
    }
    const next = index.value + 1
    if (next >= script().length) {
      generation++
      detachPlayback()
      state.value = 'idle'
      progress.value = 0
      return
    }
    playAt(next)
  }

  /** 取在线语音音频（同句只请求一次） */
  async function audioUrlFor(text: string, ticket: number): Promise<string> {
    const cached = cache.get(text)
    if (cached) return cached
    controller?.abort()
    controller = new AbortController()
    const timeoutId = setTimeout(() => controller?.abort(), 8000)
    try {
      const query = new URLSearchParams({ text, voice: TTS_VOICE })
      const response = await fetch(withAppBaseURL(`/api/tts/speak?${query}`), { signal: controller.signal })
      if (ticket !== generation) throw new Error('stale')
      if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('tts-unavailable')
      const url = URL.createObjectURL(await response.blob())
      if (ticket !== generation) {
        URL.revokeObjectURL(url)
        throw new Error('stale')
      }
      cache.set(text, url)
      return url
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async function speakNatural(item: SentenceSpan, ticket: number) {
    const src = await audioUrlFor(item.text, ticket)
    if (ticket !== generation) return
    const element = getAudio()
    if (!element) throw new Error('audio-unavailable')
    element.onplay = () => {
      if (ticket === generation) state.value = 'playing'
    }
    element.ontimeupdate = () => {
      if (ticket !== generation) return
      const total = element.duration
      progress.value = Number.isFinite(total) && total > 0 ? Math.min(1, element.currentTime / total) : 0
    }
    element.onended = () => advance(ticket)
    element.onerror = () => {
      if (ticket !== generation) return
      networkOk = false
      notice.value = '在线语音暂时不可用，已改用浏览器语音。'
      void speakBrowser(item, ticket)
    }
    element.src = src
    element.volume = volume.value
    element.playbackRate = rate.value
    element.preservesPitch = true
    await element.play()
  }

  async function speakBrowser(item: SentenceSpan, ticket: number) {
    if (typeof speechSynthesis === 'undefined') {
      fail('当前浏览器不支持语音朗读，可以换成 Chrome / Edge / Safari 再试。')
      return
    }
    const voices = await getVoicesAsync()
    if (ticket !== generation) return
    const english = voices.filter(v => /^en[-_]/i.test(v.lang))
    const preferred = english.find(v => v.lang === (setting.soundType === 'uk' ? 'en-GB' : 'en-US')) ?? english[0]
    const message = new SpeechSynthesisUtterance(item.text)
    if (preferred) {
      message.voice = preferred
      message.lang = preferred.lang
    } else {
      message.lang = 'en-US'
    }
    message.rate = rate.value
    message.volume = volume.value
    message.onstart = () => {
      if (ticket === generation) state.value = 'playing'
    }
    message.onboundary = event => {
      if (ticket !== generation) return
      progress.value = Math.min(1, (event.charIndex ?? 0) / Math.max(1, item.text.length))
    }
    message.onend = () => {
      if (ticket !== generation) return
      progress.value = 0
      advance(ticket)
    }
    message.onerror = event => {
      if (ticket !== generation) return
      if (event.error === 'interrupted' || event.error === 'canceled') return
      fail('浏览器语音朗读失败，请检查系统语音后重试。')
    }
    utterance = message
    state.value = 'playing'
    speechSynthesis.resume()
    speechSynthesis.speak(message)
  }

  async function playSentence(item: SentenceSpan, ticket: number) {
    cancelTtsAudio()
    if (engine.value === 'natural' && networkOk) {
      try {
        await speakNatural(item, ticket)
        return
      } catch (cause) {
        if (ticket !== generation) return
        if ((cause as Error)?.name === 'NotAllowedError') {
          fail('浏览器阻止了自动播放，请再点一次播放按钮。')
          return
        }
        if ((cause as Error)?.name === 'AbortError' || (cause as Error)?.message === 'stale') return
        networkOk = false
        if (engine.value === 'natural') {
          engine.value = 'browser'
          notice.value = '在线语音不可用，已改用浏览器语音朗读。'
        }
      }
    }
    if (ticket !== generation) return
    await speakBrowser(item, ticket)
  }

  function playAt(target: number) {
    const list = script()
    if (!list.length) {
      fail('这篇文章还没有可以朗读的正文。')
      return
    }
    const next = Math.min(Math.max(0, target), list.length - 1)
    index.value = next
    error.value = ''
    progress.value = 0
    state.value = 'loading'
    const ticket = ++generation
    void playSentence(list[next], ticket)
  }

  function toggle() {
    if (state.value === 'playing' || state.value === 'loading') pause()
    else if (state.value === 'paused') void resume()
    else playAt(index.value)
  }

  function pause() {
    if (state.value === 'idle' || state.value === 'paused') return
    if (state.value === 'loading') {
      generation++
      detachPlayback()
      state.value = 'paused'
      return
    }
    audio?.pause()
    if (utterance && typeof speechSynthesis !== 'undefined') speechSynthesis.pause()
    state.value = 'paused'
  }

  async function resume() {
    if (state.value !== 'paused') return
    error.value = ''
    const ticket = generation
    if (utterance) {
      speechSynthesis.resume()
      state.value = 'playing'
      return
    }
    if (audio?.src && audio.currentTime > 0 && !audio.ended) {
      try {
        await audio.play()
        if (ticket === generation) state.value = 'playing'
        return
      } catch {
        /* 落到重新请求这一句 */
      }
    }
    playAt(index.value)
  }

  function setEngine(next: SpeechEngine) {
    engine.value = next
    if (next === 'natural') networkOk = true
    if (state.value === 'playing' || state.value === 'paused') playAt(index.value)
  }

  function seek(target: number) {
    playAt(target)
  }

  watch(rate, value => {
    if (audio) audio.playbackRate = value
    if (utterance && state.value === 'playing') playAt(index.value)
  })

  // 换文章 / 换章节后脚本变了，停掉上一段朗读并从第一句重新开始
  watch(
    () => script(),
    () => {
      stop()
      index.value = 0
    }
  )

  function clear() {
    stop()
    cache.forEach(url => URL.revokeObjectURL(url))
    cache.clear()
  }

  onBeforeUnmount(clear)

  return {
    state,
    index,
    progress,
    engine,
    loop,
    error,
    notice,
    rate,
    total,
    duration,
    elapsed,
    playAt,
    toggle,
    pause,
    resume,
    stop,
    seek,
    setEngine,
    cleanup: clear,
  }
}
