<script setup lang="ts">
import { useSettingStore } from '@/core/stores/setting.ts'
import { useRouter, useRoute } from 'vue-router'
import { withAppBaseURL } from '@/core/utils/base-url'

const settingStore = useSettingStore()
const router = useRouter()
const route = useRoute()
const darkLogoSrc = withAppBaseURL('/imgs/logo/logo-text-black.png')
const lightLogoSrc = withAppBaseURL('/imgs/logo/logo-text-white.png')

// 本地部署：点击 Logo 只在站内返回首页，不再跳转到外部站点
function goHome() {
  if (route.path !== '/') {
    router.push('/')
  }
}
</script>

<template>
  <div class="center" @click="goHome">
    <img v-show="settingStore.theme === 'dark'" :src="lightLogoSrc" alt="" />
    <img v-show="settingStore.theme !== 'dark'" :src="darkLogoSrc" alt="" />
  </div>
</template>

<style scoped lang="scss">
img {
  cursor: pointer;
  height: 2rem;
}
</style>
