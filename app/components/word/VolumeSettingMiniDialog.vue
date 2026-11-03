<script setup lang="ts">
import { MiniDialog, Option, Select, Switch, VolumeIcon } from '@/base'
import { ENV, SoundFileOptions } from '@/core/config/env.ts'
import { useWindowClick } from '@/core/hooks/event.ts'
import { getAudioFileUrl, usePlayAudio } from '@/core/hooks/sound.ts'
import { useSettingStore } from '@/core/stores/setting.ts'
import { emitter, EventKey } from '@/core/utils/eventBus'

const settingStore = useSettingStore()
// 下拉列表挂载在 body 中，选择选项时保留音效面板。
let selectIsOpen = false
let show = $ref(false)

useWindowClick(() => {
  if (selectIsOpen) {
    selectIsOpen = false
  } else {
    show = false
  }
})

function toggle() {
  if (!show) emitter.emit(EventKey.closeOther)
  show = !show
}

function selectToggle(e: boolean) {
  //这里要延时设置，因为关闭的时候，如果太早设置了false了，useWindowClick的事件就会把弹框关闭
  setTimeout(() => (selectIsOpen = e))
}

function eventCheck(e) {
  const isSelfOrChild = e.currentTarget.contains(e.target)
  if (isSelfOrChild) {
    //如果下拉框打开的情况就不拦截
    if (selectIsOpen) return
    e.stopPropagation()
  }
}
</script>

<template>
  <div class="setting" @click="eventCheck">
    <button
      type="button"
      class="sound-trigger"
      aria-label="音效设置"
      :aria-expanded="show"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <IconClarityVolumeUpLine />
    </button>
    <MiniDialog width="20rem" v-model="show" aria-label="音效设置" @click.stop>
      <div class="mini-header">
        <div class="mini-row-title">音效设置</div>
        <button type="button" class="sound-trigger" aria-label="关闭音效设置" @click="show = false">
          <IconFluentDismiss20Regular />
        </button>
      </div>
      <div class="mini-row">
        <label class="item-title">{{ $t('word_auto_pronunciation') }}</label>
        <div class="wrapper">
          <Switch v-model="settingStore.wordSound" />
        </div>
      </div>
      <div class="mini-row">
        <label class="item-title">{{ $t('pronunciation_accent') }}</label>
        <div class="wrapper">
          <Select v-model="settingStore.soundType" @toggle="selectToggle" placeholder="请选择" size="small">
            <Option label="美音" value="us" />
            <Option label="英音" value="uk" />
          </Select>
        </div>
      </div>

      <div class="mini-row">
        <label class="item-title">{{ $t('auto_play_first_sentence') }}</label>
        <div class="wrapper">
          <Switch v-model="settingStore.autoPlayFirstSentence" />
        </div>
      </div>
      <div class="mini-row">
        <label class="item-title">{{ $t('keyboard_sound') }}</label>
        <div class="wrapper">
          <Switch v-model="settingStore.keyboardSound" />
        </div>
      </div>
      <div class="mini-row">
        <label class="item-title">{{ $t('keyboard_sound_effect') }}</label>
        <div class="wrapper">
          <Select v-model="settingStore.keyboardSoundFile" @toggle="selectToggle" placeholder="请选择" size="small">
            <Option v-for="item in SoundFileOptions" :key="item.value" :label="item.label" :value="item.value">
              <div class="el-option-row">
                <span>{{ item.label }}</span>
                <VolumeIcon :time="100" @click="usePlayAudio(ENV.RESOURCE_URL + getAudioFileUrl(item.value)[0])" />
              </div>
            </Option>
          </Select>
        </div>
      </div>
      <div class="mini-row">
        <label class="item-title">{{ $t('effect_sound') }}</label>
        <div class="wrapper">
          <Switch v-model="settingStore.effectSound" />
        </div>
      </div>
    </MiniDialog>
  </div>
</template>

<style scoped lang="scss">
.wrapper {
  min-width: 0;
  position: relative;
  text-align: right;
}

.setting {
  position: relative;
}

.mini-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(80px, 45%);
  gap: 12px;
}

.item-title {
  word-break: normal;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.5;
}

.el-option-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;

  gap: 8px;
}

.mini-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.mini-header .mini-row-title {
  margin: 0;
}
.sound-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 20px;
  cursor: pointer;
  &:hover {
    background: var(--color-fourth);
  }
  &:focus-visible {
    outline: 2px solid var(--color-select-bg);
    outline-offset: 2px;
  }
}
@media (pointer: coarse), (max-width: 768px) {
  .sound-trigger {
    width: 44px;
    height: 44px;
  }
}
</style>
