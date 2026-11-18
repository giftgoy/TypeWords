import { onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import { PronunciationApi } from '../config/env.ts'
import { cancelTtsAudio, getVoicesAsync, useTTsPlayAudio } from '../hooks/sound.ts'
import type { Word } from '../types/types.ts'
import { useBaseStore } from '../stores/base.ts'
import { useSettingStore } from '../stores/setting.ts'
import { useListeningStore } from '../stores/listening.ts'
import {
  buildListeningQueue,
  stepQueueIndex,
  type ListeningItem,
  type ListeningOrder,
  type ListeningScope,
} from './listening-queue.ts'
import { chunkTransCn, getChunksForWord } from './chunk-links.ts'

/**
 * 磨耳朵播放引擎：一个词一个词地读，单词 → 停顿 → 中文释义 → 停顿 → 例句 → 停顿 →（词块）→ 下一个。
 *
 * - 单词用有道词典音源（和练习页一致，跟随英音/美音设置），失败退到系统语音，再不行试统一 TTS 管线；
 * - 释义/例句/词块走 sound.ts 的 useTTsPlayAudio 统一管线（设置里挑的音色、kokoro 都生效），
 *   中文没有可用音色时再退到纯系统语音；
 * - 单词音源共用一个 HTMLAudioElement，切换词时先 cancel 再放；
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
  /** 统一 TTS 管线：释义/例句/词块都走它，用户在设置里挑的音色（含 kokoro）对磨耳朵也生效 */
  const ttsPlay = useTTsPlayAudio()

  let token = 0
  let audio: HTMLAudioElement | null = null
  /** 实际在听的范围：当前范围没词时会临时退到别的词表，但不改用户的选择 */
  let effectiveScope: ListeningScope = 'current'
  /** 上次「回到前台自动续播」的时间戳，节流用，防止快速切屏反复重放 */
  let lastResumeAt = 0
  /** MediaSession 的按键 handler 是否已经设置过（幂等保护） */
  let mediaSessionReady = false

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
   * 「只听未学 / 只听到期」的范围过滤（排序仍由 buildListeningQueue 处理，这里只管筛词）：
   * - new：没有 FSRS 卡片，或卡片还没复习过（reps 为 0）的词算未学；
   * - due：有卡片且到期日不晚于今天（due 序列化后是字符串，按自然日比较，和 dict.ts 口径一致）。
   */
  function filterWordsByOrder(words: Word[], order: ListeningOrder): Word[] {
    if (order !== 'new' && order !== 'due') return words
    const fsrs = base.fsrsData ?? {}
    const cardOf = (word: string) => fsrs[word] ?? fsrs[word.trim().toLowerCase()]
    if (order === 'new') {
      return words.filter(item => {
        const card = cardOf(item.word)
        return !card || (card.reps ?? 0) === 0
      })
    }
    const today = dayjs().format('YYYY-MM-DD')
    return words.filter(item => {
      const card = cardOf(item.word)
      if (!card?.due) return false
      // 日期字符串比较即可覆盖「今天或更早到期」，不依赖 dayjs 插件
      return dayjs(card.due).format('YYYY-MM-DD') <= today
    })
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
    // 「只听未学/待复习」：先按范围过滤；过滤完没剩词就退回整个词表，给个提示
    const order = listening.options.order
    let queueWords = words
    let filterNotice = ''
    if ((order === 'new' || order === 'due') && words.length) {
      const filtered = filterWordsByOrder(words, order)
      if (filtered.length) {
        queueWords = filtered
      } else {
        filterNotice =
          order === 'new' ? '这个范围里还没有未学的单词，先听全部。' : '这个范围里今天没有到期的单词，先听全部。'
      }
    }
    // 随机排序用会话内固定种子，切选项重建队列时顺序不再乱跳；
    // limit（每轮数量）在排序之后截取：随机时等价于随机抽样，顺序时取前 N 个
    const queue = buildListeningQueue(
      queueWords,
      order,
      order === 'random' ? listening.ensureQueueSeed() : 1,
      listening.options.limit
    )
    listening.setQueue(queue)
    if (reset) listening.setIndex(0)
    if (queue.length) {
      // 范围降级和过滤降级不会同时发生：前者要求词表为空，后者要求词表非空
      const scopeNotice =
        scope === preferred
          ? ''
          : `「${SCOPE_NAMES[preferred]}」还没词，先听「${SCOPE_NAMES[scope]}」的 ${queue.length} 个词。`
      listening.setMessage(scopeNotice || filterNotice)
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

  /** 例句/词块英文朗读的语言：跟随英音/美音设置 */
  const enLang = () => (setting.soundType === 'uk' ? 'en-GB' : 'en-US')

  /**
   * 把 useTTsPlayAudio 的回调风格包成 Promise：读完 true，失败 false。
   * 不传 voice，音色完全交给统一管线按用户设置挑（包括 kokoro）；
   * onFallback 只代表「系统语音不行、正在换在线 TTS」，不算失败，重置超时继续等结果。
   */
  function ttsSpeak(text: string, options: { lang: string; volume: number }): Promise<boolean> {
    if (!text.trim()) return Promise.resolve(false)
    return new Promise<boolean>(resolve => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(ok)
      }
      const armTimer = () => {
        clearTimeout(timer)
        timer = setTimeout(() => finish(false), 25000)
      }
      armTimer()
      void ttsPlay(text, {
        lang: options.lang,
        volume: options.volume,
        rate: rate(),
        onEnd: () => finish(true),
        onError: () => finish(false),
        onFallback: armTimer,
      })
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
        // 跟随英音/美音设置：type=1 是英音，type=2 是美音（和 sound.ts 的 usePlayWordAudio 一致）
        element.src = `${PronunciationApi}${encodeURIComponent(word)}&type=${setting.soundType === 'uk' ? 1 : 2}`
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
    // 主路径已接入统一 TTS 管线（在线 TTS 走的是 sound.ts 里的音频），停止时也要一并停掉
    cancelTtsAudio()
  }

  async function playCurrent() {
    const item = listening.current
    if (!item || !listening.playing) return
    const myToken = ++token

    // 当前词推给系统媒体中心（锁屏/通知栏可见），不支持的环境内部静默跳过
    updateMediaSessionMetadata(item)
    // 上一轮的词块展示清掉，保证 currentChunk 始终属于当前词
    listening.setCurrentChunk(null)

    listening.setStage('word')
    // 单词读音：词典音源最标准，失败才退统一 TTS 管线（在线音色）
    const wordPlayed = await pronounce(item.word)
    if (myToken !== token) return
    if (!wordPlayed) {
      await ttsSpeak(item.word, { lang: enLang(), volume: wordVolume() })
      if (myToken !== token) return
    }

    if (listening.options.readMeaning && (item.spoken || item.meaning)) {
      await delay(400)
      if (myToken !== token) return
      listening.setStage('meaning')
      // 只读最常用那条，读整段释义会让每个词拖到十几秒
      const text = item.spoken || spokenMeaning(item.meaning)
      const ok = await ttsSpeak(text, { lang: 'zh-CN', volume: wordVolume() })
      if (myToken !== token) return
      // 浏览器没有中文音色时退回纯系统语音直接念，再失败就跳过这段继续
      if (!ok) {
        await speak(text, 'zh', wordVolume())
        if (myToken !== token) return
      }
    }

    if (listening.options.readExample && item.examples.length) {
      await delay(350)
      if (myToken !== token) return
      listening.setStage('example')
      // rotateExample 开启时按轮次换一句，否则恒读第一句（轮次越界自然取模，取不到兜底第一条）
      const pool = listening.options.rotateExample ? item.examples : item.examples.slice(0, 1)
      const sentence = pool[listening.rotation % pool.length] ?? ''
      const ok = await ttsSpeak(sentence, { lang: enLang(), volume: sentenceVolume() })
      if (myToken !== token) return
      // 实际读完了才推进轮次，下一轮换下一条
      if (ok) listening.setRotation(listening.rotation + 1)
    }

    // 词块朗读：反查包含当前单词的词块（索引是惰性加载的，第一次可能要等一会儿，token 防护会兜底）
    if (listening.options.readChunk) {
      await delay(350)
      if (myToken !== token) return
      const chunks = await getChunksForWord(item.word)
      if (myToken !== token) return
      // 词块和例句共用同一个轮次计数，按轮次换词块
      const chunk = chunks.length ? chunks[listening.rotation % chunks.length] : null
      if (chunk) {
        listening.setCurrentChunk({ word: chunk.word, cn: chunkTransCn(chunk) })
        listening.setStage('chunk')
        const ok = await ttsSpeak(chunk.word, { lang: enLang(), volume: sentenceVolume() })
        if (myToken !== token) return
        // 读完推进轮次；读失败就清掉展示直接跳过
        if (ok) {
          listening.setRotation(listening.rotation + 1)
        } else {
          listening.setCurrentChunk(null)
        }
      } else {
        listening.setCurrentChunk(null)
      }
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
    syncMediaPlaybackState()
    void playCurrent()
  }

  function pause() {
    listening.setPlaying(false)
    stopPlayback()
    syncMediaPlaybackState()
  }

  function toggle() {
    if (listening.playing) pause()
    else start()
  }

  function stop() {
    listening.setPlaying(false)
    stopPlayback()
    syncMediaPlaybackState()
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

  // ---- MediaSession：锁屏/通知栏显示当前词，耳机键可以控制播放 ----
  /** 组合函数初始化时设置一次按键 handler；不支持的环境直接跳过 */
  function setupMediaSession() {
    if (mediaSessionReady) return
    mediaSessionReady = true
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        if (!listening.playing) start()
      })
      navigator.mediaSession.setActionHandler('pause', () => pause())
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1))
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1))
    } catch {
      /* 个别浏览器不支持某些 action，忽略即可 */
    }
  }

  /** 播放中的词推给系统媒体中心，锁屏上能看到当前在听哪个词 */
  function updateMediaSessionMetadata(item: ListeningItem) {
    try {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.word,
        artist: item.spoken || item.meaning.slice(0, 40),
        album: 'TypeWords 磨耳朵',
      })
    } catch {
      /* 不支持的环境静默跳过 */
    }
  }

  /** 播放状态变化时同步给系统媒体中心（影响锁屏上播放/暂停按钮的样子） */
  function syncMediaPlaybackState() {
    try {
      if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
      navigator.mediaSession.playbackState = listening.playing ? 'playing' : 'paused'
    } catch {
      /* 不支持的环境静默跳过 */
    }
  }

  // ---- 切后台再回来：移动端浏览器常会把进行中的播放杀掉，回到前台自动续上 ----
  function onVisibilityChange() {
    if (document.hidden || !listening.playing) return
    // 时间戳节流：1.5 秒内只续播一次，防止快速切屏反复重放
    const now = Date.now()
    if (now - lastResumeAt < 1500) return
    // 只有当前确实没有声音在播（词典音频暂停着、系统语音也没在说/排队）才需要续播
    const audioIdle = !audio || audio.paused
    const ttsIdle = typeof speechSynthesis === 'undefined' || (!speechSynthesis.speaking && !speechSynthesis.pending)
    if (!audioIdle || !ttsIdle) return
    lastResumeAt = now
    // 先把旧链停掉（token 作废，统一管线里可能残留的在线 TTS 也一并停），再从头播当前词
    stopPlayback()
    void playCurrent()
  }

  // 换范围/顺序/每轮数量要重建队列；正在播的话从新队列第一个继续
  watch(
    () => [listening.options.scope, listening.options.order, listening.options.limit],
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

  setupMediaSession()
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  onBeforeUnmount(() => {
    token++
    if (audio) audio.pause()
    // 统一管线内部会 cancel 系统语音，也会停掉在线 TTS 的音频
    cancelTtsAudio()
    document.removeEventListener('visibilitychange', onVisibilityChange)
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
