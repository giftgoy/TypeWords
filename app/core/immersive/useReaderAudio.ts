import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Article } from '../types/types.ts'
import { readingSegments } from './player.ts'
import { useSettingStore } from '../stores/setting.ts'
import { cancelWordPracticeAudio } from '../hooks/sound.ts'
import { withAppBaseURL } from '../utils/base-url.ts'
import { get } from '../utils/storage'
import { ENV, LOCAL_FILE_KEY } from '../config/env.ts'

export function useReaderAudio(article: () => Article) {
  const setting = useSettingStore()
  const state = ref<'idle' | 'loading' | 'playing' | 'paused'>('idle')
  const currentParagraph = ref<number | null>(null)
  const error = ref('')
  const notice = ref('')
  const rate = computed({ get: () => setting.articleSoundSpeed, set: value => { setting.articleSoundSpeed = value } })
  const segments = computed(() => readingSegments(article().sections))
  let audio: HTMLAudioElement | null = null
  let speech: SpeechSynthesisUtterance | null = null
  let generation = 0
  let cursor = 0
  let queue: number[] = []
  let original = ''
  let fileUrl = ''
  let fullTrack = false
  let pending = false
  let controller: AbortController | null = null
  const cache = new Map<string, string>()

  function stop() {
    generation++
    controller?.abort()
    audio?.pause()
    if (speech) window.speechSynthesis.cancel()
    speech = null
    pending = false
    state.value = 'idle'
    currentParagraph.value = null
  }

  function fail(message: string) {
    stop()
    error.value = message
  }

  function next() {
    if (state.value !== 'playing') return
    if (fullTrack || ++cursor >= queue.length) { stop(); return }
    void playSegment()
  }

  function systemSpeech(text: string, ticket: number) {
    if (!('speechSynthesis' in window)) return fail('朗读服务不可用，请检查网络后重试。')
    speech = new SpeechSynthesisUtterance(text)
    speech.lang = 'en-US'
    speech.rate = rate.value
    speech.volume = setting.articleSoundVolume / 100
    speech.onstart = () => { if (ticket === generation) state.value = 'playing' }
    speech.onend = () => { if (ticket === generation) { speech = null; next() } }
    speech.onerror = () => { if (ticket === generation) fail('浏览器朗读失败，请检查语音设置后重试。') }
    window.speechSynthesis.speak(speech)
    notice.value = '自然人声服务暂不可用，正在使用浏览器语音。'
  }

  async function playSegment() {
    const ticket = ++generation
    controller?.abort()
    controller = new AbortController()
    state.value = 'loading'
    pending = true
    const segment = segments.value[queue[cursor]]
    if (!segment || !audio) return stop()
    currentParagraph.value = segment.paragraph
    try {
      if (original && segment.start !== undefined) {
        if (audio.src !== original) audio.src = original
        audio.currentTime = segment.start
      } else {
        const key = segment.text
        if (!cache.has(key)) {
          const query = new URLSearchParams({ text: key, voice: 'en-US-AriaNeural' })
          const response = await fetch(withAppBaseURL(`/api/tts/speak?${query}`), { signal: controller.signal })
          if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('TTS unavailable')
          const blob = await response.blob()
          if (ticket !== generation) return
          cache.set(key, URL.createObjectURL(blob))
        }
        if (ticket !== generation) return
        audio.src = cache.get(key)!
      }
      audio.playbackRate = rate.value
      audio.volume = setting.articleSoundVolume / 100
      await audio.play()
      if (ticket === generation) { pending = false; state.value = 'playing' }
    } catch (cause) {
      if (ticket !== generation) return
      if ((cause as Error).name === 'NotAllowedError') return fail('播放被浏览器阻止，请再次点击播放。')
      if (original && segment.start !== undefined) return fail('原音频加载失败，请检查音频来源。')
      systemSpeech(segment.text, ticket)
      pending = false
    }
  }

  async function play(paragraph?: number) {
    stop()
    cancelWordPracticeAudio()
    error.value = ''
    notice.value = ''
    const ticket = generation
    state.value = 'loading'
    original = article().audioSrc ? new URL(withAppBaseURL(ENV.RESOURCE_URL + article().audioSrc), location.href).href : ''
    if (!original && article().audioFileId) {
      const files = await get(LOCAL_FILE_KEY)
      if (ticket !== generation) return
      const file = files?.find(v => v.id === article().audioFileId)?.file
      if (file) original = fileUrl || (fileUrl = URL.createObjectURL(file))
    }
    if (ticket !== generation) return
    if (!audio) {
      audio = new Audio()
      audio.onended = next
      audio.onerror = () => fail('音频播放失败，请重试。')
      audio.ontimeupdate = () => {
        if (state.value !== 'playing') return
        if (fullTrack) {
          currentParagraph.value = segments.value.find(s => s.start !== undefined && audio!.currentTime >= s.start && audio!.currentTime < s.end!)?.paragraph ?? null
        } else {
          const segment = segments.value[queue[cursor]]
          if (original && segment?.end !== undefined && audio!.currentTime >= segment.end) { audio!.pause(); next() }
        }
      }
    }
    fullTrack = paragraph === undefined && !!original
    if (fullTrack) {
      audio.src = original
      audio.playbackRate = rate.value
      audio.volume = setting.articleSoundVolume / 100
      const timing = segments.value.find(s => s.start !== undefined && s.start <= 0 && s.end! > 0)
      currentParagraph.value = timing?.paragraph ?? null
      if (!segments.value.some(s => s.start !== undefined)) notice.value = '原音频没有时间轴；分段播放使用文字朗读。'
      try { await audio.play(); if (ticket === generation) state.value = 'playing' }
      catch { if (ticket === generation) fail('原音频未能播放，请重试或使用段落朗读。') }
    } else {
      queue = segments.value.flatMap((s, index) => paragraph === undefined || s.paragraph === paragraph ? [index] : [])
      cursor = 0
      await playSegment()
    }
  }

  function pause() {
    if (state.value === 'idle' || state.value === 'paused') return
    if (state.value === 'loading') { generation++; controller?.abort() }
    audio?.pause()
    if (speech) window.speechSynthesis.pause()
    state.value = 'paused'
  }

  async function resume() {
    if (speech) { window.speechSynthesis.resume(); state.value = 'playing'; return }
    if (pending || !audio?.src) { if (queue.length) await playSegment(); else await play(); return }
    try { await audio.play(); state.value = 'playing' }
    catch { fail('无法继续播放，请重新选择段落。') }
  }

  watch(rate, () => {
    if (audio) audio.playbackRate = rate.value
    if (speech && state.value === 'playing') { generation++; window.speechSynthesis.cancel(); speech = null; void playSegment() }
  })
  function clear() {
    stop()
    cache.forEach(url => URL.revokeObjectURL(url)); cache.clear()
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    fileUrl = ''
  }
  watch(() => article().id, clear)
  onBeforeUnmount(clear)
  return { state, currentParagraph, error, notice, rate, play, pause, resume, stop }
}
