# Spikes · 模型接入最小验证

零依赖（纯 Node 18+，视觉质检额外需要 ffmpeg）。**先跑不花钱的，再花真钱。**

## 一、不花钱就能跑（先做这两个）

```bash
cd spikes
node route-dryrun.mjs        # 路由层：多供应商 + 多样性 + 降级链
node deepseek-dryrun.mjs     # 改写阈值：字数 / 单承诺 / 4-gram
```

### `route-dryrun.mjs` 验证什么

| 策略 | 输出 |
| --- | --- |
| `diverse` | 3 个镜头分给 3 家不同厂商（避免「一眼 AI 同款质感」） |
| `cheapest` | 全用本地 FFmpeg，¥0 |
| `quality` | 全用最高质量档 |
| `diverse` + 允许中转 | 混入 kie 中转 |

还会验证：**能力过滤**（海螺不支持固定 seed 就被过滤掉，不硬传参数）、**健康分淘汰**（某家成功率跌到 0.4 自动跌出候选）、**8 类错误归一化**对应的降级动作。

### `deepseek-dryrun.mjs` 验证什么

三条假输出：合格 / 两个承诺+绝对化用语 / 近义搬运。应当看到「通过 / 拦住 / 拦住（4-gram 82%）」。

> 意义：证明阈值是**代码在判**，不是靠模型自觉。

## 二、配环境

```bash
cp .env.example .env
npm run check
```

脚本按**分组**检查，任一厂商配齐就能开工，不要求全有：

| 分组 | 变量 | 是否必需 |
| --- | --- | --- |
| 文本 | `DEEPSEEK_API_KEY` | ✅ 必需 |
| 视觉质检 | `VISION_API_KEY`（可复用 `ARK_API_KEY`） | ✅ 必需 |
| 即梦 | `ARK_API_KEY` + `ARK_VIDEO_MODEL` | 至少一家视频直连 |
| 可灵 | `KLING_ACCESS_KEY` + `KLING_SECRET_KEY` | 同上 |
| 海螺 h3 | `HAILUO_API_KEY` + `HAILUO_GROUP_ID` | 同上 |
| 中转 kie | `RELAY_API_KEY` | 可选（仅扩展） |

## 三、花钱的验证

```bash
npm run ds                                  # DeepSeek 改写 × 2
npm run jimeng -- ./产品图.jpg               # 即梦图生视频
npm run kling  -- ./同一张图.jpg std         # 可灵（同首帧对比）
npm run hailuo -- ./同一张图.jpg             # 海螺 h3（同首帧对比）
npm run relay  -- https://公网图.jpg veo3    # 中转
npm run vision -- ./out/jimeng.mp4 ./cover.jpg   # 视觉质检
```

### 关键：三家用同一张首帧

否则对比没有意义。要看的是：

| 维度 | 为什么重要 |
| --- | --- |
| 产品一致性 | 杯体是否还认得出来——这是一致性的分水岭 |
| 运动自然度 | 是真实物理还是匀速平移的「假动」 |
| 运动幅度 | 海螺应该更「敢动」，但要防过度变形 |
| 是否带原生音频 | 带了能省一层音效匹配 |

## 四、结论填回

| 填到哪 | 决定什么 |
| --- | --- |
| `docs/03` 第 12 节 | B-roll 主力给谁、视觉质检上不上 |
| `docs/04` 第 10 节 | 多样性默认策略（分厂商 or 同镜多版） |

## 注意

- 接口路径、模型名、参数名都是**最常用形态**，不保证与你账号下的版本一致。跑不通先看返回体，多半是模型 ID 或参数名不同。
- 产物 URL 都是临时的，脚本会立刻下载到 `spikes/out/`。这是必须养成的习惯——不下载等于丢数据。
- `.env` 不要提交。
