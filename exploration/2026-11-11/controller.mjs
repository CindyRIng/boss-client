#!/usr/bin/env node
/**
 * BOSS直聘登录 + 只读链路探索控制器（2026-11-11）
 *
 * 目标：非无头 cloakbrowser 打开 BOSS，记录「页面浏览顺序 + 所有 document/XHR/fetch 请求」，
 * 跑通「二维码获取 + 短信验证码登录」，登录后按命令逐项操作（搜索/翻页/岗位/公司/状态）。
 *
 * 运行：
 *   cd ~/boss-client && ~/cloak-env/bin/cloak-run node exploration/2026-11-11/controller.mjs
 *
 * 注意：
 * - 使用独立 profile：~/.boss-client/profile（0700）
 * - 短信验证码 / 手机号 / Cookie 不写入日志；只落在 profile 与 storage-state（0600）
 * - 产物在 exploration/2026-11-11/artifacts/，全部 0600/0700
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import os from 'node:os';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = process.env.BOSS_EXPLORATION_ROOT ?? path.join(os.homedir(), 'boss-client');
const EXP = path.join(ROOT, 'exploration/2026-11-11');
const ART = path.join(EXP, 'artifacts');
const PROFILE = path.join(os.homedir(), '.boss-client/profile');
const CRED_FILE = process.env.BOSS_CRED_FILE ?? path.join(os.homedir(), '.boss-client/credentials.json');
const LOGIN_URL =
  'https://www.zhipin.com/web/user/?from=passport-zp&fromUrl=https%3A%2F%2Fwww.zhipin.com%2F';
const HOME = 'https://www.zhipin.com/';

const A = {
  network: path.join(ART, 'network.jsonl'),
  navigations: path.join(ART, 'navigations.jsonl'),
  actions: path.join(ART, 'actions.jsonl'),
  responses: path.join(ART, 'responses.jsonl'),
  states: path.join(ART, 'states'),
  screens: path.join(ART, 'screenshots'),
  bodies: path.join(ART, 'responses'),
  storage: path.join(ART, 'storage-state.json'),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const stamp = () =>
  `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let fileSeq = 0;
let netSeq = 0;
let actionSeq = 0;
let pageSeq = 0;
let activePage = null;
const pageIds = new WeakMap();

let appendChain = Promise.resolve();
function append(file, obj) {
  appendChain = appendChain
    .then(() => fs.appendFile(file, JSON.stringify(obj) + '\n', { mode: 0o600 }))
    .catch(() => {});
  return appendChain;
}

async function writeJson(file, obj) {
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function redactText(s) {
  if (s === null || s === undefined) return s;
  let t = String(s);
  t = t.replace(/(phone|mobile|tel|smsCode|verifyCode|password|token|cookie)=([^&\s]*)/gi, '$1=***');
  t = t.replace(/1[3-9]\d{9}/g, '1**********');
  return t;
}

function redactUrl(u) {
  try {
    const x = new URL(u);
    for (const k of ['phone', 'mobile', 'tel', 'smsCode', 'verifyCode', 'code', 'password', 'token', 'uuid', 'qrId']) {
      if (x.searchParams.has(k)) x.searchParams.set(k, '***');
    }
    return redactText(x.toString());
  } catch {
    return redactText(u);
  }
}

function pickHeaders(h) {
  const out = {};
  for (const k of ['accept', 'content-type', 'referer', 'origin', 'user-agent', 'x-requested-with', 'x-csrf-token']) {
    if (h[k]) out[k] = redactText(h[k]);
  }
  return out;
}

function safeName(u) {
  try {
    const x = new URL(u);
    let s = (x.pathname || '/').replace(/[^\w.-]+/g, '_').slice(0, 90);
    if (!s.endsWith('.json') && !s.endsWith('.html')) s += '.bin';
    return s;
  } catch {
    return 'unknown.bin';
  }
}

async function mkdirs() {
  for (const d of [PROFILE, ART, A.states, A.screens, A.bodies]) {
    await fs.mkdir(d, { recursive: true, mode: 0o700 });
    await fs.chmod(d, 0o700).catch(() => {});
  }
}

function pageId(page) {
  if (!pageIds.has(page)) pageIds.set(page, `p${++pageSeq}`);
  return pageIds.get(page);
}

function attachPage(page) {
  const id = pageId(page);
  append(A.actions, { ts: now(), type: 'page-attached', page: id, url: redactUrl(page.url()) }).catch(() => {});

  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    append(A.navigations, {
      ts: now(),
      page: id,
      type: 'framenavigated',
      url: redactUrl(frame.url()),
    }).catch(() => {});
  });
  page.on('load', () => {
    append(A.navigations, { ts: now(), page: id, type: 'load', url: redactUrl(page.url()) }).catch(() => {});
  });
  page.on('domcontentloaded', () => {
    append(A.navigations, { ts: now(), page: id, type: 'domcontentloaded', url: redactUrl(page.url()) }).catch(() => {});
  });

  page.on('request', (req) => {
    const rt = req.resourceType();
    if (!['document', 'xhr', 'fetch'].includes(rt)) return;
    append(A.network, {
      ts: now(),
      seq: ++netSeq,
      page: id,
      kind: 'request',
      resourceType: rt,
      method: req.method(),
      url: redactUrl(req.url()),
      postData: redactText(req.postData()),
      headers: pickHeaders(req.headers()),
    }).catch(() => {});
  });

  page.on('requestfailed', (req) => {
    const rt = req.resourceType();
    if (!['document', 'xhr', 'fetch'].includes(rt)) return;
    append(A.network, {
      ts: now(),
      page: id,
      kind: 'requestfailed',
      resourceType: rt,
      method: req.method(),
      url: redactUrl(req.url()),
      failure: req.failure()?.errorText ?? null,
    }).catch(() => {});
  });

  page.on('response', (res) => {
    const rt = res.request().resourceType();
    if (!['document', 'xhr', 'fetch'].includes(rt)) return;
    const url = res.url();
    const headers = res.headers();
    const ct = String(headers['content-type'] || '');
    const entry = {
      ts: now(),
      page: id,
      kind: 'response',
      resourceType: rt,
      status: res.status(),
      url: redactUrl(url),
      contentType: ct,
    };
    append(A.network, entry).catch(() => {});

    const wantJson = /zhipin\.com/.test(url) && /\/wapi\//.test(url) && /json/i.test(ct);
    const wantHtml = rt === 'document' && /zhipin\.com/.test(url) && /html/i.test(ct);
    if (!wantJson && !wantHtml) return;

    const limit = wantHtml ? 3 * 1024 * 1024 : 2 * 1024 * 1024;
    (async () => {
      let body;
      try {
        body = await Promise.race([
          res.body(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('body-timeout')), 8000)),
        ]);
      } catch {
        return;
      }
      if (!body) return;
      const truncated = body.length > limit;
      const buf = truncated ? body.subarray(0, limit) : body;
      const file = path.join(A.bodies, `${String(++fileSeq).padStart(4, '0')}_${safeName(url)}`);
      await fs.writeFile(file, buf, { mode: 0o600 });
      await fs.chmod(file, 0o600).catch(() => {});
      append(A.responses, {
        ts: now(),
        page: id,
        url: redactUrl(url),
        status: res.status(),
        contentType: ct,
        file: path.relative(EXP, file),
        bytes: buf.length,
        truncated,
        sha256: sha256(buf),
      }).catch(() => {});
    })();
  });

  page.on('pageerror', (err) => {
    append(A.actions, { ts: now(), type: 'pageerror', page: id, message: String(err.message || err) }).catch(() => {});
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    append(A.actions, { ts: now(), type: 'console-error', page: id, text: msg.text().slice(0, 400) }).catch(() => {});
  });
}

async function bodyText(page) {
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

async function snapshot(label) {
  const page = activePage;
  const id = pageId(page);
  const shotFile = path.join(A.screens, `${String(++fileSeq).padStart(4, '0')}_${label.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: shotFile, fullPage: false, timeout: 20000 }).catch(() => {});
  await fs.chmod(shotFile, 0o600).catch(() => {});
  const body = await bodyText(page);
  const state = {
    ts: now(),
    label,
    page: id,
    url: redactUrl(page.url()),
    title: await page.title().catch(() => ''),
    body: body.slice(0, 5000),
    screenshot: path.relative(EXP, shotFile),
  };
  const stateFile = path.join(A.states, `${String(++fileSeq).padStart(4, '0')}_${label.replace(/[^\w-]+/g, '_')}.json`);
  await writeJson(stateFile, state);
  return state;
}

async function annotate(name, params = {}) {
  const id = `a${++actionSeq}`;
  await append(A.actions, { ts: now(), type: 'action-start', id, name, page: pageId(activePage), params });
  return id;
}

async function annotateEnd(id, ok, detail = {}) {
  await append(A.actions, { ts: now(), type: 'action-end', id, ok, ...detail });
}

async function act(name, params, fn) {
  const id = await annotate(name, params);
  try {
    const result = await fn();
    await annotateEnd(id, true, { result: result ?? null });
    return result;
  } catch (err) {
    await annotateEnd(id, false, { error: String(err?.message || err) });
    throw err;
  }
}

function looksLikeCaptcha(text) {
  return /请完成验证|拖动滑块|请在下图|点击按钮进行验证|请选中下图中|滑块/.test(text);
}

async function captchaState() {
  const text = await bodyText(activePage);
  return { visible: looksLikeCaptcha(text), text: text.slice(0, 600) };
}

async function reportCaptcha(label) {
  const st = await captchaState();
  if (!st.visible) return false;
  console.log(`>>> CAPTCHA_REQUIRED (${label}) <<<`);
  const s = await snapshot(`captcha-${label}`);
  console.log(`[captcha] screenshot: ${s.screenshot}`);
  console.log('[captcha] run `captcha` to open/inspect, then `clickrel fx fy` / `click x y` / `confirm`.');
  return true;
}

let lastCaptcha = null;

async function clickAt(x, y) {
  const page = activePage;
  await page.mouse.move(x, y, { steps: 12 });
  await sleep(120);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await sleep(650);
}

async function clickRel(fx, fy) {
  if (!lastCaptcha?.mainBox) throw new Error('先运行 captcha 获取主图坐标');
  const b = lastCaptcha.mainBox;
  const x = b.x + Number(fx) * b.w;
  const y = b.y + Number(fy) * b.h;
  console.log(`[captcha] click rel(${fx},${fy}) -> page(${x.toFixed(1)},${y.toFixed(1)})`);
  await clickAt(x, y);
}

async function confirmCaptcha() {
  const page = activePage;
  const commit = page.locator('.geetest_commit, [aria-label="确认"], .geetest_commit_tip').first();
  if (await commit.isVisible().catch(() => false)) {
    await commit.click({ timeout: 8000 }).catch(() => {});
    console.log('[captcha] clicked 确认');
    await sleep(4000);
  } else {
    console.log('[captcha] no confirm button visible');
  }
  const st = await captchaState();
  console.log('[captcha] after confirm visible=', st.visible);
  return !st.visible;
}

function b64ToFile(b64, file) {
  return fs.writeFile(file, Buffer.from(b64, 'base64'), { mode: 0o600 }).then(() => fs.chmod(file, 0o600).catch(() => {}));
}

async function captureGeetest() {
  const page = activePage;
  const info = await page.evaluate(async () => {
    const boxOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const bgUrl = (el) => {
      if (!el) return null;
      const bg = getComputedStyle(el).backgroundImage || '';
      const m = bg.match(/url\(["']?(.*?)["']?\)/);
      return m ? m[1] : null;
    };
    const tipContent = document.querySelector('.geetest_tip_content')?.innerText?.trim() || null;
    const tipImg = document.querySelector('.geetest_tip_img');
    const itemWrap = document.querySelector('.geetest_item_wrap');
    const itemImg = document.querySelector('.geetest_item_img');
    const commit = document.querySelector('.geetest_commit');
    const full = document.querySelector('.geetest_fullpage_click_box') || document.querySelector('.geetest_holder');
    const wordSpans = [...document.querySelectorAll('.geetest_tip_text span')].map((s) => s.innerText.trim()).filter(Boolean);
    const loading = Boolean(document.querySelector('.geetest_item_loading:not([style*="display: none"])'));
    const mainUrl = bgUrl(itemWrap) || (itemImg?.src || null);
    const tipUrl = bgUrl(tipImg);
    const out = {
      tipContent,
      wordSpans,
      loading,
      mainBox: boxOf(itemWrap) || boxOf(itemImg),
      itemImgBox: boxOf(itemImg),
      commitBox: boxOf(commit),
      fullBox: boxOf(full),
      tipBox: boxOf(tipImg),
      mainUrl,
      tipUrl,
      itemImgSrc: itemImg?.src || null,
      body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 800),
      mainB64: null,
      tipB64: null,
      error: null,
    };
    async function fetchB64(u) {
      if (!u) return null;
      if (u.startsWith('data:')) return u.split(',')[1] || null;
      const r = await fetch(u, { credentials: 'include' });
      const buf = await r.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    try {
      out.mainB64 = await fetchB64(mainUrl);
      out.tipB64 = await fetchB64(tipUrl);
    } catch (e) {
      out.error = String(e);
    }
    return out;
  }).catch((e) => ({ error: String(e) }));

  const summary = { ...info };
  delete summary.mainB64;
  delete summary.tipB64;
  summary.ts = now();
  await writeJson(path.join(ART, 'captcha-info.json'), summary);
  if (info.mainB64) {
    await b64ToFile(info.mainB64, path.join(ART, 'captcha-main.png'));
    console.log('[captcha] saved artifacts/captcha-main.png');
  }
  if (info.tipB64) {
    await b64ToFile(info.tipB64, path.join(ART, 'captcha-tip.png'));
    console.log('[captcha] saved artifacts/captcha-tip.png');
  }
  const shot = await snapshot('captcha-panel');
  console.log(
    JSON.stringify(
      {
        tipContent: info.tipContent,
        wordSpans: info.wordSpans,
        loading: info.loading,
        mainBox: info.mainBox,
        commitBox: info.commitBox,
        fullBox: info.fullBox,
        tipBox: info.tipBox,
        mainUrl: (info.mainUrl || '').slice(0, 160),
        tipUrl: (info.tipUrl || '').slice(0, 160),
        screenshot: shot.screenshot,
      },
      null,
      2,
    ),
  );
  lastCaptcha = summary;
  return summary;
}

async function openCaptcha() {
  const page = activePage;
  const btn = page.getByText('点击按钮进行验证', { exact: false }).first();
  if (await btn.isVisible().catch(() => false)) {
    console.log('[captcha] clicking 点击按钮进行验证 ...');
    await btn.click({ timeout: 10000 }).catch(() => {});
    await sleep(5000);
  }
  return captureGeetest();
}

async function saveCaptchaCanvases() {
  const page = activePage;
  const data = await page
    .evaluate(() => {
      const grab = (sel) => {
        const c = document.querySelector(sel);
        if (!c) return null;
        try {
          return c.toDataURL('image/png');
        } catch {
          return null;
        }
      };
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      return {
        bg: grab('.geetest_canvas_bg'),
        slice: grab('.geetest_canvas_slice'),
        sliderBox: box('.geetest_slider_button'),
        windowBox: box('.geetest_window'),
      };
    })
    .catch((e) => ({ error: String(e) }));

  const out = { ts: now(), ...data };
  for (const key of ['bg', 'slice']) {
    if (data?.[key]) {
      const b64 = data[key].split(',')[1] || '';
      await b64ToFile(b64, path.join(ART, `captcha-${key}.png`));
      console.log(`[captcha] saved artifacts/captcha-${key}.png`);
      out[key] = `[redacted ${b64.length} b64 chars]`;
    }
  }
  await writeJson(path.join(ART, 'captcha-canvas.json'), out);
  const s = await snapshot('captcha-canvas');
  console.log(JSON.stringify({ sliderBox: data?.sliderBox, windowBox: data?.windowBox, screenshot: s.screenshot }, null, 2));
  return data;
}

async function dragSlider(dx, dy = 0) {
  const page = activePage;
  const btn = page.locator('.geetest_slider_button').first();
  const box = await btn.boundingBox().catch(() => null);
  if (!box) throw new Error('未找到滑块按钮');
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  const distance = Number(dx);
  console.log(`[drag] from page(${sx.toFixed(1)},${sy.toFixed(1)}) dx=${distance} dy=${dy}`);
  await page.mouse.move(sx, sy, { steps: 8 });
  await sleep(180);
  await page.mouse.down();
  await sleep(220);
  const steps = 70;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = sx + distance * eased;
    const y = sy + Number(dy) * eased + Math.sin(t * Math.PI * 4) * 0.6;
    await page.mouse.move(x, y, { steps: 1 });
    await sleep(6 + Math.round(14 * Math.abs(Math.sin(i * 1.7))));
  }
  await page.mouse.move(sx + distance, sy + Number(dy), { steps: 3 });
  await sleep(500);
  await page.mouse.up();
  await sleep(3500);
  const st = await captchaState();
  const result = await page.locator('.geetest_result').innerText().catch(() => '');
  const body = await bodyText(page);
  const sent = /已发送|秒后重新发送|重新发送|验证码已发送/.test(body);
  console.log(JSON.stringify({ captchaVisible: st.visible, result, smsSent: sent, body: body.slice(0, 400) }, null, 2));
  const s = await snapshot('after-drag');
  console.log('screenshot:', s.screenshot);
  return { captchaVisible: st.visible, result, sent };
}

async function refreshCaptcha() {
  const page = activePage;
  const refresh = page.locator('.geetest_refresh_1, .geetest_refresh').first();
  if (await refresh.isVisible().catch(() => false)) {
    await refresh.click({ timeout: 8000 }).catch(() => {});
    await sleep(4000);
    console.log('[captcha] refreshed');
  } else {
    console.log('[captcha] no refresh button');
  }
  return captureGeetest();
}

async function clickFirstText(page, regex, timeout = 8000) {
  const loc = page.getByText(regex, { exact: false });
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i += 1) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function isLoggedIn() {
  const page = activePage;
  const body = await bodyText(page);
  const url = page.url();
  if (/\/web\/user/.test(url) && /验证码登录|APP扫码登录|登录\/注册/.test(body)) return false;
  const r = await page
    .evaluate(async () => {
      try {
        const resp = await fetch('/wapi/zpuser/wap/getUserInfo.json', { credentials: 'include' });
        const json = await resp.json().catch(() => null);
        return { http: resp.status, json };
      } catch (e) {
        return { http: 0, error: String(e) };
      }
    })
    .catch(() => null);
  const data = r?.json?.zpData || r?.json?.data || null;
  return Boolean(r && r.http === 200 && r.json && (r.json.code === 0 || r.json.code === '0') && data);
}

async function captureQr() {
  const page = activePage;
  console.log('[qr] switching to QR tab ...');
  await clickFirstText(page, /APP扫码登录|扫码登录/);
  await sleep(3500);
  const s = await snapshot('qr-tab');

  const info = await page
    .evaluate(async () => {
      const out = { imgs: [], canvases: [], container: null };
      const cand = [];
      for (const img of document.querySelectorAll('img')) {
        const src = img.currentSrc || img.src || '';
        const cls = String(img.className || '');
        if (/qr/i.test(cls) || /qrcode|qr/i.test(src)) {
          cand.push({ tag: 'img', cls, src, w: img.naturalWidth, h: img.naturalHeight });
        }
      }
      for (const c of document.querySelectorAll('canvas')) {
        const cls = String(c.className || '');
        if (/qr/i.test(cls)) cand.push({ tag: 'canvas', cls, w: c.width, h: c.height });
      }
      if (!cand.length) {
        const box = document.querySelector('.qrcode, .qr-code, [class*="qrcode"], [class*="qr-code"]');
        if (box) {
          out.container = { tag: box.tagName, cls: String(box.className || ''), htmlLen: box.innerHTML.length };
          const img = box.querySelector('img');
          if (img) cand.push({ tag: 'img', cls: String(img.className || ''), src: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight });
          const cv = box.querySelector('canvas');
          if (cv) cand.push({ tag: 'canvas', cls: String(cv.className || ''), w: cv.width, h: cv.height });
        }
      }
      out.imgs = cand.map((c) => ({
        tag: c.tag,
        cls: c.cls,
        srcPrefix: c.tag === 'img' ? String(c.src).slice(0, 120) : null,
        srcLen: c.tag === 'img' ? String(c.src).length : null,
        w: c.w,
        h: c.h,
      }));

      const first = cand[0];
      if (!first) return out;
      try {
        if (first.tag === 'img') {
          const src = first.src;
          if (src.startsWith('data:')) {
            const b64 = src.split(',')[1] || '';
            return { ...out, dataUrl: src.slice(0, 64), base64: b64 };
          }
          const resp = await fetch(src, { credentials: 'include' });
          const buf = await resp.arrayBuffer();
          let bin = '';
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
          return { ...out, dataUrl: src.slice(0, 120), base64: btoa(bin) };
        }
        if (first.tag === 'canvas') {
          const cv = document.querySelector('canvas');
          const dataUrl = cv.toDataURL('image/png');
          return { ...out, dataUrl: dataUrl.slice(0, 64), base64: dataUrl.split(',')[1] || '' };
        }
      } catch (e) {
        return { ...out, error: String(e) };
      }
      return out;
    })
    .catch((e) => ({ error: String(e) }));

  if (info?.base64) {
    const buf = Buffer.from(info.base64, 'base64');
    const qrFile = path.join(ART, 'qr.png');
    await fs.writeFile(qrFile, buf, { mode: 0o600 });
    await fs.chmod(qrFile, 0o600).catch(() => {});
    info.base64 = `[redacted ${buf.length} bytes]`;
    console.log(`[qr] saved ${path.relative(EXP, qrFile)} (${buf.length} bytes)`);
  } else {
    console.log('[qr] no QR image captured; see screenshot', s.screenshot);
  }
  await writeJson(path.join(ART, 'qr-info.json'), { ...info, ts: now(), state: s });
  return info;
}

async function sendSms() {
  const page = activePage;
  const cred = JSON.parse(await fs.readFile(CRED_FILE, 'utf8'));
  const phone = String(cred.phone || '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error('credentials boss.json 缺少合法手机号');

  console.log('[sms] switching to SMS tab ...');
  await clickFirstText(page, /验证码登录/);
  await sleep(2000);
  await snapshot('login-sms-tab');

  const pre = await captchaState();
  if (pre.visible) {
    await reportCaptcha('pre-send');
    return false;
  }

  const tel = page.locator('input[type="tel"]').first();
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.click();
  await tel.fill('');
  await tel.pressSequentially(phone, { delay: 80 });
  await sleep(600);

  const cb = page.locator('input[type="checkbox"]').first();
  if (await cb.isVisible().catch(() => false)) {
    await cb.check({ force: true }).catch(async () => {
      await cb.click({ force: true }).catch(() => {});
    });
  }

  console.log('[sms] clicking 发送验证码 ...');
  const send = page.getByText('发送验证码', { exact: false }).first();
  await send.waitFor({ state: 'visible', timeout: 15000 });
  await send.click({ timeout: 15000 });
  await sleep(3500);

  const hasCaptcha = await reportCaptcha('post-send');
  let body = await bodyText(page);
  let sent = /已发送|秒后重新发送|重新发送|验证码已发送/.test(body);
  const s = await snapshot('login-after-sms');
  await writeJson(path.join(ART, 'sms-send.json'), {
    ts: now(),
    sent,
    captcha: hasCaptcha,
    url: redactUrl(page.url()),
    body: body.slice(0, 900),
    screenshot: s.screenshot,
  });
  if (sent) console.log('[sms] SMS_SENT');
  else if (hasCaptcha) console.log('[sms] SMS_BLOCKED_BY_CAPTCHA (run `captcha`, solve, then `send`)');
  else console.log('[sms] SMS_SENT_UNKNOWN');
  return sent;
}

async function submitCode(code) {
  const page = activePage;
  await clickFirstText(page, /验证码登录/);
  await sleep(1000);

  const codeInput = page.locator('input[placeholder*="验证码"], input[placeholder*="短信"]').first();
  await codeInput.waitFor({ state: 'visible', timeout: 20000 });
  await codeInput.click();
  await codeInput.fill('');
  await codeInput.pressSequentially(String(code), { delay: 120 });
  await sleep(500);

  const cb = page.locator('input[type="checkbox"]').first();
  if (await cb.isVisible().catch(() => false)) {
    await cb.check({ force: true }).catch(async () => {
      await cb.click({ force: true }).catch(() => {});
    });
  }

  console.log('[login] clicking 登录/注册 ...');
  let clicked = false;
  const btn = page.getByText('登录/注册', { exact: true });
  const n = await btn.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i -= 1) {
    const el = btn.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 15000 }).catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    await page.locator('button.sure-btn, .sms-form-btn, button[type="submit"]').last().click({ timeout: 10000 }).catch(() => {});
  }
  await sleep(6000);
  const hasCaptcha = await reportCaptcha('post-login');
  await sleep(2500);

  let ok = await isLoggedIn();
  const s = await snapshot('after-code-submit');
  await writeJson(path.join(ART, 'login-result.json'), {
    ts: now(),
    ok,
    captcha: hasCaptcha,
    url: redactUrl(page.url()),
    body: (s.body || '').slice(0, 1200),
  });
  if (ok) {
    await page.context().storageState({ path: A.storage }).catch(() => {});
    await fs.chmod(A.storage, 0o600).catch(() => {});
    console.log('[login] LOGIN_OK');
  } else if (hasCaptcha) {
    console.log('[login] LOGIN_BLOCKED_BY_CAPTCHA (run `captcha`, solve, `confirm`, then `logincheck`)');
  } else {
    console.log('[login] LOGIN_NOT_YET (run `logincheck`; if still not, `loginclick` then `logincheck`)');
  }
  return ok;
}

async function commandStatus() {
  const page = activePage;
  const info = await page
    .evaluate(async () => {
      const out = {};
      for (const [k, u] of Object.entries({
        user: '/wapi/zpuser/wap/getUserInfo.json',
        account: '/wapi/zpuser/h5/account/getStatus',
        vip: '/wapi/zpitem/geek/vip/info',
      })) {
        try {
          const r = await fetch(u, { credentials: 'include' });
          out[k] = { http: r.status, json: await r.json().catch(() => null) };
        } catch (e) {
          out[k] = { error: String(e) };
        }
      }
      return out;
    })
    .catch((e) => ({ error: String(e) }));

  const file = path.join(ART, `status-${stamp()}.json`);
  await writeJson(file, { ts: now(), url: redactUrl(page.url()), info });
  const user = info.user?.json?.zpData || info.user?.json?.data || null;
  console.log(
    JSON.stringify(
      {
        url: redactUrl(page.url()),
        userCode: info.user?.json?.code ?? null,
        userIdLen: user?.userId ? String(user.userId).length : null,
        userName: user?.name ? `${String(user.name).slice(0, 1)}**` : null,
        accountCode: info.account?.json?.code ?? null,
        vipCode: info.vip?.json?.code ?? null,
        file: path.relative(EXP, file),
      },
      null,
      2,
    ),
  );
  return info;
}

async function commandCookies() {
  const cookies = await activePage.context().cookies();
  const summary = cookies.map((c) => ({ name: c.name, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure }));
  const file = path.join(ART, `cookies-${stamp()}.json`);
  await writeJson(file, { ts: now(), cookies: summary });
  console.log(JSON.stringify({ count: summary.length, names: summary.map((c) => c.name), file: path.relative(EXP, file) }, null, 2));
  return summary;
}

async function commandEval(js) {
  const result = await activePage.evaluate(js).catch((e) => ({ error: String(e) }));
  const text = JSON.stringify(result);
  console.log(text.length > 4000 ? text.slice(0, 4000) + '…' : text);
  return result;
}

async function commandSearch(query, city = '101090100') {
  const page = activePage;
  const url = `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}&industry=&position=`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(8000);
  await reportCaptcha('search');
  const s = await snapshot(`search-${query}-${city}`);
  const count = await page.locator('a[href*="/job_detail/"]').count().catch(() => 0);
  const companies = await page.locator('a[href*="/gongsi/"]').count().catch(() => 0);
  console.log(JSON.stringify({ url: redactUrl(page.url()), jobLinks: count, companyLinks: companies, screenshot: s.screenshot }, null, 2));
  return { count, companies };
}

async function commandNext(pageNo) {
  const page = activePage;
  const candidates = [
    'a[ka*="page-next"]',
    '.options-pages a:has-text("下一页")',
    '.pagination a:has-text("下一页")',
    'a:has-text("下一页")',
  ];
  let clicked = false;
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 15000 }).catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked && pageNo) {
    const u = new URL(page.url());
    u.searchParams.set('page', String(pageNo));
    await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  }
  await sleep(7000);
  await reportCaptcha('next-page');
  const s = await snapshot(`page-${pageNo || 'next'}`);
  const count = await page.locator('a[href*="/job_detail/"]').count().catch(() => 0);
  console.log(JSON.stringify({ clicked, url: redactUrl(page.url()), jobLinks: count, screenshot: s.screenshot }, null, 2));
  return count;
}

async function commandJob(n = 1) {
  const page = activePage;
  const links = page.locator('a[href*="/job_detail/"]');
  const total = await links.count().catch(() => 0);
  if (!total) throw new Error('当前页面没有 job_detail 链接');
  const idx = Math.max(0, Math.min(total - 1, Number(n) - 1));
  const href = await links.nth(idx).getAttribute('href').catch(() => null);
  await links.nth(idx).click({ timeout: 15000 }).catch(async () => {
    await links.nth(idx).evaluate((el) => el.click());
  });
  await sleep(9000);
  await reportCaptcha('job-detail');
  const s = await snapshot(`job-detail-${n}`);
  const companyLinks = await page.locator('a[href*="/gongsi/"]').count().catch(() => 0);
  console.log(JSON.stringify({ href, url: redactUrl(page.url()), companyLinks, screenshot: s.screenshot }, null, 2));
  return { href, companyLinks };
}

async function commandCompany(n = 1) {
  const page = activePage;
  const links = page.locator('a[href*="/gongsi/"]');
  const total = await links.count().catch(() => 0);
  if (!total) throw new Error('当前页面没有 /gongsi/ 链接');
  const idx = Math.max(0, Math.min(total - 1, Number(n) - 1));
  const href = await links.nth(idx).getAttribute('href').catch(() => null);
  const before = new Set(page.context().pages());
  await links.nth(idx).click({ timeout: 15000 }).catch(async () => {
    await links.nth(idx).evaluate((el) => el.click());
  });
  await sleep(8000);
  const newPage = page.context().pages().find((p) => !before.has(p));
  if (newPage) {
    activePage = newPage;
    await newPage.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
    await sleep(3000);
  }
  await reportCaptcha('company-detail');
  const s = await snapshot(`company-detail-${n}`);
  console.log(JSON.stringify({ href, newTab: Boolean(newPage), url: redactUrl(activePage.url()), screenshot: s.screenshot }, null, 2));
  return { href, newTab: Boolean(newPage) };
}

async function commandCompanyUrl(url) {
  const page = activePage;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(8000);
  await reportCaptcha('company-url');
  const s = await snapshot('company-url');
  console.log(JSON.stringify({ url: redactUrl(page.url()), screenshot: s.screenshot }, null, 2));
}

async function commandGongsi() {
  const page = activePage;
  await page.goto('https://www.zhipin.com/gongsi/', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(8000);
  await reportCaptcha('gongsi');
  const s = await snapshot('gongsi-list');
  const companies = await page.locator('a[href*="/gongsi/"]').count().catch(() => 0);
  console.log(JSON.stringify({ url: redactUrl(page.url()), companyLinks: companies, screenshot: s.screenshot }, null, 2));
  return { companies };
}

async function commandScroll(px = 900) {
  await activePage.evaluate((n) => window.scrollBy(0, n), px).catch(() => {});
  await sleep(2500);
  const s = await snapshot('scroll');
  const count = await activePage.locator('a[href*="/job_detail/"]').count().catch(() => 0);
  console.log(JSON.stringify({ url: redactUrl(activePage.url()), jobLinks: count, screenshot: s.screenshot }, null, 2));
  return count;
}

async function commandPages() {
  const pages = activePage.context().pages();
  const out = [];
  for (const p of pages) {
    out.push({ page: pageId(p), active: p === activePage, url: redactUrl(p.url()), title: await p.title().catch(() => '') });
  }
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function main() {
  await mkdirs();
  await writeJson(path.join(ART, 'run.json'), {
    ts: now(),
    profile: PROFILE,
    loginUrl: LOGIN_URL,
    node: process.version,
    display: process.env.DISPLAY,
    cwd: process.cwd(),
  });

  console.log('[boot] launching cloakbrowser (headful) ...');
  const ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: false,
    humanize: true,
    timezone: 'Asia/Shanghai',
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    args: ['--start-maximized'],
  });
  ctx.on('page', (p) => {
    attachPage(p);
    if (!activePage) activePage = p;
  });
  for (const p of ctx.pages()) {
    attachPage(p);
    if (!activePage) activePage = p;
  }
  if (!activePage) activePage = await ctx.newPage();
  console.log('[boot] browser ready; profile=', PROFILE);

  await activePage.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(6000);
  await snapshot('login-initial');
  console.log('[boot] login page:', activePage.url());

  if (await isLoggedIn()) {
    console.log('[boot] already logged in (profile session reused); skip QR/SMS');
    await snapshot('boot-logged-in');
  } else {
    await captureQr();
    await sendSms();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n=== commands ===');
  console.log('code <6位短信验证码>   提交短信验证码登录');
  console.log('loginstate | status | cookies');
  console.log('home | search <关键词> [城市码] | next [页码] | scroll [px]');
  console.log('job <n> | company <n> | companyurl <url> | gongsi');
  console.log('state [label] | body | shot [label] | pages | switch <n> | back');
  console.log('html [label] | eval <js> | quit');
  console.log('================\n');

  while (true) {
    let line;
    try {
      line = (await rl.question('boss> ')).trim();
    } catch {
      break;
    }
    if (!line) continue;
    const [cmd, ...rest] = line.split(/\s+/);
    try {
      switch (cmd) {
        case 'code':
          await act('submit-code', { length: String(rest[0] || '').length }, () => submitCode(rest[0]));
          break;
        case 'loginstate': {
          const ok = await isLoggedIn();
          console.log('loggedIn=', ok, 'url=', redactUrl(activePage.url()));
          break;
        }
        case 'status':
          await act('status', {}, () => commandStatus());
          break;
        case 'cookies':
          await act('cookies', {}, () => commandCookies());
          break;
        case 'home':
          await act('home', {}, async () => {
            await activePage.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
            await sleep(6000);
            const s = await snapshot('home');
            console.log(JSON.stringify({ url: redactUrl(activePage.url()), screenshot: s.screenshot }, null, 2));
          });
          break;
        case 'search':
          await act('search', { query: rest[0], city: rest[1] }, () => commandSearch(rest[0], rest[1]));
          break;
        case 'next':
          await act('next', { page: rest[0] }, () => commandNext(rest[0]));
          break;
        case 'scroll':
          await act('scroll', { px: rest[0] }, () => commandScroll(Number(rest[0] || 900)));
          break;
        case 'job':
          await act('job', { n: rest[0] }, () => commandJob(Number(rest[0] || 1)));
          break;
        case 'company':
          await act('company', { n: rest[0] }, () => commandCompany(Number(rest[0] || 1)));
          break;
        case 'companyurl':
          await act('companyurl', {}, () => commandCompanyUrl(rest[0]));
          break;
        case 'gongsi':
          await act('gongsi', {}, () => commandGongsi());
          break;
        case 'state': {
          const s = await snapshot(rest[0] || 'state');
          console.log(JSON.stringify({ url: s.url, title: s.title, body: s.body.slice(0, 400), screenshot: s.screenshot }, null, 2));
          break;
        }
        case 'body': {
          const b = await bodyText(activePage);
          console.log(b.slice(0, 2000));
          break;
        }
        case 'shot': {
          const s = await snapshot(rest[0] || 'shot');
          console.log('screenshot:', s.screenshot);
          break;
        }
        case 'html': {
          const name = (rest[0] || 'page').replace(/[^\w-]+/g, '_');
          const html = await activePage.content().catch(() => '');
          const text = await bodyText(activePage);
          const f = path.join(A.states, `html-${name}-${stamp()}.json`);
          await writeJson(f, { ts: now(), url: redactUrl(activePage.url()), html, text });
          console.log('saved:', path.relative(EXP, f), 'htmlBytes=', html.length);
          break;
        }
        case 'pages':
          await commandPages();
          break;
        case 'switch': {
          const pages = activePage.context().pages();
          const i = Number(rest[0] || 1) - 1;
          if (pages[i]) {
            activePage = pages[i];
            console.log('active=', pageId(activePage), redactUrl(activePage.url()));
          } else {
            console.log('no such page');
          }
          break;
        }
        case 'back':
          await activePage.goBack({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          await sleep(4000);
          await snapshot('back');
          console.log('url=', redactUrl(activePage.url()));
          break;
        case 'eval':
          await commandEval(rest.join(' '));
          break;
        case 'send':
          await act('send-sms-again', {}, () => sendSms());
          break;
        case 'captcha':
        case 'open-captcha':
          await act('open-captcha', {}, () => openCaptcha());
          break;
        case 'captcha-info':
          await act('captcha-info', {}, () => captureGeetest());
          break;
        case 'canvas':
          await act('canvas', {}, () => saveCaptchaCanvases());
          break;
        case 'drag':
          await act('drag', { dx: rest[0] }, () => dragSlider(rest[0], rest[1] || 0));
          break;
        case 'refresh':
          await act('refresh-captcha', {}, () => refreshCaptcha());
          break;
        case 'click': {
          const x = Number(rest[0]);
          const y = Number(rest[1]);
          console.log(`[click] page(${x},${y})`);
          await clickAt(x, y);
          break;
        }
        case 'clickrel': {
          await clickRel(rest[0], rest[1]);
          break;
        }
        case 'clicks': {
          for (const pair of rest) {
            const [fx, fy] = pair.split(',');
            await clickRel(fx, fy);
          }
          break;
        }
        case 'confirm':
          await confirmCaptcha();
          break;
        case 'logincheck': {
          const ok = await isLoggedIn();
          console.log('loggedIn=', ok, 'url=', redactUrl(activePage.url()));
          if (ok) {
            await activePage.context().storageState({ path: A.storage }).catch(() => {});
            await fs.chmod(A.storage, 0o600).catch(() => {});
          }
          break;
        }
        case 'loginclick': {
          const btn = activePage.getByText('登录/注册', { exact: true });
          const n = await btn.count().catch(() => 0);
          for (let i = n - 1; i >= 0; i -= 1) {
            const el = btn.nth(i);
            if (await el.isVisible().catch(() => false)) {
              await el.click({ timeout: 15000 }).catch(() => {});
              console.log('[login] clicked 登录/注册');
              break;
            }
          }
          await sleep(5000);
          console.log('url=', redactUrl(activePage.url()));
          break;
        }
        case 'help':
          console.log(
            'code/loginstate/logincheck/loginclick/status/cookies/home/search/next/scroll/job/company/companyurl/gongsi/' +
              'state/body/shot/pages/switch/back/html/eval/send/captcha/captcha-info/canvas/drag/refresh/click/clickrel/clicks/confirm/quit',
          );
          break;
        case 'quit':
          await activePage.context().storageState({ path: A.storage }).catch(() => {});
          await fs.chmod(A.storage, 0o600).catch(() => {});
          await ctx.close().catch(() => {});
          rl.close();
          console.log('[quit] browser closed');
          return;
        default:
          console.log('unknown command:', cmd, '(type help)');
      }
    } catch (err) {
      console.log('ERROR:', String(err?.message || err));
    }
  }
  await ctx.close().catch(() => {});
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
