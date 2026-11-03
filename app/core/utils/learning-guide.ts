export const GUIDE_STORAGE_KEY = 'typewords-learning-guide-v2'
export const GUIDE_STEPS = [
  {
    title: '选择学习内容',
    target: '#choose-dictionary',
    text: '从词典市场挑选一本词典。添加到学习库后，词条和进度会保存在当前浏览器。',
    action: '去词典市场',
  },
  {
    title: '预览词典',
    target: '#word-market-list',
    text: '这里可以搜索、预览和添加词典。下一步会打开一本词典的详情，不会改动你的学习进度。',
    action: '查看词典详情',
  },
  {
    title: '开始学习',
    target: '#study',
    text: '点击“学习”可以设置每天的新词数量和学习起点。设置保存前不会开始新的任务。',
    action: '打开学习设置',
  },
  {
    title: '设置自己的节奏',
    target: '#mode',
    text: '起点从第 1 个词算起。复习数量是上限，只安排已学且到期的词。调整后点击“保存并开始”进入练习。',
    action: '明白了，去保存设置',
  },
  {
    title: '用键盘练习',
    target: '#word-wrap',
    text: '直接按键盘输入单词，完成后按空格继续。听不到发音时可重试或免费查看单词；右下角可展开单词面板。',
    action: '完成引导',
  },
] as const

export type LearningGuideState = {
  status: 'idle' | 'active' | 'paused' | 'completed'
  step: number
  dictId: string
  waiting: boolean
}
export function createLearningGuideState(): LearningGuideState {
  return { status: 'idle', step: 0, dictId: '', waiting: false }
}
export function readLearningGuideState(raw: string | null): LearningGuideState {
  try {
    const value = JSON.parse(raw || 'null')
    if (!value || !['idle', 'active', 'paused', 'completed'].includes(value.status)) return createLearningGuideState()
    return {
      status: value.status === 'active' ? 'paused' : value.status,
      step: Math.max(0, Math.min(GUIDE_STEPS.length - 1, Math.trunc(Number(value.step) || 0))),
      dictId: typeof value.dictId === 'string' ? value.dictId : '',
      waiting: false,
    }
  } catch {
    return createLearningGuideState()
  }
}
export function isOfficialDeployment(hostname: string): boolean {
  return ['typewords.cc', 'www.typewords.cc'].includes(hostname.toLowerCase())
}
export function toDisplayWordIndex(index: number): number {
  return Math.max(1, Math.trunc(Number(index) || 0) + 1)
}
export function toStoredWordIndex(ordinal: number, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), Math.trunc(Number(ordinal) || 1) - 1))
}
export function countPracticeWords(task: { new?: unknown[]; review?: unknown[] }, reviewOnly = false): number {
  return (reviewOnly ? 0 : task.new?.length || 0) + (task.review?.length || 0)
}
export function getReviewWordLimit(daily: number, ratio: number): number {
  if (!Number.isFinite(daily) || !Number.isFinite(ratio)) return 0
  return Math.max(0, Math.floor(daily * Math.max(0, ratio)))
}
