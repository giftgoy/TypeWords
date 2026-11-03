<script setup lang="ts">
import ConflictNotice2 from '@/components/dialog/ConflictNotice2.vue'
const props = defineProps<{ ready: boolean; dictId: string }>()
let showConflictNotice2 = $ref(false)
function openConflictNotice2() {
  showConflictNotice2 = true
}
defineExpose({ openConflictNotice2 })
</script>
<template><ConflictNotice2 v-model="showConflictNotice2" /></template>
