# 本地资源市场

- 词典：`http://localhost:5567/dict-list`
- 文章：`http://localhost:5567/book-list`
- 原有单词页、文章页和学习数据继续使用，添加资源不会切换当前学习项，也不会覆盖已有统计。

## 内容

14 本词典合计 42,515 个词条，词库之间有重叠。原有四级词库保留词条顺序和 ID；新增 13 本来自 [Qwerty Learner](https://github.com/RealKai42/qwerty-learner)，固定到提交 `1182426f2bd0a28c95302c33f9e19136b1262a70`。转换为 TypeWords 的 Word 格式，保留美英音标和中文释义，去除重复单词及无有效释义的条目，未提供的扩展例句等字段保持为空。

来源 URL、原文件 SHA-256、转换后数量和被跳过的无效条目索引见 `public/list/resource-sources.json`。上游 GPL-3.0 许可原文随附于 `public/resource-licenses/qwerty-learner-GPL-3.0.txt`。

新增 24 篇原创双语短文，分为 A1、A2、B1、B2、C1、C2 六本，每本 4 篇，英文与中文逐段对应。A1–C2 为编写时的参考难度，非官方 CEFR 评级；这些短文未附预录音频。原创内容源文件为 `scripts/market-content.mjs`，使用 CC0-1.0；原仓库附带的新概念英语示例不包含在该授权声明中，目录数已按实际内容修正为 5 篇。

## 实现与维护

- `app/components/ResourceMarket.vue` 共用词典与文章市场界面。
- `app/core/utils/resource-market.ts` 处理目录与内容验证、组合筛选、排序、身份匹配及防重复添加。
- 资源成功读取后才加入 Pinia 学习库，并主动保存到原有持久化存储。
- 预览按需加载；“查看词典”包含资源 ID，可在刷新后重建详情，原有详情页的表格会等数据准备好后加载。
- 不执行下载资源中的代码，资源包仅为本地 JSON 数据。

重新生成资源目录和数据文件：

```powershell
pnpm run resources:prepare
# 已经下载过所有源文件时，可使用本机缓存：
node scripts/prepare-market.mjs --offline
```

下载需要访问 GitHub 原始文件；若当前网络必须经过代理，可向 Node 设置 HTTPS_PROXY 并使用 `--use-env-proxy`。不需要修改系统代理设置。

校验与编译：

```powershell
pnpm test
pnpm run build
```

测试覆盖所有真实资源文件的格式和数量、双语段落对齐、六级分布、组合搜索、防重复添加与已有统计的保留，以及坏资源拒绝添加。
