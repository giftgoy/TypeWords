<script setup lang="ts">
import ResourceMarket from '@/components/ResourceMarket.vue'

useSeoMeta({
  title: '分级文章市场 · TypeWords',
  description: '按 A1–C2 参考级别浏览双语文章，预览内容后添加到学习库。',
})
</script>

<template>
  <ResourceMarket kind="article" />
</template>
