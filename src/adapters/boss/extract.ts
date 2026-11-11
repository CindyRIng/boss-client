/**
 * BOSS 页面 DOM 提取：公司详情、公司全部职位、二维码、极验
 */
import type { Page } from 'playwright-core';
import { BossError } from '../../errors/catalog.js';
import type { CompanyJob } from '../../domain/company.js';
import type { CaptchaChallenge } from '../../domain/login.js';
import type { LoginCaptchaRequest } from '../../domain/login.js';
import type { ExtractedCompanyDetail } from './mapper.js';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function pngDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

export async function bodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

export async function assertPageUsable(page: Page): Promise<void> {
  const url = page.url();
  const body = await bodyText(page);
  if (/\/web\/user/.test(url) || /验证码登录|APP扫码登录/.test(body)) {
    throw new BossError('AUTH_REQUIRED', 'BOSS 登录态失效，请先登录');
  }
  if (/环境存在异常|访问过于频繁|请完成验证/.test(body)) {
    throw new BossError('UPSTREAM_BLOCKED', 'BOSS 页面触发风控/验证码');
  }
}

export async function clickText(page: Page, re: RegExp, timeout = 8000): Promise<boolean> {
  const loc = page.getByText(re, { exact: false });
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

/* ------------------------------------------------------------------ */
/* 公司详情                                                             */
/* ------------------------------------------------------------------ */

export async function extractCompanyDetail(page: Page): Promise<ExtractedCompanyDetail> {
  await assertPageUsable(page);
  await page.waitForSelector('.company-banner, .company-info-box, .company-full-name', { timeout: 15000 }).catch(() => {});
  return page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const text = (sel: string) => clean(document.querySelector(sel)?.textContent);
    const texts = (sel: string) => [...document.querySelectorAll(sel)].map((e) => clean(e.textContent)).filter(Boolean);
    const name = (text('h1.name') || text('span.name') || text('.company-full-name')).replace(/收藏/g, '').trim();
    const fullName = text('.company-full-name');
    const infoText = text('.info-primary .info p');
    const stageMatch = /(未融资|天使轮|A轮|B轮|C轮|D轮及以上|已上市|不需要融资)/.exec(infoText);
    const scaleMatch = /(\d+-\d+人|\d+人以上|\d+人以下|10000人以上)/.exec(infoText);
    const industry = text('a.industry-link');
    const logo = document.querySelector<HTMLImageElement>('.info-primary img')?.src ?? undefined;
    const statText = text('.company-stat');
    const jobCountMatch = /(\d+)\s*在招职位/.exec(statText);
    const bossCountMatch = /(\d+)\s*位BOSS/.exec(statText);
    const business: Record<string, string> = {};
    for (const li of document.querySelectorAll('.business-detail li, li[class*="business-detail"], li.col-auto')) {
      const t = clean(li.textContent);
      const m = /^([^：:]+)[：:]\s*(.*)$/.exec(t);
      if (m) business[m[1]!.trim()] = m[2]!.trim();
    }
    const introRaw = text('.company-info-box');
    const intro = introRaw.startsWith('公司简介') ? introRaw.slice('公司简介'.length).trim() : introRaw;
    const address = (text('.job-location') || business['注册地址'] || '').replace(/点击查看地图/g, ' ').replace(/\s+/g, ' ').trim() || undefined;
    const cityName = business['所属地区'] || undefined;
    const benefits = texts('.work-tags .work-tag-item');
    const tags = [industry].filter(Boolean) as string[];

    const hotJobs: CompanyJob[] = [];
    const seen = new Set<string>();
    for (const a of document.querySelectorAll<HTMLAnchorElement>('.company-hotjob a[href*="/job_detail/"]')) {
      const href = a.getAttribute('href') ?? '';
      const jobId = /\/job_detail\/([^/.]+)\.html/.exec(href)?.[1];
      if (!jobId || seen.has(jobId)) continue;
      seen.add(jobId);
      const card = a.closest('.job-card, li, .job-item, .job-box') ?? a.parentElement;
      const t = clean(card?.textContent ?? a.textContent);
      const salary = /(\d+(?:\.\d+)?\s*[-~]\s*\d+(?:\.\d+)?\s*[kK]|\d+\s*[-~]\s*\d+\s*元\/天)/.exec(t)?.[1];
      const exp = /(经验不限|在校\/应届|应届生|\d+-\d+年|\d+年以内|\d+年以上)/.exec(t)?.[1];
      const degree = /(学历不限|初中|中专|高中|大专|本科|硕士|博士)/.exec(t)?.[1];
      hotJobs.push({
        jobId,
        title: clean(a.textContent),
        salaryText: salary ?? '',
        ...(exp ? { experience: exp } : {}),
        ...(degree ? { degree } : {}),
        ...(address ? { cityName: address.split(/[·\s]/)[0] } : {}),
        jobUrl: new URL(href, location.origin).toString(),
      });
    }

    return {
      ...(name ? { name } : {}),
      ...(fullName ? { fullName } : {}),
      ...(logo ? { logo } : {}),
      ...(industry ? { industry } : {}),
      ...(scaleMatch ? { scale: scaleMatch[1] } : {}),
      ...(stageMatch ? { stage: stageMatch[1] } : {}),
      ...(cityName ? { cityName } : {}),
      ...(address ? { address } : {}),
      ...(intro ? { intro } : {}),
      tags,
      benefits,
      ...(jobCountMatch ? { jobCount: Number(jobCountMatch[1]) } : {}),
      ...(bossCountMatch ? { bossCount: Number(bossCountMatch[1]) } : {}),
      hotJobs,
      recruiters: [],
      business,
      url: location.href,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 公司全部职位                                                         */
/* ------------------------------------------------------------------ */

export async function extractCompanyJobs(page: Page): Promise<{ jobs: CompanyJob[]; jobCount: number; truncated: boolean }> {
  await assertPageUsable(page);
  await page.waitForSelector('.position-job-list li, .company-position-job .job-card-box, a[href*="/job_detail/"]', { timeout: 15000 }).catch(() => {});
  const data = await page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const cards = [
      ...document.querySelectorAll('.position-job-list li.job-card-box, .company-position-job .job-card-box, .position-job-container .job-card-box'),
    ];
    const jobs: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const card of cards) {
      const a = card.querySelector<HTMLAnchorElement>('a.job-name[href*="/job_detail/"], a[href*="/job_detail/"]');
      if (!a) continue;
      const href = a.getAttribute('href') ?? '';
      const jobId = /\/job_detail\/([^/.]+)\.html/.exec(href)?.[1];
      if (!jobId || seen.has(jobId)) continue;
      seen.add(jobId);
      const tags = [...card.querySelectorAll('.tag-list li')].map((e) => clean(e.textContent)).filter(Boolean);
      const bossText = clean(card.querySelector('.boss-name')?.textContent);
      const bossMatch = /^([^·]+)·(.+)$/.exec(bossText);
      const locText = clean(card.querySelector('.company-location')?.textContent);
      const locParts = locText.split('·').map((x) => clean(x)).filter(Boolean);
      const salary = clean(card.querySelector('.job-salary')?.textContent);
      const degree = tags.find((t) => /(学历不限|初中|中专|高中|大专|本科|硕士|博士)/.test(t));
      const experience = tags.find((t) => !/(学历不限|初中|中专|高中|大专|本科|硕士|博士)/.test(t));
      jobs.push({
        jobId,
        title: clean(a.textContent),
        salaryText: salary,
        ...(experience ? { experience } : {}),
        ...(degree ? { degree } : {}),
        ...(locParts[0] ? { cityName: locParts[0] } : {}),
        ...(locParts[1] ? { district: locParts[1] } : {}),
        ...(locParts[2] ? { businessDistrict: locParts[2] } : {}),
        ...(bossMatch?.[1] ? { recruiterName: bossMatch[1] } : {}),
        ...(bossMatch?.[2] ? { recruiterTitle: bossMatch[2] } : {}),
        jobUrl: new URL(href, location.origin).toString(),
      });
    }
    const body = clean(document.body.innerText);
    const countMatch = /招聘职位\((\d+)\)/.exec(body);
    return { jobs, jobCount: countMatch ? Number(countMatch[1]) : jobs.length, truncated: false };
  });
  return data as { jobs: CompanyJob[]; jobCount: number; truncated: boolean };
}

/* ------------------------------------------------------------------ */
/* 二维码                                                               */
/* ------------------------------------------------------------------ */

export async function extractQr(page: Page): Promise<{ pngBase64: string; width: number; height: number } | null> {
  await clickText(page, /APP扫码登录|扫码登录/);
  await sleep(3000);
  const data = await page.evaluate(async () => {
    const box = document.querySelector('.qr-code-box');
    const img = box?.querySelector<HTMLImageElement>('img') ?? document.querySelector<HTMLImageElement>('.qr-code-box img');
    if (!img) return null;
    const src = img.currentSrc || img.src;
    if (!src) return null;
    try {
      if (src.startsWith('data:')) {
        return { pngBase64: src, width: img.naturalWidth || 200, height: img.naturalHeight || 200 };
      }
      const r = await fetch(src, { credentials: 'include' });
      const buf = await r.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
      return { pngBase64: `data:image/png;base64,${btoa(bin)}`, width: img.naturalWidth || 200, height: img.naturalHeight || 200 };
    } catch {
      return null;
    }
  }).catch(() => null);
  if (data) return data;
  const box = page.locator('.qr-code-box').first();
  if (await box.isVisible().catch(() => false)) {
    const buf = await box.screenshot({ type: 'png' }).catch(() => null);
    if (buf) {
      const dims = await box.boundingBox().catch(() => null);
      return { pngBase64: pngDataUrl(buf), width: Math.round(dims?.width ?? 200), height: Math.round(dims?.height ?? 200) };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 极验                                                                 */
/* ------------------------------------------------------------------ */

async function elementShot(page: Page, selector: string): Promise<Buffer | null> {
  const loc = page.locator(selector).first();
  if (!(await loc.isVisible().catch(() => false))) return null;
  return loc.screenshot({ type: 'png' }).catch(() => null);
}

export async function captchaChallenge(page: Page): Promise<CaptchaChallenge | null> {
  const holder = page.locator('.geetest_holder').first();
  const visible = await holder.isVisible().catch(() => false);
  if (!visible) return null;
  const text = await bodyText(page);
  const promptText = (await page.locator('.geetest_tip_content').first().innerText().catch(() => '')).trim();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const screenshot = await page.screenshot({ type: 'png' }).catch(() => null);

  if (/请在下图依次点击|依次点击/.test(text) || promptText.includes('依次点击')) {
    const main = page.locator('.geetest_item_wrap').first();
    const mainLoc = (await main.isVisible().catch(() => false)) ? main : page.locator('.geetest_window').first();
    const box = await mainLoc.boundingBox().catch(() => null);
    if (!box) return null;
    const mainBuf = await mainLoc.screenshot({ type: 'png' }).catch(() => null);
    const tipBuf = await elementShot(page, '.geetest_tip_img');
    return {
      kind: 'click',
      ...(promptText ? { prompt: promptText } : { prompt: '请在下图依次点击：' }),
      image: { width: Math.round(box.width), height: Math.round(box.height) },
      ...(mainBuf ? { mainBase64: pngDataUrl(mainBuf) } : {}),
      ...(tipBuf ? { tipBase64: pngDataUrl(tipBuf) } : {}),
      ...(screenshot ? { screenshotBase64: pngDataUrl(screenshot) } : {}),
      expiresAt,
    };
  }

  if (/拖动滑块|滑块完成拼图/.test(text)) {
    const main = page.locator('.geetest_window').first();
    const box = await main.boundingBox().catch(() => null);
    if (!box) return null;
    const mainBuf = await main.screenshot({ type: 'png' }).catch(() => null);
    return {
      kind: 'slider',
      prompt: '拖动滑块完成拼图',
      image: { width: Math.round(box.width), height: Math.round(box.height) },
      ...(mainBuf ? { mainBase64: pngDataUrl(mainBuf) } : {}),
      ...(screenshot ? { screenshotBase64: pngDataUrl(screenshot) } : {}),
      expiresAt,
    };
  }
  return null;
}

async function clickHumanlike(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y, { steps: 12 });
  await sleep(120);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await sleep(650);
}

export async function solveCaptcha(page: Page, answer: LoginCaptchaRequest): Promise<void> {
  const challenge = await captchaChallenge(page);
  if (!challenge) throw new BossError('CAPTCHA_REQUIRED', '当前没有可见验证码');
  if (answer.kind === 'click') {
    const main = page.locator('.geetest_item_wrap').first();
    const mainLoc = (await main.isVisible().catch(() => false)) ? main : page.locator('.geetest_window').first();
    const box = await mainLoc.boundingBox().catch(() => null);
    if (!box) throw new BossError('UPSTREAM_CHANGED', '未找到验证码主图');
    for (const p of answer.points) {
      await clickHumanlike(page, box.x + p.x * box.width, box.y + p.y * box.height);
    }
    const commit = page.locator('.geetest_commit').first();
    if (await commit.isVisible().catch(() => false)) {
      await commit.click({ timeout: 8000 }).catch(() => {});
      await sleep(3000);
    }
  } else {
    const btn = page.locator('.geetest_slider_button').first();
    const slider = page.locator('.geetest_slider').first();
    const btnBox = await btn.boundingBox().catch(() => null);
    const sliderBox = await slider.boundingBox().catch(() => null);
    if (!btnBox || !sliderBox) throw new BossError('UPSTREAM_CHANGED', '未找到滑块');
    const max = Math.max(1, sliderBox.width - btnBox.width);
    const distance = answer.offsetRatio !== undefined ? answer.offsetRatio * max : Number(answer.offsetPx ?? 0);
    const sx = btnBox.x + btnBox.width / 2;
    const sy = btnBox.y + btnBox.height / 2;
    await page.mouse.move(sx, sy, { steps: 8 });
    await sleep(180);
    await page.mouse.down();
    await sleep(200);
    const steps = 70;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      await page.mouse.move(sx + distance * eased, sy + Math.sin(t * Math.PI * 4) * 0.6, { steps: 1 });
      await sleep(6 + Math.round(12 * Math.abs(Math.sin(i * 1.7))));
    }
    await page.mouse.move(sx + distance, sy, { steps: 2 });
    await sleep(400);
    await page.mouse.up();
    await sleep(3500);
  }
  await sleep(1500);
  const again = await captchaChallenge(page);
  if (again) {
    throw new BossError('CAPTCHA_INVALID', '验证码答案未通过', { details: { captcha: again } });
  }
}

export async function captchaVisible(page: Page): Promise<boolean> {
  return Boolean(await captchaChallenge(page));
}

/* ------------------------------------------------------------------ */
/* 短信                                                                 */
/* ------------------------------------------------------------------ */

export async function openSmsTab(page: Page): Promise<void> {
  await clickText(page, /验证码登录/);
  await sleep(1500);
}

export async function fillPhoneAndAgree(page: Page, phone: string): Promise<void> {
  const tel = page.locator('input[type="tel"]').first();
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.click();
  await tel.fill('');
  await tel.pressSequentially(phone, { delay: 70 });
  await sleep(400);
  const cb = page.locator('input[type="checkbox"]').first();
  if (await cb.isVisible().catch(() => false)) {
    await cb.check({ force: true }).catch(async () => {
      await cb.click({ force: true }).catch(() => {});
    });
  }
}

export async function clickSendSms(page: Page): Promise<void> {
  const send = page.getByText('发送验证码', { exact: false }).first();
  await send.waitFor({ state: 'visible', timeout: 15000 });
  await send.click({ timeout: 15000 });
  await sleep(3000);
}

export async function smsSent(page: Page): Promise<boolean> {
  const text = await bodyText(page);
  return /已发送|秒后重新发送|重新发送|验证码已发送/.test(text);
}

export async function submitSmsCode(page: Page, code: string): Promise<void> {
  await openSmsTab(page);
  const input = page.locator('input[placeholder*="验证码"], input[placeholder*="短信"]').first();
  await input.waitFor({ state: 'visible', timeout: 20000 });
  await input.click();
  await input.fill('');
  await input.pressSequentially(code, { delay: 100 });
  await sleep(300);
  const cb = page.locator('input[type="checkbox"]').first();
  if (await cb.isVisible().catch(() => false)) {
    await cb.check({ force: true }).catch(async () => {
      await cb.click({ force: true }).catch(() => {});
    });
  }
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
  await sleep(5000);
}
