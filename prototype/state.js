/* ---------- global state ---------- */
const S = {
  live: false,
  liveReason: "",
  liveProjects: [],
  liveProject: null,
  liveGraph: null,
  livePid: null,
  liveStale: [],
  liveQcFails: 0,
  liveExported: false,
  liveCost: null,
  runProgress: "",
  _sseClose: null,

  route: "projects",
  pid: "p1",
  step: "rewrite",
  side: "art",

  stale: {},
  running: null,
  queue: null,
  outRoute: "voice",
  edited: false,
  regen: false,
  scriptV: 3,
  script: P.script.slice(),
  diff: P.diff.map(x => ({ ...x })),

  qc: Object.fromEntries(P.qc.map(q => [q.id, q.st])),
  coverFix: false,
  qcOverride: false,
  exported: false,
  exporting: 0,

  platform: "抖音",
  titleFix: false,
  showTimeline: false,
  deliveryComments: 3,

  form: {
    type: "link",
    url: "https://v.douyin.com/iRx8k2Q/",
    text: "",
    topic: "",
    file: false,
    platform: "抖音",
    dur: "",
    lang: "中文",
    route: "voice",
    forbid: ""
  },

  guideOpen: true
};

/* action registry — filled by workspace.js and app.js */
const ACTIONS = {};
