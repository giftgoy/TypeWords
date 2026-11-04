<script setup lang="ts">
import { BaseIcon, ToastComponent } from '@/base'
import Logo from '@/components/Logo.vue'
import IeDialog from '@/components/dialog/IeDialog.vue'
import useTheme from '@/core/hooks/theme.ts'
import { useRuntimeStore } from '@/core/stores/runtime.ts'
import { useSettingStore } from '@/core/stores/setting.ts'
import { ShortcutKey } from '@/core/types/enum.ts'
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { useInit } from '@/core/composables/useInit.ts'
import { useI18n } from 'vue-i18n'
import { Supabase } from '@/core/utils/supabase.ts'
import MiniProgram from '@/components/MiniProgram.vue'
import WordCollectPopover from '@/components/word/WordCollectPopover.vue'
import LearningGuide from '@/components/LearningGuide.vue'
import { isOfficialDeployment } from '@/core/utils/learning-guide'

const router = useRouter()
const { toggleTheme, getTheme, setTheme } = useTheme()
const runtimeStore = useRuntimeStore()
const settingStore = useSettingStore()
const expand = $computed(() => settingStore.sideExpand)
let officialDeployment = $ref(false)
const init = useInit()

watch(
  () => settingStore.sideExpand,
  n => {
    if (import.meta.client) {
      document.documentElement.style.setProperty('--aside-width', n ? '14rem' : '4.5rem')
    }
  },
  { immediate: true }
)

watch(
  () => settingStore.load,
  n => {
    if (!n) return
    setTheme(settingStore.theme)
  }
)

watch(
  () => settingStore.theme,
  n => {
    setTheme(n)
  }
)

const { locales, setLocale } = useI18n()
const route = useRoute()

const showIcon = $computed(() => {
  return ['/words', '/articles', '/setting', '/help', '/doc', '/feedback'].includes(route.path)
})

onMounted(() => {
  officialDeployment = isOfficialDeployment(window.location.hostname)
  init()
  window.umami?.track('sync', { check: Supabase.check() })
})
</script>

<template>
  <div class="layout anim" :class="{ 'mobile-nav-collapsed': settingStore.mobileNavCollapsed }">
    <!--    第一个aside 占位用-->
    <div class="aside space"></div>
    <nav id="side-navigation" class="aside fixed" :class="!expand && 'hidden-span'" :aria-label="$t('navigation')">
      <div class="top p-4">
        <div class="sidebar-header">
          <Logo v-if="expand" />
          <button
            type="button"
            class="nav-button"
            :title="$t(expand ? 'collapse_navigation' : 'expand_navigation')"
            :aria-label="$t(expand ? 'collapse_navigation' : 'expand_navigation')"
            :aria-expanded="expand"
            aria-controls="side-navigation"
            @click="settingStore.sideExpand = !settingStore.sideExpand"
          >
            <IconFluentChevronLeft20Regular v-if="expand" />
            <IconFluentChevronRight20Regular v-else />
          </button>
        </div>
        <NuxtLink to="/words" class="row" :title="$t('words')" :aria-label="$t('words')">
          <IconFluentTextUnderlineDouble20Regular />
          <span>{{ $t('words') }}</span>
        </NuxtLink>
        <NuxtLink id="article" to="/articles" class="row" :title="$t('articles')" :aria-label="$t('articles')">
          <IconFluentBookLetter20Regular />
          <span>{{ $t('articles') }}</span>
        </NuxtLink>
        <NuxtLink
          to="/dict-list"
          class="row"
          :class="{ 'router-link-active': route.path === '/book-list' }"
          aria-label="资源市场"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          >
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
          <span>资源市场</span>
        </NuxtLink>
        <NuxtLink to="/records" class="row" :title="$t('study_record')" :aria-label="$t('study_record')">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          >
            <path d="M4 20V11M10 20V4M16 20v-6M22 20H2" />
          </svg>
          <span>{{ $t('study_record') }}</span>
        </NuxtLink>
        <NuxtLink to="/doc" class="row" :title="$t('document')" :aria-label="$t('document')">
          <IconFluentDocument20Regular />
          <span>{{ $t('document') }}</span>
        </NuxtLink>
        <NuxtLink to="/help" class="row" :title="$t('help')" :aria-label="$t('help')">
          <IconFluentQuestionCircle20Regular />
          <span>{{ $t('help') }}</span>
        </NuxtLink>
        <!--        <div class="row" @click="router.push('/user')">-->
        <!--          <IconFluentPerson20Regular/>-->
        <!--          <span >用户</span>-->
        <!--        </div>-->
      </div>
      <div class="px-4 pb-2 border-0 border-t-1 border-solid border-[var(--color-line)]">
        <NuxtLink to="/setting" class="row" :title="$t('setting')" :aria-label="$t('setting')">
          <IconFluentSettings20Regular />
          <span>{{ $t('setting') }}</span>
          <div class="red-point" :class="!settingStore.sideExpand && 'top-1 right-0'" v-if="runtimeStore.isError"></div>
        </NuxtLink>
      </div>
    </nav>

    <!-- 移动端顶部菜单栏 -->
    <div class="mobile-top-nav" :class="{ collapsed: settingStore.mobileNavCollapsed }">
      <div id="mobile-navigation" class="nav-items" v-show="!settingStore.mobileNavCollapsed">
        <div class="nav-item" @click="router.push('/')" :class="{ active: route.path === '/' }">
          <IconFluentHome20Regular />
          <span>{{ $t('home_page') }}</span>
        </div>
        <div class="nav-item" @click="router.push('/words')" :class="{ active: route.path?.includes('/words') }">
          <IconFluentTextUnderlineDouble20Regular />
          <span>{{ $t('words') }}</span>
        </div>
        <div class="nav-item" @click="router.push('/articles')" :class="{ active: route.path?.includes('/articles') }">
          <IconFluentBookLetter20Regular />
          <span>{{ $t('articles') }}</span>
        </div>
        <div class="nav-item" @click="router.push('/setting')" :class="{ active: route.path === '/setting' }">
          <IconFluentSettings20Regular />
          <span>{{ $t('setting') }}</span>
          <div class="red-point" v-if="runtimeStore.isError"></div>
        </div>
      </div>
      <button
        type="button"
        class="nav-toggle nav-button"
        :aria-label="$t(settingStore.mobileNavCollapsed ? 'expand_navigation' : 'collapse_navigation')"
        :aria-expanded="!settingStore.mobileNavCollapsed"
        aria-controls="mobile-navigation"
        @click="settingStore.mobileNavCollapsed = !settingStore.mobileNavCollapsed"
      >
        <span>{{ $t(settingStore.mobileNavCollapsed ? 'expand_navigation' : 'collapse_navigation') }}</span>
        <IconFluentChevronDown20Filled v-if="!settingStore.mobileNavCollapsed" />
        <IconFluentChevronUp20Filled v-else />
      </button>
    </div>

    <IeDialog />

    <div class="flex-1 z-1 relative main-content overflow-x-hidden">
      <div
        class="mt-3 center relative z-9999 pointer-events-none"
        @click="router.push('/setting?index=6 ')"
        v-if="runtimeStore.isError"
      >
        <ToastComponent
          type="error"
          :duration="0"
          :shadow="false"
          :showClose="false"
          :message="$t('sync_failed_toast')"
        />
      </div>
      <!--      <slot></slot>-->
      <router-view></router-view>

      <div class="absolute right-4 top-4 flex z-1 gap-2" v-if="showIcon">
        <MiniProgram v-if="officialDeployment && settingStore.load && !settingStore.first" />

        <div class="relative group">
          <BaseIcon>
            <IconPhTranslate />
          </BaseIcon>
          <div
            class="space-y-2 pt-2 absolute z-2 right-0 opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-150 pointer-events-none group-hover:pointer-events-auto"
          >
            <div class="card mb-2 py-4 px-6 space-y-3">
              <div v-for="locale in locales" @click="setLocale(locale.code)" class="w-full cp break-keep black-link">
                {{ locale.name }}
              </div>
            </div>
          </div>
        </div>

        <BaseIcon
          :title="`${$t('toggle_theme')}(${settingStore.shortcutKeyMap[ShortcutKey.ToggleTheme]})`"
          @click="toggleTheme"
        >
          <IconFluentWeatherMoon16Regular v-if="getTheme() === 'light'" />
          <IconFluentWeatherSunny16Regular v-else />
        </BaseIcon>
      </div>
    </div>
    <WordCollectPopover />
    <LearningGuide />
  </div>
</template>

<style scoped lang="scss">
.layout {
  width: 100%;
  min-height: 100dvh;
  display: flex;
  background: var(--color-primary);
}

.aside {
  background: var(--color-second);
  height: 100dvh;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: rgb(0 0 0 / 3%) 0px 0px 12px 0px;
  width: var(--aside-width);
  transition: width 0.2s;
  z-index: 2;
  overflow: hidden;

  &.hidden-span {
    span {
      display: none;
    }
  }
  .row {
    @apply cp rounded-md text p-2 my-2 flex items-center gap-2 relative shrink-0 hover:bg-fourth;
    transition: all 0.5s;
    color: var(--color-main-text);

    &.router-link-active {
      background: var(--color-fourth);
    }

    svg {
      @apply shrink-0 text-lg;
    }
    span {
      @apply shrink-0;
    }
  }
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  gap: 4px;
  :deep(img) {
    max-width: 100%;
    height: auto;
  }
  > :first-child:not(button) {
    min-width: 0;
  }
}
.nav-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-second);
  color: var(--color-main-text);
  cursor: pointer;
  font: inherit;
  &:hover {
    background: var(--color-fourth);
  }
  &:focus-visible {
    outline: 2px solid var(--color-select-bg);
    outline-offset: 2px;
  }
  svg {
    font-size: 20px;
  }
}
.hidden-span .top {
  padding-inline: 14px;
}
.main-content {
  min-width: 0;
}
.mobile-top-nav {
  display: none;
}
@media (max-width: 768px) {
  .layout {
    --mobile-nav-height: 108px;
  }
  .mobile-nav-collapsed {
    --mobile-nav-height: 44px;
  }
  .aside {
    display: none;
  }
  .main-content {
    width: 100%;
    padding-top: calc(var(--mobile-nav-height) + 12px);
  }
  .mobile-top-nav {
    display: block;
    position: fixed;
    inset: 0 0 auto;
    background: var(--color-second);
    border-bottom: 1px solid var(--color-line);
    z-index: 1000;
  }
  .nav-items {
    display: flex;
    justify-content: space-around;
    height: 64px;
  }
  .nav-item {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 44px;
    cursor: pointer;
    position: relative;
    font-size: 12px;
    svg {
      font-size: 20px;
    }
    &.active {
      color: var(--color-select-bg);
    }
  }
  .nav-toggle {
    width: 100%;
    border: 0;
    border-top: 1px solid var(--color-line);
    border-radius: 0;
    gap: 8px;
    font-size: 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .aside {
    transition: none;
  }
}
</style>
