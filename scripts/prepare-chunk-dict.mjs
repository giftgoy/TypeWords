/**
 * 生成「英语词块」词典(方案 A:词块作为独立词条,复用现有练习/复习管线)。
 *
 * 数据来源:SEEDS 人工精选词块(词块 + 中文释义)。每条都经过人工把关,
 * 不做自动聚合(上游词典 phrases 字段含大量专业领域噪音,已验证不适合自动筛选)。
 *
 * 产出:
 * - public/dicts/en/word/market-en-chunks-300.json(词块词条,word 字段是带空格的词块)
 * - public/list/word.json 中按 id upsert 一条目录条目
 *
 * 运行:node scripts/prepare-chunk-dict.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DICT_ID = 'market-en-chunks-300'
const DICT_NAME = '英语词块 · 精编 300'
const DATA_FILE = resolve(root, 'public/dicts/en/word/market-en-chunks-300.json')
const CATALOG_FILE = resolve(root, 'public/list/word.json')
const TARGET = 300

/** 精选词块:[词块, 中文释义]。目标 300 条,增删后运行脚本并核对输出数量。 */
const SEEDS = [
  // —— 动词搭配 ——
  ['take care of', '照顾；处理'],
  ['take part in', '参加；参与'],
  ['take place', '发生；举行'],
  ['take advantage of', '利用'],
  ['take the place of', '取代；代替'],
  ['take into account', '把…考虑在内'],
  ['take notice of', '注意到'],
  ['take on', '承担；呈现'],
  ['take over', '接管；接任'],
  ['take up', '占据；开始从事'],
  ['pay attention to', '注意；重视'],
  ['pay off', '取得成功；得到回报'],
  ['make up', '组成；编造；和解'],
  ['make up for', '弥补'],
  ['make out', '辨认出；理解'],
  ['make sure', '确保；核实'],
  ['make progress', '取得进步'],
  ['make sense', '讲得通；有意义'],
  ['make a difference', '有影响；起作用'],
  ['make use of', '利用'],
  ["make up one's mind", '下定决心'],
  ['come up with', '想出；提出'],
  ['come out', '出版；结果是'],
  ['come across', '偶然遇见'],
  ['come to', '苏醒；共计；涉及'],
  ['catch up with', '赶上；追上'],
  ['catch sight of', '看见；瞥见'],
  ['keep up with', '跟上；保持联系'],
  ['keep in touch', '保持联系'],
  ['keep an eye on', '留意；照看'],
  ['look forward to', '期待；盼望'],
  ['look after', '照顾；照料'],
  ['look into', '调查；研究'],
  ['look out for', '留心；留意'],
  ['look up to', '尊敬；敬仰'],
  ['look down on', '看不起；轻视'],
  ['put off', '推迟；延期'],
  ['put up with', '忍受；容忍'],
  ['put forward', '提出（建议）'],
  ['put out', '扑灭；出版'],
  ['put away', '收好；放好'],
  ['get rid of', '摆脱；除去'],
  ['get along with', '与…相处融洽'],
  ['get used to', '习惯于'],
  ['get across', '讲清楚；让人明白'],
  ['give up', '放弃'],
  ['give in', '让步；屈服'],
  ['give off', '发出（光、气味）'],
  ['give away', '泄露；赠送'],
  ['go through', '经历；仔细检查'],
  ['go over', '复习；仔细查看'],
  ['go ahead', '进行吧；继续'],
  ['turn out', '结果是；证明是'],
  ['turn up', '出现；调大'],
  ['turn down', '拒绝；调低'],
  ['turn into', '变成'],
  ['work out', '解决；算出'],
  ['work on', '从事于；努力改进'],
  ['set up', '建立；设立'],
  ['set off', '出发；引发'],
  ['set out', '出发；着手'],
  ['bring up', '养育；提出'],
  ['bring about', '导致；引起'],
  ['break down', '出故障；分解'],
  ['break out', '爆发；突然发生'],
  ['break up', '分手；解体'],
  ['fall behind', '落后'],
  ['fall in love with', '爱上'],
  ['deal with', '处理；应对'],
  ['cope with', '应对；处理'],
  ['figure out', '弄明白；想出'],
  ['point out', '指出'],
  ['pick up', '捡起；学会；接（人）'],
  ['run out of', '用完；耗尽'],
  ['show up', '出现；露面'],
  ['end up', '最终成为；最后处于'],
  ['carry out', '执行；实施'],
  ['carry on', '继续；进行'],
  ['depend on', '依赖；取决于'],
  ['rely on', '依靠；信赖'],
  ['focus on', '集中于；专注于'],
  ['belong to', '属于'],
  ['consist of', '由…组成'],
  ['result from', '由…造成'],
  ['result in', '导致；造成'],
  ['lead to', '导致；通向'],
  ['contribute to', '促成；有助于'],
  ['account for', '解释；占（比例）'],
  ['benefit from', '从…中受益'],
  ['suffer from', '遭受；患（病）'],
  ['differ from', '与…不同'],
  ['adapt to', '适应'],
  ['apply for', '申请'],
  ['apply to', '适用于'],
  ['approve of', '赞成'],
  ['insist on', '坚持；坚决要求'],
  ['succeed in', '成功做到'],
  ['invest in', '投资于'],
  ['participate in', '参加'],
  ['specialize in', '专攻；专门研究'],
  ['interfere with', '干涉；妨碍'],
  ['compare with', '与…比较'],
  ['call for', '需要；要求'],
  ['call on', '拜访；号召'],
  ['call off', '取消'],
  ['look out', '当心'],
  ['look through', '浏览'],
  ['get to know', '认识；了解'],
  ['get together', '聚会'],
  ['get through', '通过；接通'],
  ['hold on', '等一下；坚持'],
  ['hold up', '举起；耽搁'],
  ['cut off', '切断；中断'],
  ['feel like', '想要；摸起来像'],
  ['find out', '查明；弄清楚'],
  ['think over', '仔细考虑'],
  ['hand in', '上交'],
  ['hand out', '分发'],
  ['hang up', '挂断电话；悬挂'],
  ['cheer up', '振作起来'],
  ['clear up', '放晴；澄清'],
  ['stay up', '熬夜'],
  ['stand for', '代表'],
  ['stand out', '突出；显眼'],
  ['calm down', '冷静下来'],
  ['check in', '登记入住'],
  ['check out', '结账退房；核实'],
  ['try on', '试穿'],
  ['try out', '试验；试用'],
  ['leave out', '遗漏；省去'],
  ['let down', '使失望'],
  ['show off', '炫耀'],
  ['protect from', '保护…免受'],
  ['prevent from', '防止'],
  ['recover from', '从…恢复'],
  ['add up to', '总计'],
  ['refer to', '提到；查阅'],
  ['stick to', '坚持'],
  ['object to', '反对'],
  ['appeal to', '吸引；呼吁'],
  // —— 介词与功能词块 ——
  ['according to', '根据；按照'],
  ['in addition to', '除…之外（还）'],
  ['as a result', '结果；因此'],
  ['as well as', '也；和…一样'],
  ['in terms of', '就…而言'],
  ['on the other hand', '另一方面'],
  ['at the same time', '同时'],
  ['at the moment', '此刻；目前'],
  ['in the long run', '从长远看'],
  ['in the end', '最后；终于'],
  ['in fact', '事实上；实际上'],
  ['in general', '总的来说'],
  ['in particular', '尤其；特别'],
  ['in other words', '换句话说'],
  ['on average', '平均'],
  ['such as', '例如；诸如'],
  ['a variety of', '各种各样的'],
  ['a couple of', '两个；几个'],
  ['a lot of', '大量；许多'],
  ['a number of', '若干；一些'],
  ['the number of', '…的数量'],
  ['plenty of', '大量；充足'],
  ['in favor of', '支持；赞成'],
  ['in front of', '在…前面'],
  ['in spite of', '尽管；不管'],
  ['instead of', '而不是；代替'],
  ['because of', '因为；由于'],
  ['due to', '由于；因为'],
  ['owing to', '由于'],
  ['apart from', '除…之外；远离'],
  ['along with', '连同；一起'],
  ['regardless of', '不顾；不管'],
  ['in case of', '万一；以防'],
  ['by means of', '借助；通过'],
  ['with regard to', '关于'],
  ['with respect to', '关于；就…而言'],
  ['on the basis of', '在…的基础上'],
  ['for the sake of', '为了'],
  ['on behalf of', '代表'],
  ['in charge of', '负责；主管'],
  ['in search of', '寻找'],
  ['in need of', '需要'],
  ['at the cost of', '以…为代价'],
  ['in the face of', '面对'],
  ['thanks to', '多亏；由于'],
  ['in response to', '作为对…的回应'],
  ['with the help of', '在…的帮助下'],
  ['in honor of', '为了纪念'],
  ['on purpose', '故意'],
  ['on time', '准时'],
  ['in time', '及时'],
  ['at once', '立刻；马上'],
  ['right away', '立刻'],
  ['no longer', '不再'],
  ['no matter what', '无论如何'],
  ['even if', '即使；纵然'],
  ['even though', '即使；尽管'],
  ['as if', '好像；仿佛'],
  ['now that', '既然；由于'],
  ['so that', '以便；为了'],
  ['in order to', '为了'],
  ['so as to', '以便；为了'],
  ['used to', '过去常常'],
  ['had better', '最好'],
  ['would rather', '宁愿'],
  ['would like to', '想要'],
  ['as soon as', '一…就…'],
  ['as long as', '只要'],
  ['as far as', '就…而言；直到'],
  ['by the time', '到…时候'],
  ['in case', '以防万一'],
  ['in short', '简而言之'],
  ['in conclusion', '总而言之'],
  ['to sum up', '总而言之'],
  ['above all', '首先；最重要的是'],
  ['after all', '毕竟；终究'],
  ['all in all', '总的来说'],
  ['at first', '起初'],
  ['at least', '至少'],
  ['at most', '至多'],
  ['more or less', '或多或少'],
  ['sooner or later', '迟早'],
  ['once again', '再一次'],
  ['one after another', '一个接一个'],
  ['step by step', '逐步地'],
  ['face to face', '面对面'],
  ['little by little', '一点一点地'],
  ['one by one', '一个接一个地'],
  ['and so on', '等等'],
  // —— 状态句型词块(be + 形容词/介词) ——
  ['be aware of', '意识到；知道'],
  ['be supposed to', '应该；被期望'],
  ['be familiar with', '熟悉'],
  ['be proud of', '为…感到自豪'],
  ['be afraid of', '害怕'],
  ['be full of', '充满'],
  ['be short of', '缺乏'],
  ['be tired of', '厌烦'],
  ['be involved in', '参与；卷入'],
  ['be interested in', '对…感兴趣'],
  ['be related to', '与…有关'],
  ['be concerned about', '关心；挂念'],
  ['be exposed to', '接触到；暴露于'],
  ['be faced with', '面临'],
  ['be made up of', '由…构成'],
  ['be engaged in', '从事于'],
  ['be accustomed to', '习惯于'],
  // —— 高频惯用词块 ——
  ['by accident', '偶然'],
  ['by chance', '碰巧；偶然'],
  ['by mistake', '错误地'],
  ['by far', '最；显然'],
  ['by heart', '凭记忆'],
  ['in advance', '提前'],
  ['in return', '作为回报'],
  ['in turn', '依次；转而'],
  ['in trouble', '处于困境'],
  ['in person', '亲自'],
  ['in public', '公开地'],
  ['out of order', '出故障'],
  ['out of date', '过时的'],
  ['out of control', '失控'],
  ['on sale', '出售；廉价出售'],
  ['on business', '出差'],
  ['on foot', '步行'],
  ['on the way', '在路上'],
  ['on the spot', '当场；在现场'],
  ['on the contrary', '相反'],
  ['at work', '在工作'],
  ['at random', '随机地'],
  ['at a loss', '不知所措'],
  ['at any rate', '无论如何'],
  ['at stake', '处于危险'],
  ['in a hurry', '匆忙'],
  ['in a word', '简言之'],
  ['all at once', '突然'],
  ['from time to time', '不时地'],
  ['for the time being', '目前；暂时'],
  ['under control', '处于控制之下'],
  ['under pressure', '在压力之下'],
  // —— 从聚合数据中人工核实过的可靠搭配 ——
  ['at dusk', '傍晚；黄昏'],
  ['at ease', '安逸；自在'],
  ['at risk', '处于危险中'],
  ['bad guy', '坏人'],
  ['bad mood', '坏心情'],
  ['by force', '强迫；靠武力'],
  ['do harm', '有害处'],
  ['drag on', '拖延'],
  ['curl up', '卷起；蜷缩'],
  ['gaze at', '盯住；凝视'],
  ['envy of', '嫉妒；羡慕'],
  ['in debt', '负债'],
  ['in rags', '衣衫褴褛'],
  ['in vain', '徒然；无效'],
  ['log in', '登录'],
  ['mess up', '搞糟；陷入困境'],
  ['on loan', '借用；借贷'],
  ['on tour', '巡回中'],
  ['pack up', '打包；整理'],
  ['plug in', '插上电源'],
  ['soak up', '吸收'],
  ['vote on', '就…表决'],
]

/** 词块规范化 key:小写、压缩空白、去首尾标点。 */
function normalizeChunkKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/g, '')
    .trim()
}

/** 词块正文是否合法:2–4 个词、只含字母/空格/连字符/撇号,且无 sb/sth 占位符。 */
function isValidChunkText(text) {
  if (!/^[a-z][a-z' -]*[a-z']$/.test(text)) return false
  const wordCount = text.split(' ').length
  if (wordCount < 2 || wordCount > 4) return false
  if (text.length > 36) return false
  if (/\b(sb|sth|somebody|something)\b/.test(text)) return false
  return true
}

/** 中文释义是否可用:需含汉字且长度 >= 2。 */
function isValidChunkCn(cn) {
  if (!cn) return false
  const text = String(cn)
  if (!/[\u4e00-\u9fff]/.test(text)) return false
  return text.replace(/[^\u4e00-\u9fff]/g, '').length >= 2
}

async function main() {
  // 1) 校验并去重种子词块
  const pool = new Map()
  const invalid = []
  for (const [chunk, cn] of SEEDS) {
    const key = normalizeChunkKey(chunk)
    if (!isValidChunkText(key) || !isValidChunkCn(cn)) {
      invalid.push(`${chunk}(${cn})`)
      continue
    }
    pool.set(key, { key, cn })
  }

  const items = [...pool.values()].sort((a, b) => a.key.localeCompare(b.key))

  // 2) 产出词条(形状与市场词条一致)
  const entries = items.map((item, index) => ({
    id: `${DICT_ID}-${index}`,
    word: item.key,
    phonetic0: '',
    phonetic1: '',
    trans: [{ pos: '', cn: item.cn }],
    sentences: [],
    phrases: [],
    synos: [],
    relWords: { root: '', rels: [] },
    etymology: [],
  }))

  await writeFile(DATA_FILE, JSON.stringify(entries, null, 2).replaceAll('\n', '\r\n') + '\r\n', 'utf8')

  // 3) upsert 目录条目(保持 2 空格缩进 + CRLF)
  const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'))
  const catalogEntry = {
    id: DICT_ID,
    enName: DICT_ID,
    name: DICT_NAME,
    description: '高频词块与固定搭配,把短语当作一个整体记忆单元,跟写与听写均支持带空格的词块。',
    category: '词块搭配',
    icon: 'CK',
    accent: 'rose',
    tags: ['词块', '搭配'],
    url: 'market-en-chunks-300.json',
    length: entries.length,
    type: 'word',
    language: 'en',
    translateLanguage: 'zh-CN',
    version: 1,
    source: 'TypeWords 本地精选',
    sourceUrl: 'https://github.com/giftgoy/TypeWords',
  }
  const catalogIndex = catalog.findIndex(def => def.id === DICT_ID)
  if (catalogIndex >= 0) catalog[catalogIndex] = { ...catalog[catalogIndex], ...catalogEntry }
  else catalog.push(catalogEntry)
  await writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2).replaceAll('\n', '\r\n') + '\r\n', 'utf8')

  // 4) 报告
  console.log(`词块词典已生成:public/dicts/en/word/market-en-chunks-300.json`)
  console.log(`目录条目已${catalogIndex >= 0 ? '更新' : '写入'}:public/list/word.json`)
  console.log(`共 ${entries.length} 条(目标 ${TARGET}${entries.length === TARGET ? ' ✔' : ' ✘ 数量不符,请增删种子'})`)
  if (invalid.length) console.log(`非法或被丢弃的种子词块:${invalid.join(' ; ')}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
