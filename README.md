# 项目总览

把「抖音链接 / 文案 / 视频 / 主题」变成「可发布成片 + 封面 + 文案 + 交付链接」的固定八步流水线。

**定位：工作室生产工具，后期可 SaaS 化。不做矩阵批量，不做自动代发。**

## 文档

| 文件 | 内容 |
| --- | --- |
| `docs/01-系统分析与技术方案.md` | 需求还原、架构、数据模型、质检工程化、风险 |
| `docs/02-V1范围与国内模型选型.md` | V1 冻结范围、国内模型选型、SaaS 预留、**客户交付端** |
| `docs/03-模型接入方案.md` | 即梦 / 可灵 / DeepSeek 的接入契约、镜头策略、成本熔断、降级链 |
| `docs/04-多供应商路由与视觉质检.md` | 多供应商路由、多样性、海螺 h3、kie 中转、**视觉质检 12–14 项** |
| `docs/05-PC客户端与技术演进.md` | **PC 客户端演进的五个硬约束**、Tauri/Electron 选型、分发坑 |
| `docs/06-业务适配分析.md` | **知识主播适配度与 4 处改造、采访为何需要第二条管线、5 个必留字段** |
| `docs/07-供应商层与真模型接入.md` | **分层、注册表、5 策略路由、8 类错误码、字级时间戳否决、降级矩阵** |

## 原型（纯静态，双击 html 即可）

| 文件 | 是什么 |
| --- | --- |
| `prototype/index.html` | 工作室工作台：项目列表 / 八步流水线 / 质检 17 项 / 客户交付 |
| `prototype/deliver.html` | 客户审阅页：逐句留言、通过 / 需修改 |
| `prototype/providers.html` | 供应商面板：模型能力 / 单价 / 健康分 / 凭证状态（需先启动 `app/`） |

## M0 骨架（已跑通 + Docker 持久化）

```bash
# 本地内存模式
cd app && npm install && npm run dev   # :8787，token: dev-token
npm test                               # 88+ 测试

# 单机 Docker（Postgres + RustFS S3）
docker compose up --build -d
curl http://localhost:8787/health       # 应含 db + storage
```

- 产物 DAG + `input_hash` + stale；**重启后项目 / 事件仍在**
- 真模型改写（DeepSeek）+ 降级留痕；**TTS 契约已就位，可先预留**
- 多供应商路由 + 8 类错误码；17 项质检 + 9 件导出

详见 `app/README.md`。

## Spikes（模型能力验证，零依赖）

```bash
cd spikes
node route-dryrun.mjs        # 不花钱：路由 + 多样性 + 降级链
node deepseek-dryrun.mjs     # 不花钱：改写阈值能否拦住
cp .env.example .env         # 填 key，npm run check 看分组
npm run ds                   # DeepSeek 改写
npm run jimeng -- 产品图.jpg              # 即梦
npm run kling  -- 同一张图.jpg std        # 可灵（同首帧对比）
npm run hailuo -- 同一张图.jpg            # 海螺 h3（同首帧对比）
npm run relay  -- https://公网图.jpg veo3 # 中转
npm run vision -- ./out/x.mp4 ./cover.jpg # 视觉质检
```

详见 `spikes/README.md`。

## 五条必须记住的结论

1. **视频模型不做口播主体**。即梦 / 可灵 / 海螺只出 5–10s 无声片段，口型对不上。口播主体永远是「配音+字幕+图片」，AI 只补 3 个 B-roll。
2. **校验在代码里，不在提示词里**。字数、单承诺、4-gram 重合都是可计算的硬阈值。
3. **加一家供应商 = 插入一行数据**。供应商表 + 能力 JSON，路由策略可切，不写进代码。
4. **中转只做扩展，不做主通道**。主链路必须至少有 1 条直连可用。
5. **PC 客户端是“执行器”不是“再做个 UI”**。现在只需把渲染时间线做成 JSON、任务加 `runner` 列、存储走接口——这三件事晚做要重写。

## 下一步

```
M0 骨架 → 真模型适配 → Postgres/S3（已完成）→ M1 队列与渲染 → M2 交付端深化
```

当前建议顺序：

1. **BullMQ** — B-roll / 渲染异步化，`jobs.runner` 已建表。
2. **FFmpeg 渲染** — 消费 `timeline.json` 出真实 mp4。
3. **真 TTS / ASR** — 契约已有；TTS 无 key 时可继续用估算路径做联调。
