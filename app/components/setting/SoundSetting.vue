<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Option, Select, Slider, Switch, VolumeIcon } from '@/base'
import SettingItem from './SettingItem.vue'
import SoundMasterControl from './SoundMasterControl.vue'
import { useSettingStore } from '@/core/stores/setting.ts'
import { ENV, SoundFileOptions } from '@/core/config/env.ts'
import {
  cancelTtsAudio,
  getBrowserKey,
  getAudioFileUrl,
  getOnlineTtsVoices,
  getVoicesAsync,
  usePlayAudio,
  useTTsPlayAudio,
  type OnlineTtsVoice,
} from '@/core/hooks/sound.ts'
import {
  useSoundMasterSettings,
  SOUND_VOLUME_ITEMS,
  SOUND_SPEED_ITEMS,
} from '@/core/composables/useSoundMasterSettings.ts'

const settingStore = useSettingStore()
const {
  volumeExpanded,
  volumeIsUnified,
  volumeMaster,
  volumeToggleExpanded,
  speedExpanded,
  speedIsUnified,
  speedMaster,
  speedToggleExpanded,
} = useSoundMasterSettings()

const showVolumeSubsInSections = computed(() => !volumeIsUnified.value && !volumeExpanded.value)
const showSpeedSubsInSections = computed(() => !speedIsUnified.value && !speedExpanded.value)
const showVolumeSubsInMaster = computed(() => volumeExpanded.value)
const showSpeedSubsInMaster = computed(() => speedExpanded.value)

// ---- TTS 音色 ----
const ttsVoiceList = ref<SpeechSynthesisVoice[]>([])
const onlineVoices = ref<OnlineTtsVoice[]>([])
const voicesLoading = ref(true)
const previewState = ref<'idle' | 'loading' | 'playing' | 'error'>('idle')
const usedFallback = ref(false)
const ttsPlay = useTTsPlayAudio()
const { t } = useI18n()

function loadSystemVoices() {
  ttsVoiceList.value = speechSynthesis
    .getVoices()
    .filter(v => /^en[-_]/i.test(v.lang))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
}

onMounted(async () => {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener('voiceschanged', loadSystemVoices)
  const [online, system] = await Promise.all([getOnlineTtsVoices(), getVoicesAsync()])
  onlineVoices.value = online
  ttsVoiceList.value = system.filter(v => /^en[-_]/i.test(v.lang))
  voicesLoading.value = false
})

onBeforeUnmount(() => {
  stopPreview()
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.removeEventListener('voiceschanged', loadSystemVoices)
})

const browserKey = getBrowserKey()

const currentTtsVoice = computed({
  get() {
    return settingStore.ttsVoiceMap?.find(v => v.key === browserKey)?.voice ?? ''
  },
  set(voiceName: string) {
    const map = settingStore.ttsVoiceMap ? [...settingStore.ttsVoiceMap] : []
    const idx = map.findIndex(v => v.key === browserKey)
    if (idx >= 0) {
      map[idx] = { key: browserKey, voice: voiceName }
    } else {
      map.push({ key: browserKey, voice: voiceName })
    }
    settingStore.ttsVoiceMap = map
  },
})

const selectedVoiceAvailable = computed(
  () =>
    !currentTtsVoice.value ||
    onlineVoices.value.some(v => 'edge:' + v.id === currentTtsVoice.value) ||
    ttsVoiceList.value.some(v => v.name === currentTtsVoice.value)
)
const exampleText = ref('How are you? I am fine, thank you. And you?')
const previewActive = computed(() => previewState.value === 'loading' || previewState.value === 'playing')

function voiceLabel(voice: OnlineTtsVoice) {
  return (
    voice.name +
    ' · ' +
    t(voice.lang === 'en-GB' ? 'uk_accent' : 'us_accent') +
    ' · ' +
    t(voice.gender === 'female' ? 'tts_female' : 'tts_male')
  )
}

function stopPreview() {
  if (previewActive.value) cancelTtsAudio()
  previewState.value = 'idle'
}

watch(currentTtsVoice, stopPreview)

function previewTtsVoice() {
  if (previewActive.value) return stopPreview()
  previewState.value = 'loading'
  usedFallback.value = false
  void ttsPlay(exampleText.value, {
    voice: currentTtsVoice.value,
    rate: settingStore.sentenceSoundSpeed,
    volume: settingStore.sentenceSoundVolume / 100,
    onStart: () => {
      previewState.value = 'playing'
    },
    onEnd: () => {
      if (previewState.value !== 'error') previewState.value = 'idle'
    },
    onError: () => {
      previewState.value = 'error'
    },
    onFallback: () => {
      usedFallback.value = true
    },
  })
}
</script>

<template>
  <div>
    <!-- 总音量 / 总倍速 -->
    <SoundMasterControl
      v-model="volumeMaster"
      type="volume"
      :is-unified="volumeIsUnified"
      :expanded="volumeExpanded"
      :show-subs-in-master="showVolumeSubsInMaster"
      :items="SOUND_VOLUME_ITEMS"
      @toggle-expanded="volumeToggleExpanded()"
    />
    <SoundMasterControl
      v-model="speedMaster"
      type="speed"
      :is-unified="speedIsUnified"
      :expanded="speedExpanded"
      :show-subs-in-master="showSpeedSubsInMaster"
      :items="SOUND_SPEED_ITEMS"
      @toggle-expanded="speedToggleExpanded()"
    />

    <div class="line"></div>

    <!-- 单词发音 -->
    <SettingItem :mainTitle="$t('word_pronunciation')" />

    <SettingItem :title="$t('word_auto_pronunciation')">
      <Switch v-model="settingStore.wordSound" />
    </SettingItem>
    <SettingItem :title="$t('pronunciation_accent')" :desc="$t('pronunciation_accent_desc')">
      <Select v-model="settingStore.soundType" :placeholder="$t('please_select')" class="w-50!">
        <Option :label="$t('us_accent')" value="us" />
        <Option :label="$t('uk_accent')" value="uk" />
      </Select>
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('volume')">
      <Slider v-model="settingStore.wordSoundVolume" showText showValue unit="%" />
    </SettingItem>
    <SettingItem v-if="showSpeedSubsInSections" :title="$t('speed')">
      <Slider v-model="settingStore.wordSoundSpeed" :step="0.1" :min="0.5" :max="3" showText showValue />
    </SettingItem>

    <!-- 例句发音 -->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('sentence_pronunciation')" />
    <SettingItem :title="$t('auto_play_first_sentence')" :desc="$t('auto_play_first_sentence_desc')">
      <Switch v-model="settingStore.autoPlayFirstSentence" />
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('sentence_volume')">
      <Slider v-model="settingStore.sentenceSoundVolume" showText showValue unit="%" />
    </SettingItem>
    <SettingItem v-if="showSpeedSubsInSections" :title="$t('sentence_speed')">
      <Slider v-model="settingStore.sentenceSoundSpeed" :step="0.1" :min="0.5" :max="3" showText showValue />
    </SettingItem>
    <section class="tts-settings" :aria-label="$t('tts_voice_setting_title')">
      <div class="tts-heading">
        <h3>{{ $t('tts_voice_setting_title') }}</h3>
        <span v-if="onlineVoices.length" class="tts-badge">{{ $t('tts_natural_voices') }}</span>
      </div>
      <p class="tts-description">{{ $t('tts_voice_setting_desc') }}</p>
      <label class="tts-label" for="tts-voice">{{ $t('tts_select_placeholder') }}</label>
      <select id="tts-voice" v-model="currentTtsVoice" class="tts-select" :disabled="voicesLoading">
        <option value="">{{ $t('tts_auto_voice') }}</option>
        <optgroup v-if="onlineVoices.length" :label="$t('tts_natural_voices')">
          <option v-for="voice in onlineVoices" :key="voice.id" :value="'edge:' + voice.id">
            {{ voiceLabel(voice) }}
          </option>
        </optgroup>
        <optgroup v-if="ttsVoiceList.length" :label="$t('tts_system_voices')">
          <option v-for="voice in ttsVoiceList" :key="voice.voiceURI" :value="voice.name">
            {{ voice.name }} · {{ voice.lang }} · {{ $t(voice.localService ? 'tts_local_voice' : 'tts_network_voice') }}
          </option>
        </optgroup>
        <option v-if="!selectedVoiceAvailable" :value="currentTtsVoice">
          {{ currentTtsVoice }} · {{ $t('tts_voice_unavailable') }}
        </option>
      </select>
      <p class="tts-description" role="status">
        {{
          $t(voicesLoading ? 'tts_loading_voices' : onlineVoices.length ? 'tts_online_ready' : 'tts_online_unavailable')
        }}
      </p>
      <label class="tts-label" for="tts-preview-text">{{ $t('tts_voice_preview_sentence') }}</label>
      <textarea
        id="tts-preview-text"
        v-model="exampleText"
        rows="2"
        maxlength="500"
        class="tts-preview-text"
      ></textarea>
      <div class="tts-preview-actions">
        <button type="button" class="tts-preview-button" :disabled="!exampleText.trim()" @click="previewTtsVoice">
          <IconFluentStop20Regular v-if="previewActive" />
          <IconBxVolumeFull v-else />
          {{ $t(previewActive ? 'tts_stop_preview' : 'tts_preview') }}
        </button>
        <span class="tts-description" aria-live="polite">
          {{
            $t(
              previewState === 'loading'
                ? 'tts_loading_audio'
                : previewState === 'playing'
                  ? 'tts_playing'
                  : 'tts_preview_settings'
            )
          }}
        </span>
      </div>
      <p v-if="usedFallback" class="tts-description" role="status">{{ $t('tts_using_fallback') }}</p>
      <p v-if="previewState === 'error'" class="tts-error" role="alert">{{ $t('tts_preview_failed') }}</p>
    </section>

    <!-- 文章音效 -->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('article_sound_settings')" />
    <SettingItem :title="$t('auto_play_sentence')">
      <Switch v-model="settingStore.articleSound" />
    </SettingItem>
    <SettingItem :title="$t('play_next_after_end')">
      <Switch v-model="settingStore.articleAutoPlayNext" />
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('article_volume')">
      <Slider v-model="settingStore.articleSoundVolume" showText showValue unit="%" />
    </SettingItem>
    <SettingItem v-if="showSpeedSubsInSections" :title="$t('article_speed')">
      <Slider v-model="settingStore.articleSoundSpeed" :step="0.1" :min="0.5" :max="3" showText showValue />
    </SettingItem>

    <!-- 按键音效 -->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('keyboard_sound_settings')" />
    <SettingItem :title="$t('keyboard_sound')">
      <Switch v-model="settingStore.keyboardSound" />
    </SettingItem>
    <SettingItem :title="$t('keyboard_sound_effect')">
      <Select v-model="settingStore.keyboardSoundFile" :placeholder="$t('please_select')" class="w-50!">
        <Option v-for="item in SoundFileOptions" :key="item.value" :label="item.label" :value="item.value">
          <div class="flex justify-between items-center w-full">
            <span>{{ item.label }}</span>
            <VolumeIcon :time="100" @click="usePlayAudio(ENV.RESOURCE_URL + getAudioFileUrl(item.value)[0])" />
          </div>
        </Option>
      </Select>
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('volume')">
      <Slider v-model="settingStore.keyboardSoundVolume" showText showValue unit="%" />
    </SettingItem>

    <!-- 效果音 -->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('effect_sound_settings')" />
    <SettingItem :title="$t('effect_sound')">
      <Switch v-model="settingStore.effectSound" />
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('effect_volume')">
      <Slider v-model="settingStore.effectSoundVolume" showText showValue unit="%" />
    </SettingItem>
  </div>
</template>

<style scoped lang="scss">
.line {
  border-bottom: 1px solid var(--color-line, #c4c3c3);
  margin: 0.8rem 0;
}

.tts-settings {
  margin: 20px 0;
}
.tts-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.tts-heading h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
}
.tts-badge {
  font-size: 12px;
  color: var(--color-link);
  background: var(--color-third);
  padding: 4px 8px;
  border-radius: 4px;
}
.tts-description {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-font-3);
  margin: 8px 0 12px;
}
.tts-label {
  display: block;
  font-size: 14px;
  margin: 12px 0 8px;
}
.tts-select,
.tts-preview-text {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-input-border);
  border-radius: 6px;
  background: var(--color-second);
  color: var(--color-main-text);
  font: inherit;
  padding: 10px 12px;
  &:focus-visible {
    outline: 2px solid var(--color-select-bg);
    outline-offset: 2px;
  }
}
.tts-select {
  min-height: 44px;
  text-overflow: ellipsis;
}
.tts-preview-text {
  resize: vertical;
  min-height: 80px;
  line-height: 1.6;
}
.tts-preview-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.tts-preview-actions .tts-description {
  margin: 0;
}
.tts-preview-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 16px;
  font: inherit;
  color: var(--color-main-text);
  background: var(--color-third);
  border: 1px solid var(--color-input-border);
  border-radius: 6px;
  cursor: pointer;
  &:hover {
    background: var(--color-fourth);
  }
  &:focus-visible {
    outline: 2px solid var(--color-select-bg);
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
.tts-error {
  color: #d9564d;
  font-size: 14px;
}
</style>
