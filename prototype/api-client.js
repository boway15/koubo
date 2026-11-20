// M0 前端接入：把静态原型接到真实 API 上
// 设计：原型仍可单独打开（离线演示），一旦检测到 API 可达就切换为真实数据

var API = window.KOUBO_API || (location.pathname.indexOf("/studio") === 0 ? location.origin : "http://127.0.0.1:8787");
var TOKEN = (localStorage.getItem("koubo_token") || "").trim() || "dev-token";

async function req(method, path, body) {
  var res = await fetch(API + path, {
    method: method,
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    var e = new Error(data.error || res.statusText);
    e.status = res.status;
    e.data = data;
    if (res.status === 401) {
      e.fix = "在控制台执行：kouboApi.setToken('dev-token') 或 localStorage.removeItem('koubo_token') 后刷新";
    }
    throw e;
  }
  return data;
}

window.kouboApi = {
  setToken: function (t) {
    TOKEN = String(t || "").trim() || "dev-token";
    localStorage.setItem("koubo_token", TOKEN);
  },
  clearToken: function () {
    localStorage.removeItem("koubo_token");
    TOKEN = "dev-token";
  },
  getToken: function () { return TOKEN; },

  health: function () {
    return fetch(API + "/health").then(function (r) { return r.ok; }).catch(function () { return false; });
  },

  createProject: function (b) { return req("POST", "/api/projects", b); },
  listProjects: function () { return req("GET", "/api/projects"); },
  getProject: function (id) { return req("GET", "/api/projects/" + id); },
  runStep: function (id, step, b) { return req("POST", "/api/projects/" + id + "/steps/" + step + "/run", b || {}); },
  runAll: function (id, b) { return req("POST", "/api/projects/" + id + "/run", b || {}); },
  editArtifact: function (id, kind, content) { return req("PATCH", "/api/projects/" + id + "/artifacts/" + kind, { content: content }); },
  listArtifacts: function (id) { return req("GET", "/api/projects/" + id + "/artifacts"); },
  getArtifact: function (id, kind) { return req("GET", "/api/projects/" + id + "/artifacts/" + kind); },
  qcOverride: function (id, reason) { return req("POST", "/api/projects/" + id + "/qc/override", { reason: reason }); },
  cost: function (id) { return req("GET", "/api/projects/" + id + "/cost"); },
  pipelines: function () { return req("GET", "/api/pipelines"); },
  providers: function () { return req("GET", "/api/providers"); },

  // SSE：返回关闭函数
  subscribe: function (id, onEvent, sinceSeq) {
    // EventSource 无法自定义请求头，所以 token 走 query（服务端仅对 /events 放行）
    var url = API + "/api/projects/" + id + "/events?since=" + (sinceSeq || 0) + "&token=" + encodeURIComponent(TOKEN);
    var es = new EventSource(url);
    es.onmessage = function (e) {
      try { onEvent(JSON.parse(e.data)); } catch (err) {}
    };
    return function () { es.close(); };
  }
};

// 探测：原型启动时调用，决定用真数据还是演示数据
window.kouboProbe = async function () {
  var ok = await window.kouboApi.health();
  if (!ok) return { live: false, reason: "API 未启动（在 app/ 里跑 npm run dev）" };
  try {
    var r = await window.kouboApi.listProjects();
    return { live: true, count: r.projects.length };
  } catch (e) {
    if (e.status === 401 && localStorage.getItem("koubo_token")) {
      localStorage.removeItem("koubo_token");
      TOKEN = "dev-token";
      try {
        var r2 = await window.kouboApi.listProjects();
        return { live: true, count: r2.projects.length, note: "已清除错误的 koubo_token，已改用 dev-token" };
      } catch (e2) {
        return { live: false, reason: "token 不正确（请确认 Docker LOCAL_TOKEN，默认 dev-token）" };
      }
    }
    return {
      live: false,
      reason: e.status === 401
        ? "token 不正确：请求头需 Bearer dev-token（" + (e.fix || "见 api-client") + "）"
        : String(e.message)
    };
  }
};
