<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useDisableEventListener } from '@/core/hooks/event'
import ConflictNoticeText from './ConflictNoticeText.vue'
import { BaseButton } from '@/base'

const Dialog = defineAsyncComponent(() => import('@/base/dialog/Dialog.vue'))

const emit = defineEmits<{ close: [] }>()
let show = $ref(true)

useDisableEventListener(() => show)
</script>

<template>
  <Dialog v-model="show" :title="$t('important_notice')" padding :showClose="false" :closeOnClickBg="false">
    <div class="w-full max-w-150 center flex-col color-main">
      <ConflictNoticeText />

      <div class="flex justify-end w-full mb-4">
        <BaseButton id="dialog-ok" @click="show = false; emit('close')"
          >{{ $t('close') }}
        </BaseButton>
      </div>
    </div>
  </Dialog>
</template>
