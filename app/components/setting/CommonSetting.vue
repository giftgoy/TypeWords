<script setup lang="ts">
import { Switch } from '@/base'
import SettingItem from './SettingItem.vue'
import { useSettingStore } from '@/core/stores/setting.ts'
import { useBaseStore } from '@/core/stores/base.ts'
import SimpleWordFilterControl from '@/components/word/SimpleWordFilterControl.vue'

const guide = useLearningGuide()
const settingStore = useSettingStore()
const store = useBaseStore()
</script>

<template>
  <div>
    <SettingItem :title="$t('ignore_case')" desc="开启后，输入时不区分大小写，如输入“hello”和“Hello”都会被认为是正确的">
      <Switch v-model="settingStore.ignoreCase" />
    </SettingItem>

    <div class="line"></div>
    <SettingItem :title="$t('cross_dict_dedup')" :desc="$t('cross_dict_dedup_desc')">
      <Switch v-model="settingStore.crossDictDedup" />
    </SettingItem>

    <div class="line"></div>
    <SimpleWordFilterControl :words="store.sdict.words" />
    <div class="line"></div>
    <SettingItem title="入门引导" desc="从选择词典到开始练习，随时可以重新查看。关闭引导不会删除学习数据。"
      ><button type="button" class="guide-entry-button" @click="guide.start">重看入门引导</button></SettingItem
    >
  </div>
</template>

<style scoped lang="scss"></style>
