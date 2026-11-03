# TypeWords 本地 Docker 部署说明

> 项目来源：<https://github.com/zyronon/TypeWords>（GPL-3.0，当前源码 master=1bcc2a2）
> 本地访问地址：**<http://localhost:5567>**（界面已固定为简体中文）

---

## 1. 最常用命令

在 `D:\dataProject\dsh_projiect\TypeWords` 目录下：

```powershell
# 启动（首次会自动构建镜像，约 1~2 分钟）
docker compose up -d

# 查看状态
docker ps --filter name=typewords

# 停止 / 启动
docker compose stop
docker compose start

# 停止并删除容器
docker compose down

# 改了代码或想强制重建镜像
docker compose up -d --build
```

不想用 compose 也可以直接跑：

```powershell
docker build -t typewords:local .
docker run -d --name typewords --restart unless-stopped -p 5567:80 typewords:local
```

---

## 2. 这套部署做了什么

### 共享学习数据（同一套部署、多个浏览器/设备共用一份进度）

`docker compose up -d --build` 会起三个容器：`typewords`（nginx 静态站）、`typewords-tts`（自然人声）、`typewords-data`（学习数据服务）。

- 浏览器打开站点后，客户端会把 IndexedDB 里的学习数据同步到服务端；换浏览器/换电脑打开同一个地址，会自动载入同一份进度。
- 数据存在 **Docker 命名卷 `typewords_typewords-data`** 里的 `learning.sqlite3`，重建容器、`docker compose down` 都不会丢（只有 `docker compose down -v` 会删卷）。
- 同步是按 key 的增量 + 版本号：别的浏览器改了同一份数据，当前这次写入会返回冲突，**本机改动保留在浏览器里、不会被覆盖**，页面会提示重新载入服务器版本。
- 首次迁移不会丢老数据：浏览器里已有的进度会先被服务端存成一份快照（`/archives`），可在需要时恢复。
- 服务端校验 `Origin` 与 `Host` 必须同源，所以 nginx 反代必须保留原始 Host：`proxy_set_header Host $http_host;`（用 `$host` 会丢端口，写入被 403 拒绝）。

重置共享数据（谨慎，多端进度会一起清空）：

```powershell
docker compose stop data
docker compose rm -f data
docker volume rm typewords_typewords-data
docker compose up -d data
```

或只通过页面「设置 → 数据管理」导出 ZIP 备份后再清理。

### GitHub 云端备份（可选）

本地 SQLite 是唯一真源，GitHub 只做「异地备份 + 新设备冷启动恢复」。

1. 建一个**私有仓库**，生成 **fine-grained PAT**，只勾选该仓库的 `Contents: Read and write`；
2. 在 `deploy/.env`（已被 .gitignore 忽略）写入：

```ini
GITHUB_REPO=你的GitHub用户名/仓库名
GITHUB_TOKEN=github_pat_xxx
GITHUB_BRANCH=main
GITHUB_PATH=typewords/progress.json
GITHUB_SNAPSHOT_DIR=typewords/daily
# 国内网络需要走代理时：GITHUB_API 保持默认，给 data 服务加 HTTPS_PROXY
```

3. 重建数据服务：`docker compose up -d --force-recreate data`
4. 打开「设置 → 数据同步」，看到「云端备份（GitHub）· 已配置」，点「立即备份」验证一次。

行为说明：

- 每次学习数据保存后 **5 秒防抖**自动推送；失败只记录状态，不影响本地保存。
- 只同步 `typing-word-dict` 和 `typing-word-setting`（进度、FSRS、错词、设置），**不含音频**；自建词库正文超过 5 MB 时会被裁掉。
- 每天额外写一份快照到 `GITHUB_SNAPSHOT_DIR/YYYY-MM-DD.json`，同一天只写一次。
- 「从云端恢复」覆盖前会先在本机 `/archives` 存一份快照，可回滚。
- Token 只存在服务端容器环境变量里，浏览器端拿不到。
- 国内直连 `api.github.com` 不稳，可在 compose 的 `data.environment` 加 `HTTPS_PROXY: http://host.docker.internal:7897`。

### 在线自然人声（TTS）

执行 `docker compose up -d --build` 会同时启动 `typewords` 和 `typewords-tts`。
在「设置 → 音效设置 → TTS 音色」中可选择：

- Aria：美音女声；Guy：美音男声。
- Sonia：英音女声；Ryan：英音男声。
- 自动推荐：跟随美音／英音设置，优先选择自然女声。
- 浏览器提供的英文系统音色：保留原有选择。

试听文本可编辑，支持停止试听，沿用例句音量和倍速。
所选音色用于例句以及没有原声录音的文章，单词原声不变。
自然人声通过 [edge-tts](https://github.com/rany2/edge-tts) 调用微软在线语音服务，
需要容器能够访问互联网，合成的文本会发送至该服务，无需配置 API Key。
重复请求的音频可在浏览器缓存一天。

TTS 容器仅在 Compose 内部提供 8000 端口，通过 Nginx `/api/tts/` 同源代理访问。
未启动 TTS 服务的纯静态部署仍可使用浏览器系统音色和原有在线发音回退。
服务异常时会自动尝试系统音色，再尝试原有在线音频；试听失败会显示错误提示。

验证命令：

```powershell
node scripts/test-tts.mjs
# 需已安装 edge-tts 与 aiohttp 的 Python 环境
python -m unittest discover -s deploy/tts -p test_server.py -v
docker compose logs --tail=30 tts
```

| 项目 | 做法 |
| --- | --- |
| 镜像构建 | 多阶段：`node:22-bookworm-slim` 里用 pnpm 10.26 安装依赖并 `pnpm generate` 生成静态站；运行阶段用 `nginx:alpine` 托管，最终镜像仅 **81 MB** |
| 产物 | `.output/public`（Nuxt 预渲染 33 条路由，含 `/words`、`/setting`、`/dict`、`/book/nce1-4` 等） |
| 端口 | 容器内 80 → 宿主机 **5567**（与原 dev 端口一致） |
| 数据 | **全部在浏览器本地**（IndexedDB / localStorage），容器无状态、不需要挂卷 |
| 中文 | `nuxt.config.ts` 增加 `detectBrowserLanguage: false`，`defaultLocale: 'zh'` 生效，任何语言的浏览器都默认中文；侧边栏仍可手动切 14 种语言 |
| Nginx | `deploy/nginx.conf`：静态资源 30 天缓存、gzip、SPA 回退到 `/200.html`，并关闭绝对跳转（避免 301 丢掉 5567 端口） |

新增/修改的文件：

```
Dockerfile            # 新增：构建 + 运行两阶段
docker-compose.yml    # 新增：5567:80，restart unless-stopped
deploy/nginx.conf     # 新增：静态托管 + TTS 同源代理
deploy/tts/          # 新增：自然人声服务及接口测试
scripts/test-tts.mjs # 新增：播放、取消与回退测试
nuxt.config.ts        # 修改：i18n.detectBrowserLanguage = false（固定中文）+ head.meta referrer=no-referrer
```

---

## 2.1 例句发音与回退顺序

默认的自动推荐模式优先使用 Docker 配套的在线自然人声，并跟随美音／英音设置。
也可以手动选择 Aria、Guy、Sonia、Ryan，或浏览器提供的英文系统音色。

1. 选择自然人声时，先通过同源的 `/api/tts/speak` 合成；该服务不可用时尝试系统英文音色。
2. 选择系统音色时，优先使用已保存的选择；系统音色为空或播放失败时，回退到原有在线音频。
3. 原有在线音频先使用百度 TTS，失败再尝试 Google TTS；全部失败时，试听区或练习页给出失败提示。
4. 试听与实际朗读使用相同的播放逻辑，支持取消旧请求，避免快速切换单词或音色后继续播放旧句子。
5. 单词原声仍使用有道词典音频；有原声录音的文章继续使用原声。

纯静态部署不包含自然人声服务，仍可使用系统音色和原有在线音频。
`nuxt.config.ts` 保留 `referrer: no-referrer`，供现有跨站音频源使用。

---

## 3. 已验证

- `http://localhost:5567/` 首页、`/words` 单词页、`/setting` 设置页均为中文且正常渲染（无控制台 JS 报错）。
- `/words`、`/articles`、`/setting`、`/dict`、`/book/nce1` 等路由全部 200；不存在的路径回退到 SPA 壳 `/200.html`。
- 内置词库随镜像发布：`/dicts/en/word/CET4_T.json`（4.4 MB）HTTP 200 正常返回。
- 容器 `restart unless-stopped`，Docker Desktop 启动后自动拉起。
- 无系统语音的浏览器里，页面内实测三个音频源均可加载：百度 TTS 4.07s、Google TTS 3.02s、有道单词语音 1.51s。

---

## 4. 已知限制（都是上游项目本身的，不是部署问题）

1. **资源市场内容与来源**：已合入扩充词库和分级读物。具体资源及授权信息见 `docs/resource-market.md`、`public/list/resource-sources.json` 与 `public/resource-licenses/`。
2. **发音需要外网**：单词发音走 `https://dict.youdao.com/dictvoice`，断网时无声（界面其余功能不受影响）。
3. **账号 / 云同步 / 微信小程序相关功能不可用**：它们指向线上服务（`http://localhost/` 之类的默认 API 地址），本地部署只需单机学习。
4. **service-worker.js 404**：上游仓库里就没有这个文件，浏览器控制台会有一条注册失败日志，不影响使用。
5. **进度存在浏览器里**：换浏览器/清站点数据会丢失学习记录，重要进度请用「设置 → 数据管理」导出备份。

---

## 5. 常见问题

**端口 5567 被占用**：改 `docker-compose.yml` 的 `ports: "5570:80"`，然后 `docker compose up -d`。

**镜像构建时拉不到基础镜像**：Docker Desktop 已配置 `docker.xuanyuan.me` 等镜像源；若某些 tag 返回 403，可用 `nginx:alpine`、`node:22-bookworm-slim` 这类通用 tag（本仓库已使用）。

**构建时依赖下载慢**：`Dockerfile` 里默认 `NPM_REGISTRY=https://registry.npmmirror.com`，可改 `--build-arg` 指定其他源。

**想换回官方源**：`docker build --build-arg NPM_REGISTRY=https://registry.npmjs.org -t typewords:local .`

**升级到上游最新代码**：

```powershell
git pull origin master
docker compose up -d --build
```

> 注意：`nuxt.config.ts` 里的 `detectBrowserLanguage: false` 是本地补丁，`git pull` 若有冲突需要保留这行。
