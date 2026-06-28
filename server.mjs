import http from "node:http";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CHROME_ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
const HEADLESS = true;

// WGS-84 → GCJ-02 坐标转换（中国大陆地图应用偏移修正）
function wgs2gcj(lat, lng) {
  if (lat == null || lng == null) return { lat: lat, lng: lng };
  var a = 6378245.0;
  var ee = 0.00669342162296594323;
  var dLat = _transformLat(lng - 105.0, lat - 35.0);
  var dLng = _transformLng(lng - 105.0, lat - 35.0);
  var radLat = lat / 180.0 * Math.PI;
  var magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  var sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
function _transformLat(x, y) {
  var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
function _transformLng(x, y) {
  var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const LOGS_FILE = path.join(DATA_DIR, "logs.json");
const CAMPUSES_FILE = path.join(DATA_DIR, "campuses.json");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}

// 启动时加载校区数据（单一数据源）
const CAMPUSES = readJSON(CAMPUSES_FILE);
const CAMPUS_KEYS = Object.keys(CAMPUSES);
const CAMPUS_OPTIONS = CAMPUS_KEYS.map(function(k) {
  var c = CAMPUSES[k];
  var label = c.lat !== null ? c.name + " (" + c.lat.toFixed(4) + ", " + c.lng.toFixed(4) + ")" : c.name + " (待配置)";
  return '<option value="' + k + '">' + label + '</option>';
}).join("");
const CAMPUS_SCRIPT = '<script>var CAMPUSES=' + JSON.stringify(CAMPUSES) + ';</script>';

function readJSON(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch(e) { return file === LOGS_FILE ? [] : {}; } }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); }

function json(res, status, data) {
  var j = JSON.stringify(data), b = Buffer.from(j, "utf8");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": b.length });
  res.end(b);
}
function staticFile(res, full, ext) {
  var m = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  try { var c = fs.readFileSync(full); res.writeHead(200, { "Content-Type": (m[ext]||"text/plain")+"; charset=utf-8" }); res.end(c); return true; } catch(e) { return false; }
}

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.75(0x18004b2b) NetType/4G Language/zh_CN";

const WECHAT_INIT = function() {
  try { Object.defineProperty(navigator, "platform", { get: function() { return "iPhone"; } }); } catch(e) {}
  Object.defineProperty(window, "__wxjs_environment", { value: "develop", writable: true, configurable: true });
  if (typeof WeixinJSBridge === "undefined") {
    window.WeixinJSBridge = { invoke: function(a,p,cb) {
      var r = { err_msg: a + ":ok" };
      if (a === "getLocation") r = { err_msg: "getLocation:ok", latitude: 31.9590, longitude: 118.743518, speed: 0, accuracy: 65 };
      if (typeof cb === "function") setTimeout(function() { cb(r); }, 100);
    }, on: function(e,cb) { if (cb) cb(); } };
  }
  if (typeof wx === "undefined") {
    window.wx = { ready: function(cb) { if (cb) setTimeout(cb, 50); }, config: function(){}, error: function(){},
      getLocation: function(o) { if (o&&o.success) o.success({ latitude: 31.9590, longitude: 118.743518, speed: 0, accuracy: 65, errMsg: "getLocation:ok" }); },
      getNetworkType: function(o) { if (o&&o.success) o.success({ networkType: "wifi", errMsg: "getNetworkType:ok" }); }
    };
  }
};

function addLog(phone, type, success, msg) {
  var now = new Date();
  var ds = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
  var ts = String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0")+":"+String(now.getSeconds()).padStart(2,"0");
  var logs = readJSON(LOGS_FILE);
  logs.push({ phone: phone, type: type, date: ds, time: ts, success: success, msg: msg });
  if (logs.length > 500) logs = logs.slice(-500);
  writeJSON(LOGS_FILE, logs);
}

async function oauthLogin(phone, password) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: HEADLESS, args: CHROME_ARGS });
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "zh-CN", userAgent: UA });
    const page = await ctx.newPage();
    await page.addInitScript(WECHAT_INIT);
    await page.goto("https://c.uyiban.com/", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(3000);
    try { await page.waitForURL("**oauth.yiban.cn**", { timeout: 15000 }); } catch(e) {}
    if (!(await page.url()).includes("oauth.yiban.cn")) { await browser.close(); return { ok: false, reason: "无法访问易班登录页" }; }
    await page.evaluate(function(args) { var u=document.getElementById("check_u"),p=document.getElementById("check_p"); if(u)u.value=args[0];if(p)p.value=args[1];var cb=document.getElementById("checkbox_100");if(cb&&!cb.checked)cb.checked=true; }, [phone, password]);
    await page.evaluate(function() { var btn=document.querySelector(".bottom_box.oauth_sure"); if(btn)btn.click(); });
    try { await page.waitForURL(function(u) { return !u.toString().includes("oauth.yiban.cn"); }, { timeout: 15000 }); } catch(e) {}
    var loginOk = !(await page.url()).includes("oauth.yiban.cn");
    await browser.close();
    return { ok: loginOk };
  } catch(e) { await browser.close().catch(function(){}); throw e; }
}

async function doCheckin(phone, password, lat, lng) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: HEADLESS, args: CHROME_ARGS });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      locale: "zh-CN", userAgent: UA,
      geolocation: { latitude: lat, longitude: lng }, permissions: ["geolocation"],
    });
    const page = await ctx.newPage();
    await page.addInitScript(WECHAT_INIT);

    await page.goto("https://c.uyiban.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    try { await page.waitForURL("**oauth.yiban.cn**", { timeout: 15000 }); } catch(e) {}
    if ((await page.url()).includes("oauth.yiban.cn")) {
      await page.evaluate(function(args) {
        var u=document.getElementById("check_u"),p=document.getElementById("check_p");
        if(u)u.value=args[0];if(p)p.value=args[1];
        var cb=document.getElementById("checkbox_100");if(cb&&!cb.checked)cb.checked=true;
      }, [phone, password]);
      await page.evaluate(function() { var btn=document.querySelector(".bottom_box.oauth_sure"); if(btn)btn.click(); });
      try { await page.waitForURL(function(u) { return !u.toString().includes("oauth.yiban.cn"); }, { timeout: 15000 }); } catch(e) {}
    }

    await page.goto("https://app.uyiban.com/nightattendance/student/", { waitUntil: "domcontentloaded", timeout: 30000 });
    try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch(e) { await page.waitForTimeout(3000); }

    await page.evaluate(function() {
      var all = document.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) {
        var t = (all[i].textContent || "").trim();
        if (t === "我知道了" || t === "确定") { all[i].click(); return; }
      }
    });
    await page.waitForTimeout(1500);

    var pageText = await page.evaluate(function() { return (document.body || {}).innerText || ""; });
    var alreadyDone = pageText.indexOf("已签到") >= 0;

    if (!alreadyDone) {
      await page.evaluate(function() {
        var all = document.querySelectorAll("[class*=btn___1FJPN]");
        for (var i = 0; i < all.length; i++) { all[i].click(); return; }
      });
      await page.waitForTimeout(4000);
      pageText = await page.evaluate(function() { return (document.body || {}).innerText || ""; });
      if (pageText.indexOf("签到成功") >= 0) {
        await page.evaluate(function() {
          var all = document.querySelectorAll("*");
          for (var i = 0; i < all.length; i++) {
            if ((all[i].textContent || "").trim() === "知道了") { all[i].click(); break; }
          }
        });
      }
    }

    var finalMsg = alreadyDone ? "今日已签到"
      : pageText.indexOf("签到成功") >= 0 ? "签到成功"
      : pageText.indexOf("非法") >= 0 ? "今日已签到"
      : "签失败";

    await browser.close();
    return { success: true, msg: finalMsg };
  } catch(e) { await browser.close().catch(function(){}); throw e; }
}

var browserLock = false;
function acquireLock() { return new Promise(function(resolve) { var check = function() { if (!browserLock) { browserLock = true; resolve(); } else { setTimeout(check, 500); } }; check(); }); }
function releaseLock() { browserLock = false; }

const server = http.createServer(async (req, res) => {
  if (req.method === "GET") {
    if (req.url.startsWith("/api/logs")) {
      var u = new URL(req.url, "http://localhost"), phone = u.searchParams.get("phone") || "";
      var logs = readJSON(LOGS_FILE);
      if (phone) logs = logs.filter(function(l) { return l.phone === phone; });
      json(res, 200, { logs: logs.slice(-100) });
      return;
    }
    if (req.url === "/api/health") {
      json(res, 200, { status: "ok", time: new Date().toISOString() });
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      // 注入校区数据到 HTML
      var html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
      html = html.replace("<!--__CAMPUS_OPTIONS__-->", CAMPUS_OPTIONS);
      html = html.replace("/*__CAMPUS_DATA__*/", JSON.stringify(CAMPUSES));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    var fp = req.url;
    if (fp.indexOf("?") > 0) fp = fp.substring(0, fp.indexOf("?"));
    if (staticFile(res, path.join(__dirname, "public", fp), path.extname(fp))) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404");
    return;
  }

  var body = "";
  req.on("data", function(chunk) { body += chunk; });
  req.on("end", async function() {
    var params;
    try { params = JSON.parse(body); } catch(e) { json(res, 400, { success: false, msg: "invalid JSON" }); return; }

    if (req.url === "/api/logs/delete") {
      try {
        var logs = readJSON(LOGS_FILE);
        var phone = params.phone, idx = params.index, filtered = [], phoneIdx = 0;
        for (var i = 0; i < logs.length; i++) { if (logs[i].phone === phone) { if (phoneIdx !== idx) filtered.push(logs[i]); phoneIdx++; } else { filtered.push(logs[i]); } }
        writeJSON(LOGS_FILE, filtered);
        json(res, 200, { success: true });
      } catch(e) { json(res, 500, { success: false, msg: e.message }); }
      return;
    }

    if (req.url === "/api/login") {
      try {
        var result = await oauthLogin(params.phone, params.password);
        if (result.ok) {
          var resp = { success: true, msg: "登录成功" };
          var users = readJSON(USERS_FILE);
          if (users[params.phone]) { resp.settings = users[params.phone].settings; }
          json(res, 200, resp);
        } else { json(res, 401, { success: false, msg: result.reason }); }
      } catch(e) { json(res, 500, { success: false, msg: e.message }); }
      return;
    }

    if (req.url === "/api/settings") {
      try {
        var users = readJSON(USERS_FILE);
        if (!users[params.phone]) { users[params.phone] = {}; }
        users[params.phone].password = params.password || "";
        users[params.phone].settings = { campus: params.campus || "main", days: params.days || [], autoEnabled: params.autoEnabled || false };
        writeJSON(USERS_FILE, users);
        json(res, 200, { success: true, msg: "设置已保存" });
      } catch(e) { json(res, 500, { success: false, msg: e.message }); }
      return;
    }

    if (req.url === "/api/checkin") {
      try {
        await acquireLock();
        var result = await doCheckin(params.phone, params.password, Number(params.lat), Number(params.lng));
        addLog(params.phone, "manual", result.msg.indexOf("成功") >= 0 || result.msg.indexOf("已") >= 0, result.msg);
        releaseLock();
        json(res, 200, result);
      } catch(e) {
        try { releaseLock(); } catch(e2) {}
        addLog(params.phone, "manual", false, e.message);
        json(res, 500, { success: false, msg: e.message });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404");
  });
});

server.listen(PORT, function() { console.log("Server ready: http://0.0.0.0:" + PORT); });
