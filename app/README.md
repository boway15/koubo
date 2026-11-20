# M0 骨架

已落地的不是“架构图”，而是**能跑的全部核心机制**。业务依赖仅 `pg`（Docker / 持久化模式）。

## 快速开始

### 本地（内存仓储，零配置）

```bash
cd app
npm install
npm run dev        # http://localhost:8787，token: dev-token
npm test           # 88+ 个测试（默认不测 Postgres/S3）
```

### Docker（Postgres + S3 持久化，推荐）

```bash
# 项目根目录
docker compose up --build -d
docker compose ps
```

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| API | http://localhost:8787 | Bearer `dev-token`（可用 `LOCAL_TOKEN` 覆盖） |
| S3 | 仅 compose 内网 `http://s3:9000` | 默认 **RustFS**；**不映射宿主机 9000**，避免与本机冲突 |
| Postgres | 仅 compose 内网 | `koubo/koubo@db:5432/koubo` |

自检脚本（容器起来后）：

```bash
cd app
API_URL=http://127.0.0.1:8787 LOCAL_TOKEN=dev-token node scripts/smoke.js
```

连通性：

```bash
# 在容器内测 DB + 对象存储
docker compose exec -T api node scripts/storage-check.js
docker compose exec -T -e DATABASE_URL=postgres://koubo:koubo@db:5432/koubo \
  -e S3_ENDPOINT=http://s3:9000 -e S3_ACCESS_KEY=koubo -e S3_SECRET_KEY=koubo12345678 \
  api node --test test/store.test.js
```

复制 `.env.example` → `.env` 后改密钥即可。**不配任何模型 key 也能跑全链路**，只是 `provenance.degraded = no_api_key`。

## 已实现什么

| 机制 | 状态 | 验证方式 |
| --- | --- | --- |
| 产物 DAG（两条管线） | ✅ | `topoOrder` + 9 步全链路 |
| `input_hash` + 缓存命中 | ✅ | 改配置→失效，同内容→命中 |
| stale 向下传播 | ✅ | 编口播稿→下游变灰 |
| 单步 / 全量重跑 | ✅ | `POST /steps/:id/run`、`POST /run` |
| 质检阻断导出 | ✅ | fail → `QC_BLOCKED` |
| 强制放行留痕 | ✅ | 理由 ≥ 6 字 |
| SSE + 事件重放 | ✅ | `job_events.seq`，重启后可 `since` |
| **Postgres 持久化** | ✅ | `DATABASE_URL` → `PostgresStore` |
| **对象存储（S3 SigV4）** | ✅ | `STORAGE_DRIVER=minio`，产物双写 DB + 对象键 |
| 时间线 spec | ✅ | `validateTimeline` |
| 17+1 项质检 | ✅ | 含知识类保真 |
| DeepSeek 改写 + 降级 | ✅ | `agents/rewrite.js` |
| TTS 字级时间戳门槛 | ✅ | 覆盖率 < 80% 否决（**契约已就位，真 TTS 可先预留**） |
| 多供应商路由 | ✅ | 5 策略 + 健康分 |

## 仓储与存储如何切换

`src/store/index.js`：`DATABASE_URL` 有值 → Postgres，否则 Memory。

`src/storage/index.js`：`STORAGE_DRIVER=minio` 或设置了 `S3_ENDPOINT` → S3（RustFS / MinIO 等）；否则本地 `data/`。

产物键格式统一：`{org_id}/{project_id}/{kind}/v{version}.json`。

## 接真模型：填 key 就切换

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
$env:TTS_API_KEY = "..."     # 或 VOLC_TTS_TOKEN
npm run dev
```

| 环节 | 有 key | 无 key |
| --- | --- | --- |
| 改写 | DeepSeek + 代码校验 | 本地模板 |
| 配音 | HTTP TTS（字级时间戳） | 字数估算 `estimated` |
| 第 14 项质检 | `pass`（真实时间戳） | `warn` |
| 导出 | `engine: deepseek` | `degraded: no_api_key` |

## API

```
POST   /api/projects
GET    /api/projects
GET    /api/projects/:id                  含 DAG 快照
POST   /api/projects/:id/steps/:step/run
POST   /api/projects/:id/run
PATCH  /api/projects/:id/artifacts/:kind  人工编辑 → stale
GET    /api/projects/:id/artifacts        列表（无正文）
GET    /api/projects/:id/artifacts/:kind  单件含 content（对象存储回落）
POST   /api/projects/:id/qc/override
GET    /api/projects/:id/events           SSE（可用 ?token=）
GET    /api/projects/:id/cost
GET    /api/pipelines
GET    /api/providers
POST   /api/providers/:id/enabled
GET    /health                            db + storage 状态，不鉴权
```

## 测试

```bash
npm test
```

| 文件 | 作用 |
| --- | --- |
| `test/store.test.js` | Memory / Postgres 仓储契约；fs / s3 存储 |
| `test/api.test.js` | HTTP 全链路 |
| `test/integration.test.js` | 假 fetch 真适配器 |

Postgres / S3 用例需环境变量，见上文 `docker compose exec` 示例。

## 刻意没做的

- 视频/图片真生成（注册表已有，队列未接）
- ASR 真调用（`extract` 仍按句切分）
- BullMQ（`jobs.runner` 已建表）
- FFmpeg 真实出片

## 下一步

| 优先级 | 事 |
| --- | --- |
| 1 | BullMQ + `runner` 分流（B-roll / 渲染异步） |
| 2 | FFmpeg 消费 `timeline.json` |
| 3 | 接 ASR（whisper / 云 ASR） |
| 4 | 多模态质检 12/13 |
| 5 | 真 TTS 厂商适配（契约已定，按 docs/07 三步接） |
