<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useBaseStore } from '@/core/stores/base'
import {
  analyzeDictionaryMembership,
  withPersonalDictionaries,
  type DictionaryMembershipIndex,
} from '@/core/immersive/dictionary-membership'
import { loadDictionaryMembership } from '@/core/immersive/membership-loader'

const props = defineProps<{ text: string }>()
const base = useBaseStore()
const index = shallowRef<DictionaryMembershipIndex>()
const open = ref(false)
const loading = ref(false)
const error = ref('')
const query = ref('')
const dictionary = ref('')
const scope = ref('all')
const includeCandidates = ref(true)
const limit = ref(50)
const fullIndex = computed(() => (index.value ? withPersonalDictionaries(index.value, base.word.bookList) : null))
const analysis = computed(() =>
  fullIndex.value ? analyzeDictionaryMembership(props.text, fullIndex.value, includeCandidates.value) : null
)
const names = computed(() => new Map(fullIndex.value?.dictionaries.map(d => [d.id, d.name]) || []))
const filtered = computed(() =>
  (analysis.value?.rows || []).filter(
    row =>
      (!dictionary.value || row.dictionaries.includes(dictionary.value)) &&
      (scope.value === 'all' ||
        (scope.value === 'unmatched'
          ? !row.dictionaries.length
          : scope.value === 'candidate'
            ? row.candidates.some(c => !dictionary.value || c.dictionaries.includes(dictionary.value))
            : row.exactDictionaries.some(id => !dictionary.value || id === dictionary.value))) &&
      (!query.value.trim() ||
        [row.form, ...row.candidates.map(c => c.lemma)].some(word => word.includes(query.value.trim().toLowerCase())))
  )
)
watch([query, dictionary, scope, includeCandidates, () => props.text], () => {
  limit.value = 50
})
async function analyze() {
  open.value = true
  if (loading.value || index.value) return
  loading.value = true
  error.value = ''
  try {
    index.value = await loadDictionaryMembership()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
function selectDictionary(id: string) {
  dictionary.value = dictionary.value === id ? '' : id
  scope.value = 'all'
}
</script>

<template>
  <section class="dictionary-analysis" aria-label="文章词汇所属词典分析">
    <div class="analysis-heading">
      <div>
        <h3>文章词汇 · 所属词典</h3>
        <p>查看正文词形在四级、六级、雅思等词典中的收录情况。</p>
      </div>
      <button
        type="button"
        :disabled="loading"
        :aria-expanded="open"
        @click="open && index ? (open = false) : analyze()"
      >
        {{ loading ? '正在分析…' : open && index ? '收起分析' : '分析词典归属' }}
      </button>
    </div>
    <template v-if="open">
      <p v-if="error" role="alert">{{ error }} <button type="button" @click="analyze">重试</button></p>
      <p v-if="loading" role="status">正在读取本地词典索引…</p>
      <template v-if="analysis">
        <p class="analysis-totals">
          正文 {{ analysis.tokens }} 个英文词次 · {{ analysis.uniqueForms }} 种词形 ·
          {{ analysis.matchedForms }} 种有收录或候选匹配 · {{ analysis.unmatchedForms }} 种未收录
        </p>
        <p class="analysis-note">
          同一个词可属于多个词典，以下数量不能相加。同一词典内原词命中优先，词形候选单独标明，可展开核对。统计不代表语境词义或文章等级，未收录项也可能是人名、地名或新词。
        </p>
        <div class="analysis-dictionaries" aria-label="按所属词典筛选">
          <button type="button" :aria-pressed="!dictionary" @click="dictionary = ''">全部词典</button
          ><button
            v-for="item in analysis.summaries"
            :key="item.id"
            type="button"
            :aria-pressed="dictionary === item.id"
            @click="selectDictionary(item.id)"
          >
            <strong>{{ item.name }}</strong
            ><span>{{ item.forms }} 种 · {{ item.occurrences }} 次</span
            ><span>原词 {{ item.exact }} · 候选 {{ item.candidates }}</span>
          </button>
        </div>
        <div class="analysis-filters">
          <label class="analysis-candidates"><input type="checkbox" v-model="includeCandidates" />包含词形候选</label>
          <label>查找词形或原形<input v-model="query" placeholder="例如 studied / study" /></label
          ><label
            >匹配类型<select v-model="scope">
              <option value="all">全部词形</option>
              <option value="exact">原词命中</option>
              <option value="candidate">词形候选</option>
              <option value="unmatched">未收录</option>
            </select></label
          ><span>当前 {{ filtered.length }} 种词形</span>
        </div>
        <div class="analysis-table">
          <table>
            <thead>
              <tr>
                <th>文中词形</th>
                <th>次数</th>
                <th>匹配依据</th>
                <th>所属词典</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in filtered.slice(0, limit)" :key="row.form">
                <th scope="row">{{ row.form }}</th>
                <td>{{ row.count }}</td>
                <td>
                  <p v-if="row.exact">原词命中</p>
                  <details v-if="row.candidates.length">
                    <summary>词形候选：{{ row.candidates.map(c => c.lemma).join(' / ') }}</summary>
                    <p v-for="c in row.candidates" :key="c.lemma">
                      {{ c.lemma }} → {{ c.dictionaries.map(id => names.get(id)).join('、') }}
                    </p>
                  </details>
                  <span v-if="!row.dictionaries.length">未收录</span>
                </td>
                <td>
                  <span v-for="id in row.dictionaries" :key="id"
                    >{{ names.get(id) }}{{ row.exactDictionaries.includes(id) ? '' : '（候选）' }}； </span
                  ><span v-if="!row.dictionaries.length">当前词库中未找到</span>
                </td>
              </tr>
              <tr v-if="!filtered.length">
                <td colspan="4">当前筛选没有结果，可以切换词典或清空查找条件。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button v-if="filtered.length > limit" type="button" class="analysis-more" @click="limit += 50">
          再显示 50 条（已显示 {{ Math.min(limit, filtered.length) }}/{{ filtered.length }}）
        </button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.dictionary-analysis {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  padding: 20px;
  margin: 20px 0;
  color: var(--color-main-text);
  background: var(--color-card-bg);
}
.analysis-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.analysis-heading h3 {
  font-size: 18px;
  margin: 0 0 8px;
}
.analysis-heading p,
.analysis-note {
  font-size: 12px;
  color: var(--color-sub-text);
  line-height: 1.8;
  margin: 0;
}
.dictionary-analysis button,
.dictionary-analysis select,
.dictionary-analysis input {
  font: inherit;
  font-size: 13px;
  color: inherit;
  border: 1px solid var(--color-line);
  background: var(--color-second);
  border-radius: 6px;
  padding: 9px 12px;
}
.dictionary-analysis button {
  cursor: pointer;
}
.dictionary-analysis button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.dictionary-analysis button[aria-pressed='true'] {
  border-color: #7f9672;
  background: #829b751a;
}
.analysis-totals {
  font-size: 14px;
  line-height: 1.8;
  margin: 20px 0 8px;
}
.analysis-dictionaries {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 8px;
  margin: 18px 0;
}
.analysis-dictionaries button {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.analysis-dictionaries strong {
  font-size: 12px;
  font-weight: 500;
}
.analysis-dictionaries span {
  font-size: 11px;
  color: var(--color-sub-text);
}
.analysis-filters {
  display: flex;
  align-items: end;
  gap: 14px;
  flex-wrap: wrap;
  margin: 18px 0;
  font-size: 12px;
}
.analysis-filters label {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.analysis-filters input {
  width: min(250px, 60vw);
}
.analysis-filters input[type='checkbox'] {
  width: auto;
}
.analysis-filters .analysis-candidates {
  flex-direction: row;
  align-items: center;
}
.analysis-table p {
  margin: 0;
}
.analysis-table {
  overflow: auto;
  max-height: 520px;
}
.analysis-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
  min-width: 580px;
}
.analysis-table td,
.analysis-table th {
  padding: 12px 9px;
  line-height: 1.8;
  border-bottom: 1px solid var(--color-line);
  vertical-align: top;
}
.analysis-table thead {
  position: sticky;
  top: 0;
  background: var(--color-card-bg);
}
.analysis-table tbody th {
  font-weight: 600;
}
.analysis-table td:last-child {
  min-width: 180px;
}
.analysis-table summary {
  cursor: pointer;
}
.analysis-more {
  margin-top: 14px;
}
@media (max-width: 600px) {
  .dictionary-analysis {
    padding: 15px;
  }
  .analysis-heading {
    align-items: start;
    flex-direction: column;
  }
  .analysis-dictionaries {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
