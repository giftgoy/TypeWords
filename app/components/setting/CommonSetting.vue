<script setup lang="ts">
import { Switch } from '@/base'
import SettingItem from './SettingItem.vue'
import { useSettingStore } from '@/core/stores/setting.ts'
import { useBaseStore } from '@/core/stores/base.ts'
import SimpleWordFilterControl from '@/components/word/SimpleWordFilterControl.vue'

const settingStore = useSettingStore()
const store = useBaseStore()
</script>

<template>
  <div>
    <SettingItem :title="$t('ignore_case')" desc="开启后，输入时不区分大小写，如输入“hello”和“Hello”都会被认为是正确的">
      <Switch v-model="settingStore.ignoreCase" />
    </SettingItem>

    <div class="line"></div>
    <SimpleWordFilterControl :words="store.sdict.words" />
  </div>
</template>

<style scoped lang="scss"></style>
