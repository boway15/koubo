/* ================= workspace: panels 4–8, shell, actions ================= */

PANELS.route = () => {
  const routes = [
    { id: "voice", nm: "配音 + 字幕", ico: "mic", cost: "¥0.09", ds: "抽好的语音铺在图片/补充镜头上，成本最低", tag: "默认" },
    { id: "avatar", nm: "数字人出镜", ico: "user", cost: "≈ ¥3.20", ds: "无需真人拍摄，口型和排队时长是主要变量", tag: "增强" },
    { id: "image", nm: "上传图片驱动", ico: "image", cost: "¥0.00", ds: "用已有产品图做推拉运镜，再叠配音和字幕", tag: "已备素材" }
  ];
  return `
  ${stepHead("route", "三条路线可切换，选定后再生素材，避免无效生成",
    `<button class="btn sm primary" data-act="goto" data-hash="#/p/p1/produce">${ic("chev", 13)} 进入合成</button>`)}
  <div class="route-grid">
    ${routes.map(r => `<button class="rout ${S.outRoute === r.id ? "on" : ""}" data-act="route" data-route="${r.id}">
      <span class="top">${ic(r.ico, 15)} ${r.nm} <span class="chip ${S.outRoute === r.id ? "accent" : "ghost"}">${r.tag}</span></span>
      <span class="ds">${r.ds}</span>
      <span class="cost">预估 <b>${r.cost}</b> / 条</span>
    </button>`).join("")}
  </div>
  ${S.outRoute === "avatar" ? `<div class="note" style="margin-top:12px;border-color:#EBD9B4;background:#FDF6E8">
      ${ic("alert", 14)}<div><b>成本前置提示：</b>数字人按条计费，30 秒约 ¥3.20，排队 5–30 分钟。生成失败可退，但重试会再计费。</div>
    </div>` : ""}
  <div class="card" style="margin-top:14px">
    <div class="card-h"><h3>路线与素材匹配</h3><span class="grow"></span>${chip("6 张产品图 + 1 段补充镜头", "ok")}</div>
    <div class="card-b taglist" style="gap:8px">
      ${["A 主图", "B 冲水特写", "C 容量标注", "D USB 口", "E 包内场景", "F 出汁", "补充 01"].map(t => `<span>${t}</span>`).join("")}
    </div>
  </div>`;
};

PANELS.produce = () => {
  const bars = Array.from({ length: 72 }, (_, i) =>
    `<i class="${i > 6 && i < 13 ? "hit" : ""}" style="height:${18 + Math.abs(Math.sin(i * 1.7)) * 70}%"></i>`
  ).join("");
  const tts = window.currentModel ? window.currentModel("tts") : null;
  const vid = window.currentModel ? window.currentModel("video") : null;
  const ttsName = tts && tts.model ? tts.model.name : "火山女声";
  const ttsWord = !!(tts && tts.model && tts.model.id === "volc-tts" && tts.model.ready);
  const vidName = vid && vid.model ? vid.model.name : "三家轮转";
  const vidMeta = vid && vid.model ? vid.model.provider : "即梦 / 可灵";
  return `
  ${stepHead("produce", "按路线合成声音与画面，同时准备分镜补镜",
    `<button class="btn sm" data-act="toast" data-msg="正在试听第 1 句…">${ic("play", 12)} 试听</button>
     <button class="btn sm" data-act="toast" data-msg="已重合成第 3 句（0.8 秒）">${ic("refresh", 13)} 重合成单句</button>`)}
  <div class="card">
    <div class="card-h"><h3>配音音轨</h3><span class="sub">${ttsName} · 女声晓晨 · 1.0x</span><span class="grow"></span>${ttsWord ? chip("字级时间戳 118 / 118", "ok") : chip("无字级时间戳 · 将估算", "warn")}</div>
    <div class="card-b">
      <div class="player">
        <button class="play" data-act="toast" data-msg="播放中…">${ic("play", 15)}</button>
        <div style="flex:1;min-width:0">
          <div class="wave">${bars}</div>
          <div class="tiny muted mono" style="display:flex;justify-content:space-between"><span>0:00</span><span>0:29.4</span></div>
        </div>
      </div>
      <div class="kpis" style="margin:14px 0 0">
        <div class="kpi"><div class="l">实测时长</div><div class="v">29.4<small>s</small></div></div>
        <div class="kpi"><div class="l">语速</div><div class="v">4.0<small> 字/秒</small></div></div>
        <div class="kpi"><div class="l">字幕条数</div><div class="v">24</div></div>
        <div class="kpi"><div class="l">偏差</div><div class="v" style="color:var(--ok)">-0.6<small>s</small></div></div>
      </div>
      <div class="note" style="margin-top:12px">${ic("info", 14)}<div>${ttsWord
        ? "字幕时间轴直接取 TTS 返回的<b>字级时间戳</b>，不用 ASR 反推，因此不会错字也不会漂移。"
        : "当前配音模型没有字级时间戳，时间轴按字数估算，第 14 项质检会标成警告。"}</div></div>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>AI 补充镜头</h3><span class="sub">本单默认 ${vidName} · ${vidMeta}</span>
      <span class="grow"></span>${chip("已用 ¥2.40 / 预算 ¥6.00", "warn")}</div>
    <div class="card-b" style="padding:4px 16px 14px">
      <div class="note" style="margin:8px 0 12px">
        ${ic("alert", 14)}<div><b>口径先说清：</b>视频模型只能生成 5s / 10s 无声片段，<b>口型对不上</b>。所以口播主体仍是「配音 + 字幕 + 图片」，AI 只补 1–3 个空镜或细节镜头。</div>
      </div>
      ${BROLL.map(b => `<div style="display:flex;gap:8px;align-items:center;padding:10px 0;border-top:1px solid #F4F0E7;flex-wrap:wrap">
        <span class="mono muted" style="width:34px;flex:none">${b.shot}</span>
        <span style="flex:1 1 190px;min-width:0">
          <span style="display:block;font-size:12.5px;line-height:1.55">${b.desc}</span>
          <span class="tiny muted">首帧 ${b.frame} · 9:16 · ${b.dur}s · seed ${b.seed}</span>
        </span>
        <span style="display:flex;gap:4px;flex:none">
          ${BROLL_PROVIDERS.map(p => {
            const on = b.provider === p;
            const ready = window.brollModelReady ? window.brollModelReady(p) : p !== "kie中转";
            const cls = on ? (ready ? "accent" : "warn") : "ghost";
            return `<button class="chip ${cls}" data-act="broll-provider" data-shot="${b.shot}" data-p="${p}" style="cursor:pointer">${p}${ready ? "" : " · 未配"}</button>`;
          }).join("")}
        </span>
        <span class="mono tiny" style="width:46px;text-align:right;flex:none">≈ ¥${b.cost}</span>
        <button class="btn sm" style="flex:none" data-act="toast" data-msg="已提交生成，task_id 已入库，预计 40–120 秒">生成</button>
      </div>`).join("")}
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <span class="tiny muted" style="flex:1">3 镜分给 3 家可避免「一眼 AI 同款质感」；任何一家失败自动换下一家，最后退到静态图。</span>
        <button class="btn sm" data-act="toast" data-msg="已全部降级为静态图 + 推拉，成本归零">${ic("image", 13)} 全部降级为静态图</button>
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);display:flex;gap:8px;align-items:center">
        <span class="tiny" style="flex:1;color:var(--ink2)"><b>备选多样性：</b>同一镜让 3 家各出一版，并排挑选（成本 ×3，成交率更高）</span>
        <button class="btn sm ghost" data-act="toast" data-msg="已为 3 个镜头各排队 3 版，共 9 个任务，预计 ¥10.50">${ic("spark", 13)} 每镜出 3 版</button>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>分镜与素材</h3><span class="sub">6 镜 · 无缺口</span><span class="grow"></span>${chip("18.6MB 素材", "ghost")}</div>
    <table class="tbl">
      <thead><tr><th style="width:44px">镜号</th><th style="width:88px">时间</th><th style="width:72px">类型</th><th>画面</th><th style="width:92px">来源</th><th style="width:56px"></th></tr></thead>
      <tbody>
        ${P.shots.map(s => `<tr>
          <td class="mono">${s.n}</td>
          <td class="mono">${s.t}</td>
          <td>${s.type}</td>
          <td>${s.desc}</td>
          <td class="muted">${s.src}</td>
          <td>${s.st === "warn" ? chip("待补", "warn") : chip("已就位", "ok")}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
};

PANELS.render = () => `
  ${stepHead("render", "模板拼接 + 封面；第一版不追求人工精剪",
    `<button class="btn sm" data-act="toast" data-msg="已排队重渲染，预计 68 秒">${ic("refresh", 13)} 重渲染</button>
     <button class="btn sm" data-act="goto" data-hash="#/p/p1/copy">${ic("chev", 13)} 发布配套</button>`)}
  <div class="card">
    <div class="card-h"><h3>成片预览</h3><span class="sub">1080×1920 · 30fps · 29.4s</span><span class="grow"></span>${chip("v2", "ghost")}</div>
    <div class="card-b">
      <div class="render-grid">
        <div class="phone">
          <div class="safe"></div>
          <div class="cap"><span>早上切两块西瓜丢进去</span><br><span>按一下，十秒就好</span></div>
          <div class="ui"><i></i><i></i><i></i></div>
          <button class="pbtn" data-act="toast" data-msg="播放成片（原型占位）">${ic("play", 16)}</button>
        </div>
        <div>
          <div class="meta-list">
            <div class="m"><span class="k">模板</span><span class="v"><b>${P.template}</b></span></div>
            <div class="m"><span class="k">字幕样式</span><span class="v">思源黑体 Bold 64px · 白字 + 20% 黑边 · 底部安全区 320px</span></div>
            <div class="m"><span class="k">BGM</span><span class="v">轻快 Lo-fi 01 · 人声时自动 -12dB · 响度 -14 LUFS</span></div>
            <div class="m"><span class="k">AI 标识</span><span class="v">右上角「AI 生成」角标 + 文件元数据标识 ${chip("已注入", "ok")}</span></div>
            <div class="m"><span class="k">耗时</span><span class="v">68s（4 核 CPU）· 成本 ¥0.11</span></div>
            <div class="m"><span class="k">执行位置</span><span class="v">当前 <b>服务端</b>；桌面端上线后同一份 spec 可本地渲染，成本 ¥0 ${chip("runner=desktop", "ghost")}</span></div>
          </div>
          <div class="divider"></div>
          <div class="tiny muted">渲染参数已快照进 <span class="mono">renders.params_json</span>，同参数可复现同一版本。</div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn sm" data-act="toggle-timeline">${ic("file", 13)} ${S.showTimeline ? "收起" : "查看"}时间线 JSON</button>
            <button class="btn sm ghost" data-act="toast" data-msg="已复制 timeline.json（桌面端可用同一份渲染）">${ic("copy", 13)} 复制 spec</button>
          </div>
          ${S.showTimeline ? `<pre class="mono" style="margin:10px 0 0;padding:11px 12px;background:#FAF8F2;border:1px solid var(--line);border-radius:9px;font-size:10.5px;line-height:1.6;overflow:auto;color:var(--ink2)">${TIMELINE}</pre>` : ""}
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>封面</h3><span class="sub">3:4 · 1080×1440</span><span class="grow"></span>
      ${S.coverFix ? chip("主标题 6 字 · 合格", "ok") : chip("主标题 11 字 · 过长", "bad")}</div>
    <div class="card-b">
      <div style="display:grid;grid-template-columns:150px 1fr;gap:16px;align-items:start">
        <div class="cover-mock">
          <div class="brand">口播研究院</div>
          <div class="blob"></div>
          <div class="hl">${S.coverFix ? "榨汁杯免手洗" : "榨汁杯买回来别再手洗了"}</div>
          <div class="sub">${S.coverFix ? "冲一下就行" : "3 个细节看完再买"}</div>
        </div>
        <div>
          <div class="meta-list">
            <div class="m"><span class="k">主标题</span><span class="v"><b>${S.coverFix ? "榨汁杯免手洗（6 字）" : "榨汁杯买回来别再手洗了（11 字）"}</b></span></div>
            <div class="m"><span class="k">缩略图检查</span><span class="v">${S.coverFix ? "手机 120px 宽下仍可读" : "120px 宽时第 8 字开始糊，建议 ≤ 8 字"}</span></div>
            <div class="m"><span class="k">对比度</span><span class="v">4.9:1 · 达标</span></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn sm" data-act="cover-fix">${ic("spark", 13)} 自动缩短主标题</button>
            <button class="btn sm ghost" data-act="toast" data-msg="已生成 3 个封面备选">换一批</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;

PANELS.copy = () => {
  const tab = S.platform || "抖音";
  const data = {
    "抖音": {
      title: "榨汁杯洗完就想扔？这杯子冲一下就行",
      body: "300ml 塞包里不漏，USB 充一次用一周。\n早上两块西瓜，十秒出汁，杯子冲一下就好。",
      tags: ["#榨汁杯", "#便携榨汁", "#宿舍好物", "#懒人神器"],
      first: "链接在左下角，想要同款的自己点～"
    },
    "小红书": {
      title: "用了两周，终于不用手洗榨汁杯了",
      body: "之前那个榨汁杯，洗一次要拆三个零件，用两次就闲置。\n这个 300ml，冲一下就行，USB 充电能用一周。\n早上切两块西瓜丢进去，十秒出汁。\n不插电、不漏水、塞包里就走。",
      tags: ["#榨汁杯", "#便携榨汁杯", "#宿舍好物", "#懒人好物", "#厨房小家电"],
      first: "同款我放评论区了"
    },
    "YouTube Shorts": {
      title: "No-Wash Portable Blender: 10-Second Juice",
      body: "300ml, USB-C, one charge per week. Rinse and go.\nFull review in the pinned comment.",
      tags: ["#shorts", "#blender", "#gadgets"],
      first: "Link in the pinned comment."
    }
  }[tab];

  return `
  ${stepHead("copy", "按平台写标题、正文、话题和首评；只生成文本，不调发布接口",
    `<span class="chip ghost">平台：${P.platform}</span>`)}
  <div class="card">
    <div class="card-h"><h3>发布文案</h3>
      <span class="grow"></span>
      <div class="pill-tabs">
        ${["抖音", "小红书", "YouTube Shorts"].map(t => `<button class="${tab === t ? "on" : ""}" data-act="platform" data-p="${t}">${t}</button>`).join("")}
      </div>
    </div>
    <div class="card-b">
      <div class="copy-field">
        <label style="justify-content:space-between">标题 ${tab === "抖音" && !S.titleFix ? chip("24 字 · 偏长", "warn") : chip("合适", "ok")}
          ${tab === "抖音" && !S.titleFix ? `<button class="btn sm ghost" style="height:20px;padding:0 6px;font-size:11px" data-act="title-fix">改短</button>` : ""}
        </label>
        <div class="copy-box">${tab === "抖音" ? (S.titleFix ? "榨汁杯冲一下就行" : data.title) : data.title}</div>
      </div>
      <div class="copy-field">
        <label>简介 / 正文</label>
        <div class="copy-box" style="white-space:pre-line">${data.body}</div>
      </div>
      <div class="copy-field">
        <label>话题标签 · ${data.tags.length} 个</label>
        <div class="taglist">${data.tags.map(t => `<span>${t}</span>`).join("")}</div>
      </div>
      <div class="copy-field" style="margin-bottom:0">
        <label>首评引导</label>
        <div class="copy-box">${data.first}</div>
      </div>
      <div class="note" style="margin-top:14px">${ic("info", 14)}<div>${tab === "小红书" ? "小红书正文可长，但封面和标题决定点击率；话题 5–8 个。" : tab === "YouTube Shorts" ? "标题服务搜索，行动号召放简介和置顶评论。" : "抖音标题越短越好，钩子必须在视频前三秒，而不是标题里。"} 系统只产出文本与发布说明，<b>不会代替账号发布</b>。</div></div>
    </div>
  </div>`;
};

PANELS.qc = () => {
  const fails = failCount();
  const rows = P.qc.map(q => {
    const st = S.qc[q.id];
    const stChip = st === "ok" ? chip("通过", "ok") : st === "warn" ? chip("警告", "warn") : chip("未通过", "bad");
    const vision = q.vision
      ? `<div style="display:flex;gap:5px;margin-top:8px;align-items:center;flex-wrap:wrap">
          ${VISION_FRAMES.map(f => `<span title="${f.t} ${f.label}" style="display:inline-flex;flex-direction:column;align-items:center;gap:3px">
            <span style="width:34px;height:60px;border-radius:4px;border:1px solid ${f.ok ? "var(--line2)" : "var(--bad)"};background:${f.ok ? "linear-gradient(160deg,#E2E8E1,#C7D2C8)" : "linear-gradient(160deg,#F3D9D1,#E5B9AC)"};position:relative">
              ${f.ok ? "" : `<span style="position:absolute;inset:0;display:grid;place-items:center;color:#8E2A1C">${ic("x", 13, 2.4)}</span>`}
            </span>
            <span class="mono" style="font-size:9px;color:${f.ok ? "var(--mut)" : "var(--bad)"}">${f.t}</span>
          </span>`).join("")}
          <span class="tiny" style="color:var(--mut);margin-left:2px">5 帧抽检 · 多模态</span>
        </div>`
      : "";
    return `<div class="qc-row ${st === "fail" ? "failb" : ""}">
      <span class="idx mono">${String(q.id).padStart(2, "0")}</span>
      <span class="st">${stChip}</span>
      <span class="mid"><b>${q.t}</b>${q.vision ? ` <span class="chip ghost" style="height:17px;font-size:10px">Vision</span>` : ""}<span class="ev">${q.id === 10 && S.coverFix ? "已缩短为「榨汁杯免手洗」6 字，缩略图可读" : q.id === 9 && S.qc[9] === "ok" ? "已自动折行为 2 行，最长 14 字；错别字 0" : q.id === 2 && S.qc[2] === "ok" ? "重写后最高相似度 0.79，4-gram 重合 11%" : q.id === 12 && S.qc[12] === "ok" ? "重生成 shot 04 后复检，5 帧未再出现其他杯体" : q.ev}</span>${vision}</span>
      ${q.fix && st !== "ok" ? `<span class="fix">${q.fix.step === "rewrite"
        ? `<button class="btn sm" data-act="goto" data-hash="#/p/p1/rewrite">${q.id === 2 ? "去改第 3 句" : "回到改写"}</button>`
        : `<button class="btn sm" data-act="fix-one" data-id="${q.id}">${q.fix.label}</button>`}</span>` : ""}
    </div>`;
  }).join("");

  const exporting = S.exporting;
  const remaining = P.qc.filter(q => S.qc[q.id] === "fail");

  return `
  ${stepHead("qc", "17 项标准：文本走 DeepSeek、画面走多模态、数值与事实走回溯核对",
    `${chip(passCount() + " 通过", "ok")} ${warnCount() ? chip(warnCount() + " 警告", "warn") : ""} ${fails ? chip(fails + " 未通过", "bad") : ""}`)}
  <div class="card">
    <div class="qc-sum">
      <span class="big">${fails === 0 ? "可以导出" : fails + " 处需要处理"}</span>
      <span class="sub tiny muted">${fails === 0 ? "全部检查通过，可生成交付包"
        : remaining.map(q => q.id === 2 ? "改写差异需回到第 3 步" : q.id === 10 ? "封面主标题可一键缩短" : q.t).join("；")}</span>
      <span class="grow"></span>
      <button class="btn sm" data-act="qc-rerun">${ic("refresh", 13)} 重新质检</button>
    </div>
    ${rows}
  </div>

  <div class="card">
    <div class="card-h"><h3>导出包</h3><span class="sub">固定 8 件，目录不零散补件</span><span class="grow"></span>
      ${S.exported ? chip("已导出", "ok") : canExport() ? chip("可导出", "ok") : chip("已阻断", "bad")}</div>
    <div class="card-b" style="padding:6px 10px 12px">
      <div class="exports">
        ${[["01", "source-transcript.md", "6 KB"], ["02", "script.md", "4 KB"], ["03", "subtitle.srt", "3 KB"],
           ["04", "storyboard.md", "5 KB"], ["05", "video-1080x1920.mp4", "18.6 MB"], ["06", "cover.png", "412 KB"],
           ["07", "publish-copy.md", "2 KB"], ["08", "publish-notes.md", "2 KB"]]
          .map(([k, n, sz]) => `<div class="ex">
            <span class="ico">${ic("file", 12)}</span>
            <span class="nm mono">${k}-${n}</span>
            <span class="sz mono">${sz}</span>
            ${S.stale.render && k >= "05" && k <= "06" ? chip("过期", "ghost") : chip("就绪", "ok")}
          </div>`).join("")}
      </div>
      <div style="display:flex;gap:8px;align-items:center;padding:12px 6px 4px;border-top:1px solid var(--line);margin-top:10px">
        <div class="tiny muted" style="flex:1">
          ${S.exported ? `已生成 <span class="mono">order-20261120-014.zip</span> · 21.1MB · 链接 24 小时有效`
            : S.qcOverride ? "已强制放行（理由已留痕），导出包会附上质检说明。"
            : fails ? "未通过项会阻断导出；也可以说明理由后强制放行（留痕）。"
            : "确认后装配目录并打包，发布仍需人工在平台客户端完成。"}
        </div>
        ${S.exported
          ? `<button class="btn sm" data-act="toast" data-msg="开始下载 order-20261120-014.zip">${ic("download", 13)} 下载 zip</button>`
          : fails && !S.qcOverride
            ? `<button class="btn sm danger" data-act="override-open">${ic("shield", 13)} 强制放行…</button>
               <button class="btn sm primary" disabled>${ic("download", 13)} 导出</button>`
            : `<button class="btn sm primary" data-act="export">${exporting ? `装配中 ${exporting}/3` : `${ic("download", 13)} 导出 zip`}</button>`}
      </div>
    </div>
  </div>

  <div class="note">${ic("info", 14)}<div><b>发布说明：</b>导出后用发布文案和封面在抖音 / 视频号 / 小红书客户端发布。系统不代发——官方代发接口主要面向政务与媒体内部平台，普通商业工具很难拿到。</div></div>

  ${deliveryCard()}`;
};

/* ---------------- delivery card ---------------- */
const CLIENT_COMMENTS = [
  { tc: "00:03", cue: 3, who: "小野生活 · 阿May", text: "这句有点长，能不能压到 12 字以内？", hit: "rewrite", hitLabel: "改口播稿" },
  { tc: "00:15", cue: 6, who: "小野生活 · 阿May", text: "十秒出汁能不能加个具体时间点，显得真实。", hit: "rewrite", hitLabel: "改口播稿" },
  { tc: "00:23", cue: 8, who: "小野生活 · 阿May", text: "封面能不能换成冲水那一帧？", hit: "render", hitLabel: "重做封面" }
];

function deliveryCard() {
  const n = S.deliveryComments;
  const link = "https://review.koubo.local/d/8Kq2mR";
  return `<div class="card">
    <div class="card-h"><h3>客户交付</h3><span class="sub">免登录签名链接 · 绑定 v2 快照</span>
      <span class="grow"></span>${n ? chip(n + " 条客户意见", "warn") : chip("待发送", "ghost")}</div>
    <div class="card-b">
      <div class="row2" style="gap:14px;align-items:center">
        <div>
          <div class="tiny muted" style="margin-bottom:4px">交付链接（7 天有效 · 可撤销）</div>
          <div class="mono" style="color:var(--ink2);word-break:break-all">${link}</div>
          <div class="tiny muted" style="margin-top:6px">客户只能看到成片、封面、字幕和文案；看不到提示词、成本和其他项目。</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn sm" data-act="copy-link">${ic("copy", 13)} 复制链接</button>
          <button class="btn sm" data-act="open-deliver">${ic("eye", 13)} 以客户视角打开</button>
        </div>
      </div>

      ${n ? `<div class="divider"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <b style="font-size:12.5px">客户意见</b>
        <span class="tiny muted">已自动归到对应步骤，确认后才重跑</span>
        <span class="grow"></span>
        <button class="btn sm" data-act="clear-comments">全部已处理</button>
      </div>
      ${CLIENT_COMMENTS.slice(0, n).map(c => `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid #F4F0E7">
        <span class="chip accent mono" style="flex:none;height:19px;font-size:10.5px">${c.tc}</span>
        <span style="flex:1;min-width:0">
          <span style="display:block;font-size:12.5px;line-height:1.6">${c.text}</span>
          <span class="tiny muted">${c.who}</span>
        </span>
        <button class="btn sm" data-act="goto" data-hash="#/p/p1/${c.hit}" style="flex:none">${ic("chev", 12)} ${c.hitLabel}</button>
      </div>`).join("")}` : `<div class="note" style="margin-top:12px">${ic("info", 14)}<div>把链接发给客户，客户逐句留言后会带时间码回到这里，不需要微信来回发截图。</div></div>`}
    </div>
  </div>`;
}

function renderWorkspace() {
  const panel = (PANELS[S.step] || PANELS.intake)();
  const title = S.live && S.liveProject ? S.liveProject.title : P.title;
  const chipKey = S.live
    ? (S.liveExported ? "exported" : failCount() ? "needs_review" : "running")
    : (S.exported ? "exported" : failCount() ? "needs_review" : "running");
  const costStr = S.live ? ("¥" + num(S.liveCost || 0)) : "¥0.27 / 条";
  const liveTag = S.live ? chip("已连 API", "accent") : "";
  const runTag = S.runProgress ? chip(S.runProgress, "warn") : "";

  const crumbs = `
    <button class="btn ghost sm" data-act="goto" data-hash="#/projects">${ic("back", 14)}</button>
    <span>项目</span><span class="sep">/</span><b>${title}</b>
    ${projectChip(chipKey)} ${liveTag} ${runTag}`;

  const right = `
    <span class="chip ghost">${ic("layout", 11)} ${S.live ? "script 管线" : P.template}</span>
    <span class="chip ghost">${ic("coin", 11)} ${costStr}</span>
    <button class="btn sm" data-act="goto" data-hash="${pHash("qc")}">${ic("download", 13)} 导出包</button>`;

  const models = window.modelBoardHTML ? window.modelBoardHTML({ step: S.step }) : "";
  return `${topbar(crumbs, right)}
    <div class="ws">
      ${pipeHTML()}
      ${models}
      <div class="ws-body">
        <div class="ws-main">${panel}</div>
        <div class="ws-side">${sideHTML()}</div>
      </div>
    </div>`;
}

/* ---------------- actions ---------------- */
Object.assign(ACTIONS, {
  "go-step": d => { S.step = d.step; location.hash = pHash(d.step); },

  "regen": () => {
    if (S.regen) return;
    S.regen = true;
    toast("正在重写第 3 句…", "refresh");
    setTimeout(() => {
      S.regen = false;
      S.script[2] = "杯口是大口径的，水一冲，果渣自己就滑出去了。";
      S.diff[1] = { k: "句向量相似", v: 0.79, max: 1, status: "ok", label: "0.79", th: "阈值 < 0.85" };
      S.qc[15] = "ok";
      S.scriptV = S.scriptV + 1;
      ["produce", "render", "copy", "qc"].forEach(k => S.stale[k] = 1);
      toast("已重写并标记下游过期，需重跑到最新", "alert");
      render();
    }, 1500);
  },

  "approve-script": () => {
    if (S.diff[1].status === "bad") { toast("还有 1 项差异未达标，不能通过审核", "alert"); return; }
    S.step = "route";
    location.hash = "#/p/p1/route";
    toast("口播稿已通过审核");
  },

  "save-script": () => {
    const lines = $$(".script .tx").map(e => e.innerText.trim()).filter(Boolean);
    if (lines.length) S.script = lines;
    S.edited = false;
    S.scriptV = S.scriptV + 1;
    ["produce", "render", "copy", "qc"].forEach(k => S.stale[k] = 1);
    toast("已保存 v" + S.scriptV + " · 4 个下游步骤标记过期");
    render();
  },

  "rerun-all": () => {
    if (S.live) { window.liveRunAll({}); return; }
    if (S.queue && S.queue.length) return;
    S.queue = ["produce", "render", "copy", "qc"];
    S.exported = false;
    step();
    function step() {
      if (!S.queue.length) {
        S.queue = null;
        S.running = null;
        if (S.diff[1].status === "ok") S.qc[2] = "ok";
        S.stale = {};
        toast("已重跑到最新 · 复用了 2 个未变更节点，节省 ¥0.06");
        render();
        return;
      }
      S.running = S.queue.shift();
      delete S.stale[S.running];
      render();
      setTimeout(step, 850);
    }
  },

  "dismiss-stale": () => { S.stale = {}; toast("已忽略过期提示，产物仍是旧版本", "alert"); render(); },

  "side-tab": d => { S.side = d.tab; render(); },

  "platform": d => { S.platform = d.p; render(); },
  "title-fix": () => { S.titleFix = true; toast("标题已缩短到 9 字"); render(); },

  "copy-link": () => toast("交付链接已复制（7 天有效）"),
  "open-deliver": () => {
    if ($("#pv")) return;
    const el = document.createElement("div");
    el.className = "pv";
    el.id = "pv";
    el.innerHTML = `<div class="pv-bar">
        ${ic("eye", 14)}
        <span>客户视角预览</span>
        <span class="mono">review.koubo.local/d/8Kq2mR</span>
        <span class="grow"></span>
        <span style="opacity:.7;font-size:11.5px">客户看不到内部字段</span>
        <button class="btn sm" data-act="close-pv">关闭预览</button>
      </div>
      <div class="pv-frame"><iframe src="deliver.html" title="客户审阅页"></iframe></div>`;
    document.body.appendChild(el);
  },
  "close-pv": () => { const e = $("#pv"); if (e) e.remove(); },

  "broll-provider": d => {
    const b = BROLL.find(x => x.shot === d.shot);
    if (b) { b.provider = d.p; toast(`${d.shot} 镜已切到${d.p}`); }
    render();
  },

  "toggle-timeline": () => { S.showTimeline = !S.showTimeline; render(); },
  "clear-comments": () => { S.deliveryComments = 0; toast("已标记全部客户意见为已处理"); render(); },

  "route": d => {
    S.outRoute = d.route;
    if (d.route === "avatar") toast("已选数字人：本单预估 +¥3.20", "coin");
    render();
  },

  "fix-one": d => {
    const id = Number(d.id);
    S.qc[id] = "ok";
    if (id === 10) S.coverFix = true;
    if (id === 12) S.qc[12] = "ok";
    toast(id === 10 ? "封面主标题已缩短为 6 字"
      : id === 12 ? "已重生成 shot 04（可灵）并复检，竞品杯体消失"
      : id === 13 ? "已换用备选封面"
      : "字幕已自动折行");
    render();
  },

  "cover-fix": () => { S.coverFix = true; S.qc[10] = "ok"; toast("封面主标题已缩短为 6 字"); render(); },

  "qc-rerun": () => {
    toast("正在复检 14 项…", "refresh");
    setTimeout(() => {
      S.qc[9] = "ok"; S.qc[10] = "ok"; S.coverFix = true;
      if (S.diff[1].status === "ok") S.qc[2] = "ok";
      if (S.qc[12] !== "ok") S.qc[13] = "warn";
      toast(failCount() ? `复检完成，仍有 ${failCount()} 项未通过` : "复检完成，全部通过", failCount() ? "alert" : "check");
      render();
    }, 900);
  },

  "override-open": () => {
    openModal(`<div class="mh">
        <span class="ic">${ic("shield", 16)}</span>
        <div><h3>强制放行</h3><p>仍有 ${failCount()} 项质检未通过。放行会记入项目日志，并在导出包附上说明。请填写理由（≥ 6 字）。</p></div>
      </div>
      <div class="mb">
        <textarea class="input" id="ov-reason" rows="3" placeholder="例：客户确认封面文字由设计另行替换"></textarea>
        <div class="tiny muted" style="margin-top:8px">${ic("info", 12)} 强制放行不改变质检结论，只解除本次导出阻断。</div>
      </div>
      <div class="mf">
        <button class="btn" data-act="close-modal">取消</button>
        <button class="btn danger" data-act="override-confirm">确认放行</button>
      </div>`);
  },

  "override-confirm": async () => {
    const box = $("#ov-reason");
    const v = box ? box.value : "";
    if (v.trim().length < 6) { toast("理由至少 6 个字", "alert"); return; }
    if (S.live) {
      try {
        await window.kouboApi.qcOverride(S.pid, v.trim());
        await window.refreshLiveProject(S.pid);
        closeModal();
        toast("已强制放行，理由已写入 qc_report");
        render();
      } catch (e) {
        toast(e.message || "放行失败", "alert");
      }
      return;
    }
    S.qcOverride = true;
    closeModal();
    toast("已强制放行，理由已留痕");
    render();
  },

  "export": async () => {
    if (S.live) {
      if (S.exporting) return;
      S.exporting = 1;
      render();
      try {
        await window.kouboApi.runStep(S.pid, "export", {});
        await window.refreshLiveProject(S.pid);
        toast("export_pkg 已生成（见右侧产物 export_pkg）", "check");
      } catch (e) {
        toast(e.message || "导出失败", "alert");
      }
      S.exporting = 0;
      render();
      return;
    }
    if (S.exporting) return;
    S.exporting = 1;
    render();
    const t = setInterval(() => {
      S.exporting += 1;
      if (S.exporting > 3) {
        clearInterval(t);
        S.exporting = 0;
        S.exported = true;
        toast("导出完成 · 8 件产物 · 21.1MB");
      }
      render();
    }, 700);
  },

  "goto": d => {
    let h = d.hash;
    if (h && S.live) h = h.replace("#/p/p1/", "#/p/" + wsPid() + "/");
    location.hash = h;
  },
  "toast": d => toast(d.msg),
  "close-modal": () => closeModal()
});
