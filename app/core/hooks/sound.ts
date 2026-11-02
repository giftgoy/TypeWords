import { onMounted, watchEffect } from 'vue'
import { useSettingStore } from '../stores/setting'
import { ref } from 'vue'

import { ENV, PronunciationApi, SoundFileOptions } from '../config/env'
import { Toast } from '@/base'
import { withAppBaseURL } from '../utils/base-url'

/**
 * 获取当前浏览器的 OS+浏览器 组合 key，用于 ttsVoiceMap 的索引
 * 返回如 "mac+chrome" / "windows+edge" / "ios+safari" 等固定组合
 */
export function getBrowserKey(): string {
  if (typeof navigator === 'undefined') return 'unknown+unknown'
  const ua = navigator.userAgent

  let os = 'unknown'
  if (/iPad|iPhone|iPod/.test(ua)) {
    os = 'ios'
  } else if (/Android/.test(ua)) {
    os = 'android'
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    os = 'mac'
  } else if (/Windows/.test(ua)) {
    os = 'windows'
  } else if (/Linux/.test(ua)) {
    os = 'linux'
  }

  let browser = 'unknown'
  if (/Edg\//.test(ua)) {
    browser = 'edge'
  } else if (/OPR\/|Opera/.test(ua)) {
    browser = 'opera'
  } else if (/Chrome\//.test(ua)) {
    browser = 'chrome'
  } else if (/Firefox\//.test(ua)) {
    browser = 'firefox'
  } else if (/Safari\//.test(ua)) {
    browser = 'safari'
  }

  return `${os}+${browser}`
}

export function useSound(audioSrcList?: string[], audioFileLength?: number) {
  let audioList = ref<HTMLAudioElement[]>([])
  let audioLength = ref(1)
  let index = ref(0)

  onMounted(() => {
    if (audioSrcList) setAudio(audioSrcList, audioFileLength)
  })

  //这里同一个音频弄好几份是为了快速打字是，可同时发音
  function setAudio(audioSrcList2: string[], audioFileLength2?: number) {
    //@ts-ignore
    if (import.meta.server) return
    if (audioFileLength2) audioLength.value = audioFileLength2
    audioList.value = []
    for (let i = 0; i < audioLength.value; i++) {
      audioSrcList2.map(src => audioList.value.push(new Audio(ENV.RESOURCE_URL + src)))
    }
    index.value = 0
  }

  function play(volume: number = 100) {
    index.value++
    if (audioList.value.length > 1 && audioList.value.length !== audioLength.value) {
      let htmlAudioElement = audioList.value[index.value % audioList.value.length]
      if (htmlAudioElement) {
        htmlAudioElement.volume = volume / 100
        void htmlAudioElement.play().catch(() => {})
      }
    } else {
      let htmlAudioElement1 = audioList.value[index.value % audioLength.value]
      if (htmlAudioElement1) {
        htmlAudioElement1.volume = volume / 100
        void htmlAudioElement1.play().catch(() => {})
      }
    }
  }

  return { play, setAudio }
}

let keyboardPlayFn: ((volume: number) => void) | null = null
export function usePlayKeyboardAudio() {
  const settingStore = useSettingStore()

  if (!keyboardPlayFn) {
    const { play, setAudio } = useSound()

    watchEffect(() => {
      if (!settingStore.keyboardSound) return
      if (!SoundFileOptions.find(v => v.label === settingStore.keyboardSoundFile)) {
        settingStore.keyboardSoundFile = '机械键盘2'
      }
      let urlList = getAudioFileUrl(settingStore.keyboardSoundFile)
      setAudio(urlList, urlList.length === 1 ? 4 : 1)
    })

    keyboardPlayFn = play
  }

  function playAudio() {
    if (settingStore.keyboardSound) {
      keyboardPlayFn!(settingStore.keyboardSoundVolume)
    }
  }

  return playAudio
}

let playBeep = null
export function usePlayBeep() {
  const settingStore = useSettingStore()
  if (!playBeep) {
    const { play } = useSound([`/sound/beep.wav`], 1)
    playBeep = play
  }

  function playAudio() {
    if (settingStore.effectSound) {
      playBeep(settingStore.effectSoundVolume)
    }
  }

  return playAudio
}

export function usePlayCorrect() {
  const settingStore = useSettingStore()
  const { play } = useSound([`/sound/correct.wav`], 1)

  function playAudio() {
    if (settingStore.effectSound) {
      play(settingStore.effectSoundVolume)
    }
  }

  return playAudio
}

const activeWordPlayCountMap = new Map<string, number>()
let resetWordPlayCountTimer = -1

export function resetActiveWordPlayCount(word: string) {
  if (!word) return
  activeWordPlayCountMap.delete(word.trim().toLowerCase())
}

let cachedWordAudio: HTMLAudioElement | null = null
let wordPlaybackGeneration = 0
let ttsPlaybackGeneration = 0

// ---- 在线 TTS 回退（浏览器/内嵌窗口没有系统语音时使用） ----
// 百度翻译 TTS：国内可直连，支持整句；Google TTS 作为二次回退
const NETWORK_TTS_BAIDU = 'https://fanyi.baidu.com/gettts?lan=en&spd=3&source=web&text='
const NETWORK_TTS_GOOGLE = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q='

let cachedTextAudio: HTMLAudioElement | null = null

function getCachedTextAudio(): HTMLAudioElement | null {
  if (!cachedTextAudio && typeof Audio !== 'undefined') {
    cachedTextAudio = new Audio()
  }
  return cachedTextAudio
}

function stopNetworkTts() {
  const audio = getCachedTextAudio()
  if (!audio) return
  audio.onended = null
  audio.onerror = null
  audio.onplaying = null
  audio.pause()
  audio.currentTime = 0
}

function playNetworkTts(
  text: string,
  options: TTsPlayOptions,
  generation: number,
  urls = [NETWORK_TTS_BAIDU + encodeURIComponent(text), NETWORK_TTS_GOOGLE + encodeURIComponent(text)],
  onFailure?: () => void
) {
  const audio = getCachedTextAudio()
  if (!audio) {
    options.onError?.()
    options.onEnd?.()
    return
  }
  const [url, ...rest] = urls
  let settled = false
  const finish = () => {
    if (settled || generation !== ttsPlaybackGeneration) return
    settled = true
    options.onEnd?.()
  }
  const fail = () => {
    if (settled || generation !== ttsPlaybackGeneration) return
    settled = true
    if (rest.length) playNetworkTts(text, options, generation, rest, onFailure)
    else if (onFailure) onFailure()
    else {
      options.onError?.()
      options.onEnd?.()
    }
  }
  audio.onended = finish
  audio.onerror = fail
  audio.onplaying = () => {
    if (generation === ttsPlaybackGeneration) options.onStart?.()
  }
  audio.src = url
  audio.volume = options.volume ?? 1
  audio.playbackRate = options.rate ?? 1
  audio.preservesPitch = true
  void audio.play().catch(fail)
}

function getCachedWordAudio(): HTMLAudioElement | null {
  if (!cachedWordAudio && typeof Audio !== 'undefined') {
    cachedWordAudio = new Audio()
  }
  return cachedWordAudio
}

export function cancelWordPracticeAudio() {
  wordPlaybackGeneration++
  cancelTtsAudio()
  const wordAudio = getCachedWordAudio()
  if (wordAudio) {
    wordAudio.onended = null
    wordAudio.onerror = null
    wordAudio.pause()
    wordAudio.currentTime = 0
  }
}

export function cancelTtsAudio() {
  ttsPlaybackGeneration++
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel()
  }
  stopNetworkTts()
}

export function usePlayWordAudio() {
  const settingStore = useSettingStore()

  onMounted(() => {
    // @ts-ignore SSR guard
    if (import.meta.server) return
    getCachedWordAudio()
  })

  function playAudio(word: string, handle: boolean = true, onEnd?: () => void, onPlay?: () => void) {
    const wordAudio = getCachedWordAudio()
    if (!word || !wordAudio) return
    cancelWordPracticeAudio()
    const generation = ++wordPlaybackGeneration
    let playbackRate = settingStore.wordSoundSpeed
    if (handle) {
      const key = word.trim().toLowerCase()
      const count = activeWordPlayCountMap.get(key) ?? 0
      if (count % 3 !== 0) {
        playbackRate = playbackRate * 0.75
        Toast.success('0.75倍速播放')
      } else {
        Toast.closeAll()
      }
      activeWordPlayCountMap.set(key, count + 1)

      //5秒后重置，以免隔了很久播放，还是0.75倍
      clearTimeout(resetWordPlayCountTimer)
      resetWordPlayCountTimer = setTimeout(() => {
        activeWordPlayCountMap.set(key, 0)
      }, 5000)
    }
    // console.log('playAudio-handle', handle, playbackRate)
    let url = `${PronunciationApi}${word}&type=2`
    if (settingStore.soundType === 'uk') {
      url = `${PronunciationApi}${word}&type=1`
    }
    let onended = () => {
      if (generation !== wordPlaybackGeneration) return
      onEnd?.()
    }
    wordAudio.onended = onended
    wordAudio.onplay = () => onPlay?.()
    wordAudio.onerror = () => {
      if (generation !== wordPlaybackGeneration) return
      const ttsPlay = useTTsPlayAudio()
      ttsPlay(word, { rate: playbackRate, onEnd: onended })
    }
    wordAudio.src = url
    wordAudio.volume = settingStore.wordSoundVolume / 100
    wordAudio.playbackRate = playbackRate
    void wordAudio.play()
  }

  return playAudio
}

export function getVoicesAsync(timeout = 1200): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    if (typeof speechSynthesis === 'undefined') return resolve([])
    const voices = speechSynthesis.getVoices()
    if (voices.length) return resolve(voices)
    const finish = () => {
      clearTimeout(timer)
      speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(speechSynthesis.getVoices())
    }
    const onVoicesChanged = () => {
      if (speechSynthesis.getVoices().length) finish()
    }
    const timer = setTimeout(finish, timeout)
    speechSynthesis.addEventListener('voiceschanged', onVoicesChanged)
  })
}

export interface OnlineTtsVoice {
  id: string
  name: string
  lang: string
  gender: 'female' | 'male'
}

let onlineVoicesPromise: Promise<OnlineTtsVoice[]> | undefined
export function getOnlineTtsVoices(): Promise<OnlineTtsVoice[]> {
  return (onlineVoicesPromise ??= fetch(withAppBaseURL('/api/tts/voices'), { signal: AbortSignal.timeout(3000) })
    .then(response => (response.ok ? response.json() : []))
    .then(voices => (Array.isArray(voices) ? voices : []))
    .catch(() => []))
}

export interface TTsPlayOptions {
  rate?: number
  volume?: number
  pitch?: number
  lang?: string
  voice?: string
  onStart?: () => void
  onEnd?: () => void
  onError?: () => void
  onFallback?: () => void
}

export function useTTsPlayAudio() {
  const settingStore = useSettingStore()

  async function play(text: string, options: TTsPlayOptions = {}) {
    if (!text.trim()) return
    cancelTtsAudio()
    const generation = ttsPlaybackGeneration
    const resolved = {
      ...options,
      rate: options.rate ?? settingStore.wordSoundSpeed,
      volume: options.volume ?? settingStore.wordSoundVolume / 100,
      lang: options.lang ?? (settingStore.soundType === 'uk' ? 'en-GB' : 'en-US'),
    }
    const selected = options.voice ?? settingStore.ttsVoiceMap?.find(v => v.key === getBrowserKey())?.voice ?? ''
    const legacy = () => playNetworkTts(text, resolved, generation)
    const playSystem = async () => {
      const voices = await getVoicesAsync()
      if (generation !== ttsPlaybackGeneration) return
      const english = voices.filter(v => /^en[-_]/i.test(v.lang))
      const voice = english.find(v => v.name === selected) ?? english.find(v => v.lang === resolved.lang) ?? english[0]
      if (!voice) return legacy()
      const msg = new SpeechSynthesisUtterance(text)
      msg.voice = voice
      msg.lang = voice.lang
      msg.rate = resolved.rate
      msg.volume = resolved.volume
      msg.pitch = options.pitch ?? 1
      let settled = false
      msg.onstart = () => {
        if (generation === ttsPlaybackGeneration) options.onStart?.()
      }
      msg.onend = () => {
        if (settled || generation !== ttsPlaybackGeneration) return
        settled = true
        options.onEnd?.()
      }
      msg.onerror = () => {
        if (settled || generation !== ttsPlaybackGeneration) return
        settled = true
        options.onFallback?.()
        legacy()
      }
      speechSynthesis.resume()
      speechSynthesis.speak(msg)
    }
    // Existing system voice selections remain valid. Automatic mode prefers natural voices.
    if (selected && !selected.startsWith('edge:')) return playSystem()
    const onlineVoices = await getOnlineTtsVoices()
    if (generation !== ttsPlaybackGeneration) return
    const voice =
      onlineVoices.find(v => 'edge:' + v.id === selected) ??
      onlineVoices.find(v => v.lang === resolved.lang && v.gender === 'female')
    if (!voice) return playSystem()
    const query = new URLSearchParams({ text, voice: voice.id })
    playNetworkTts(text, resolved, generation, [withAppBaseURL('/api/tts/speak') + '?' + query], () => {
      options.onFallback?.()
      void playSystem()
    })
  }

  return play
}

export function usePlayAudio(url: string) {
  void new Audio(url).play().catch(() => {})
}

export function getAudioFileUrl(name: string) {
  if (name === '机械键盘') {
    return [
      `/sound/key-sounds/jixie/机械0.mp3`,
      `/sound/key-sounds/jixie/机械1.mp3`,
      `/sound/key-sounds/jixie/机械2.mp3`,
      `/sound/key-sounds/jixie/机械3.mp3`,
    ]
  } else {
    return [`/sound/key-sounds/${name}.mp3`]
  }
}
