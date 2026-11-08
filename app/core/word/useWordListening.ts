import { onBeforeUnmount, watch } from 'vue'
import { PronunciationApi } from '../config/env.ts'
import { getVoicesAsync } from '../hooks/sound.ts'
import type { Word } from '../types/types.ts'
import { useBaseStore } from '../stores/base.ts'
import { useSettingStore } from '../stores/setting.ts'
import { useListeningStore } from '../stores/listening.ts'
import { buildListeningQueue, stepQueueIndex, type ListeningScope } from './listening-queue.ts'

/**
 * 磨耳朵播放引擎：一个词一个词地读，单词 → 停顿 → 中文释义 → 停顿 → 例句 → 停顿 → 下一个。
 *
 * - 单词用有道词典音源（和练习页一致），失败退到系统语音；
 * - 释义/例句用系统语音（中文/英文分别挑声音）；
 * - 所有播放共用一个 HTMLAudioElement，切换词时先 cancel 再放；
 * - 每次操作都换 token，旧的异步链自然作废，不会出现两个词重叠读。
 */

/** 词性标记（n. / adj. / vt.）念出来很怪，释义送进 TTS 前先剥掉 */
const POS_PATTERN = /\b(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr|pl)\.\s*/gi

export function spokenMeaning(meaning: string) {
  return meaning.replace(POS_PATTERN, ' ').replace(/\s+/g, ' ').trim()
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

const SCOPE_NAMES: Record<ListeningScope, string> = {
  current: '当前词库',
  collect: '收藏',
  wrong: '错词',
  known: '已掌握',
}

export function useWordListening() {
  const base = useBaseStore()
  const setting = useSettingStore()
  const listening = useListeningStore()

  let token = 0
  let audio: HTMLAudioElement | null = null
  /** 实际在听的范围：当前范围没词时会临时退到别的词表，但不改用户的选择 */
  let effectiveScope: ListeningScope = 'current'

  function ensureAudio(): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null
    audio ??= new Audio()
    return audio
  }

  const wordVolume = () => Math.min(1, Math.max(0, (setting.wordSoundVolume ?? 100) / 100))
  const sentenceVolume = () => Math.min(1, Math.max(0, (setting.sentenceSoundVolume ?? 100) / 100))
  const rate = () => Math.min(2, Math.max(0.5, listening.options.rate || 1))

  function wordsOfScope(scope: ListeningScope): Word[] {
    if (scope === 'collect') return base.collectWord.words ?? []
    if (scope === 'wrong') return base.wrong.words ?? []
    if (scope === 'known') return base.known.words ?? []
    return base.sdict.words ?? []
  }

  /**
   * 重新取词并建队列；范围/顺序变了、或词库刚加载完都要重建。
   * autoFallback：选的范围没词时临时退到别的词表，只影响本次队列，不改用户选择——
   * 等用户把词库选好，下面那个 watch 会自动切回来。
   */
  function rebuildQueue(reset = true, autoFallback = false) {
    const preferred = listening.options.scope
    let scope = preferred
    let words = wordsOfScope(scope)
    // 数据没读完之前别急着 fallback，否则会误判成「当前词库是空的」
    if (autoFallback && !words.length && base.load) {
      for (const candidate of ['current', 'collect', 'wrong', 'known'] as ListeningScope[]) {
        if (candidate === preferred) continue
        const candidateWords = wordsOfScope(candidate)
        if (candidateWords.length) {
          scope = candidate
          words = candidateWords
          break
        }
      }
    }
    effectiveScope = scope
    const queue = buildListeningQueue(words, listening.options.order, listening.options.order === 'random' ? Date.now() : 1)
    listening.setQueue(queue)
    if (reset) listening.setIndex(0)
    if (queue.length) {
      listening.setMessage(
        scope === preferred ? '' : `「${SCOPE_NAMES[preferred]}」还没词，先听「${SCOPE_NAMES[scope]}」的 ${queue.length} 个词。`
      )
    } else if (!base.load) {
      listening.setMessage('正在读取词库…')
    } else {
      listening.setMessage('这个词表里还没有单词，换个范围，或先在词库里导入单词。')
    }
    return queue
  }

  function pickVoice(voices: SpeechSynthesisVoice[], lang: 'en' | 'zh') {
    if (lang === 'zh') {
      return (
        voices.find(voice => /^zh[-_]CN/i.test(voice.lang) && /female|xiaoxiao|tingting|mei/i.test(voice.name)) ??
        voices.find(voice => /^zh[-_]CN/i.test(voice.lang)) ??
        voices.find(voice => /^zh/i.test(voice.lang)) ??
        null
      )
    }
    const prefer = setting.soundType === 'uk' ? /^en[-_]GB/i : /^en[-_]US/i
    return (
      voices.find(voice => prefer.test(voice.lang) && /natural|aria|jenny|samantha|google/i.test(voice.name)) ??
      voices.find(voice => prefer.test(voice.lang)) ??
      voices.find(voice => /^en[-_]/i.test(voice.lang)) ??
      null
    )
  }

  async function speak(text: string, lang: 'en' | 'zh', volume: number): Promise<boolean> {
    if (!text.trim() || typeof speechSynthesis === 'undefined') return false
    const voices = await getVoicesAsync()
    const message = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(voices, lang)
    if (voice) {
      message.voice = voice
      message.lang = voice.lang
    } else {
      message.lang = lang === 'zh' ? 'zh-CN' : 'en-US'
    }
    message.rate = rate()
    message.volume = volume
    return new Promise<boolean>(resolve => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), 25000)
      message.onend = () => finish(true)
      message.onerror = () => finish(false)
      try {
        speechSynthesis.resume()
        speechSynthesis.speak(message)
      } catch {
        finish(false)
      }
    })
  }

  /** 单词发音：先用词典音源，拿不到或有声无音就换系统语音 */
  async function pronounce(word: string): Promise<boolean> {
    const element = ensureAudio()
    if (!element) return speak(word, 'en', wordVolume())
    const played = await new Promise<boolean>(resolve => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        element.onended = null
        element.onerror = null
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), 6000)
      element.onended = () => finish(true)
      element.onerror = () => finish(false)
      try {
        element.src = `${PronunciationApi}${encodeURIComponent(word)}&type=2`
        element.volume = wordVolume()
        element.playbackRate = rate()
        void element.play().catch(() => finish(false))
      } catch {
        finish(false)
      }
    })
    if (played) return true
    element.pause()
    return speak(word, 'en', wordVolume())
  }

  function stopPlayback() {
    token++
    if (audio) audio.pause()
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }

  async function playCurrent() {
    const item = listening.current
    if (!item || !listening.playing) return
    const myToken = ++token

    listening.setStage('word')
    await pronounce(item.word)
    if (myToken !== token) return

    if (listening.options.readMeaning && (item.spoken || item.meaning)) {
      await delay(400)
      if (myToken !== token) return
      listening.setStage('meaning')
      // 只读最常用那条，读整段释义会让每个词拖到十几秒
      await speak(item.spoken || spokenMeaning(item.meaning), 'zh', wordVolume())
      if (myToken !== token) return
    }

    if (listening.options.readExample && item.example) {
      await delay(350)
      if (myToken !== token) return
      listening.setStage('example')
      await speak(item.example, 'en', sentenceVolume())
      if (myToken !== token) return
    }

    listening.setStage('gap')
    await delay(Math.max(0, listening.options.pauseSeconds) * 1000)
    if (myToken !== token || !listening.playing) return

    listening.setIndex(stepQueueIndex(listening.index, listening.items.length, 1))
    void playCurrent()
  }

  function start(index?: number) {
    if (!listening.items.length) rebuildQueue(true, true)
    if (!listening.items.length) {
      listening.setPlaying(false)
      return
    }
    if (typeof index === 'number') listening.setIndex(index)
    listening.setPlaying(true)
    void playCurrent()
  }

  function pause() {
    listening.setPlaying(false)
    stopPlayback()
  }

  function toggle() {
    if (listening.playing) pause()
    else start()
  }

  function stop() {
    listening.setPlaying(false)
    stopPlayback()
  }

  function step(offset: 1 | -1) {
    const wasPlaying = listening.playing
    stopPlayback()
    listening.setIndex(stepQueueIndex(listening.index, listening.items.length, offset))
    if (wasPlaying) {
      listening.setPlaying(true)
      void playCurrent()
    }
  }

  // 换范围/顺序要重建队列；正在播的话从新队列第一个继续
  watch(
    () => [listening.options.scope, listening.options.order],
    () => {
      const wasPlaying = listening.playing
      rebuildQueue(true)
      if (wasPlaying && listening.items.length) {
        listening.setPlaying(true)
        void playCurrent()
      } else if (!listening.items.length) {
        listening.setPlaying(false)
        stopPlayback()
      }
    }
  )

  // 词库是异步从 IndexedDB 读出来的：加载完成、或某个范围补进词以后，
  // 队列空就重建；如果之前是临时降级到别的词表，用户选的范围一有词就切回来
  watch(
    () => [
      base.load,
      base.sdict.words?.length ?? 0,
      base.collectWord.words?.length ?? 0,
      base.wrong.words?.length ?? 0,
      base.known.words?.length ?? 0,
    ],
    () => {
      if (listening.playing) return
      const preferredHasWords = wordsOfScope(listening.options.scope).length > 0
      const drifted = effectiveScope !== listening.options.scope
      if (!listening.items.length || (drifted && preferredHasWords)) {
        rebuildQueue(!listening.items.length, true)
      }
    }
  )

  onBeforeUnmount(() => {
    token++
    if (audio) audio.pause()
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  })

  return {
    start,
    pause,
    toggle,
    stop,
    next: () => step(1),
    prev: () => step(-1),
    rebuildQueue,
    spokenMeaning,
  }
}
