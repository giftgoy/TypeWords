export const GROWTH_STAGES = [
  '我能认出',
  '我能再次想起',
  '我能隔天记住',
  '我能听懂',
  '我能拼出',
  '我能理解用法',
  '我能保持',
]
export const DICT_MILESTONES = [10, 30, 50, 80, 100]

export function formatGrowthGap(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000)
  if (!minutes) return '不到 1 分钟'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  return [days ? `${days} 天` : '', hours ? `${hours} 小时` : '', rest ? `${rest} 分钟` : ''].filter(Boolean).join(' ')
}

export function growthResultText(result: any): string {
  if (result.mode === 'practice') return `练习已记录，本次答对 ${result.count}/5。这是练习与纠正记录，不点亮成功格。`
  if (result.contaminated) return '本次验证期间出现了额外的目标词提示，作答已保留为练习；已有成功证据保持不变。'
  const action =
    result.stage <= 3 ? '认出' : result.stage === 4 ? '听音选对' : result.stage === 5 ? '拼出' : '在新例句里选对'
  if (!result.passed) return `这次独立${action}了 ${result.count} 个，另外 ${5 - result.count} 个可以先练一遍。`
  const interval = [2, 3, 7].includes(result.stage) ? `本次验证开始前已间隔 ${formatGrowthGap(result.gap)}，` : ''
  return `${interval}你独立${action}了 ${result.count} 个词，第 ${result.stage} 次成功已记录。`
}

export function milestoneFeedback(mark: any): string {
  const percent = Math.floor(mark.percent * 10) / 10
  const progress = `本轮已完成 ${percent}%，${mark.count}/${mark.total} 个词。`
  const messages: Record<number, string> = {
    10: '第一段积累已经留下记录。',
    30: '已经走过三成目标，照自己的节奏继续就好。',
    50: '本轮目标已经过半，前半程的学习进度都保存了。',
    80: `还剩 ${mark.total - mark.count} 个目标词，可以慢慢完成最后一段。`,
    100: '本轮目标词已全部完成学习，接下来可以通过复习继续巩固。',
  }
  return progress + (messages[mark.threshold] || '')
}
