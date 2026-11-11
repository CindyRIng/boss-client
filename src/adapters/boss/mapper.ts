/**
 * BOSS 上游映射：raw API / DOM 提取 → 领域模型
 */
import type { CompanyDetail, CompanyJob, CompanySummary } from '../../domain/company.js';
import type { JobDetail, JobSummary } from '../../domain/job.js';
import { jobUrl as makeJobUrl } from './endpoints.js';
import type { RawJobRow } from './raw.js';

function iso(now = Date.now()): string {
  return new Date(now).toISOString();
}

export function parseSalary(text: string | undefined): { min?: number; max?: number } {
  if (!text) return {};
  const m = /(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*[kK]/.exec(text);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const m2 = /(\d+(?:\.\d+)?)\s*[kK]\s*[-~]\s*(\d+(?:\.\d+)?)\s*[kK]/.exec(text);
  if (m2) return { min: Number(m2[1]), max: Number(m2[2]) };
  return {};
}

export function mapJobSummary(raw: RawJobRow, baseUrl: string, now = Date.now()): JobSummary {
  const ts = iso(now);
  const salary = parseSalary(raw.salaryDesc);
  return {
    jobId: raw.encryptJobId,
    ...(raw.securityId ? { securityId: raw.securityId } : {}),
    ...(raw.lid ? { lid: raw.lid } : {}),
    title: raw.jobName,
    salaryText: raw.salaryDesc ?? '',
    ...(salary.min !== undefined ? { salaryMin: salary.min } : {}),
    ...(salary.max !== undefined ? { salaryMax: salary.max } : {}),
    experience: raw.jobExperience ?? '',
    degree: raw.jobDegree ?? '',
    ...(raw.city !== undefined && raw.city !== null ? { cityCode: String(raw.city) } : {}),
    ...(raw.cityName ? { cityName: raw.cityName } : {}),
    ...(raw.areaDistrict ? { district: raw.areaDistrict } : {}),
    ...(raw.businessDistrict ? { businessDistrict: raw.businessDistrict } : {}),
    companyId: raw.encryptBrandId,
    companyName: raw.brandName,
    ...(raw.brandIndustry ? { companyIndustry: raw.brandIndustry } : {}),
    ...(raw.brandScaleName ? { companyScale: raw.brandScaleName } : {}),
    ...(raw.brandStageName ? { companyStage: raw.brandStageName } : {}),
    ...(raw.bossName ? { bossName: raw.bossName } : {}),
    ...(raw.bossTitle ? { bossTitle: raw.bossTitle } : {}),
    ...(raw.bossOnline !== undefined ? { bossOnline: raw.bossOnline } : {}),
    skills: raw.skills ?? [],
    welfare: raw.welfareList ?? [],
    jobUrl: makeJobUrl(baseUrl, raw.encryptJobId),
    firstSeenAt: ts,
    lastSeenAt: ts,
  };
}

export function mapJobDetail(
  zp: {
    jobInfo: {
      jobName: string;
      salaryDesc?: string;
      experienceName?: string;
      degreeName?: string;
      locationName?: string;
      address?: string;
      longitude?: number;
      latitude?: number;
      postDescription?: string;
      showSkills?: string[];
      jobStatusDesc?: string;
    };
    bossInfo?: { name?: string; title?: string; online?: boolean | null; bossOnline?: boolean | null; large?: string };
    brandComInfo?: {
      encryptBrandId?: string;
      brandName?: string;
      logo?: string;
      stageName?: string;
      scaleName?: string;
      industryName?: string;
    };
  },
  jobId: string,
  baseUrl: string,
  securityId?: string,
  now = Date.now(),
): JobDetail {
  const job = zp.jobInfo;
  const boss = zp.bossInfo ?? {};
  const brand = zp.brandComInfo ?? {};
  return {
    jobId,
    ...(securityId ? { securityId } : {}),
    title: job.jobName,
    salaryText: job.salaryDesc ?? '',
    experience: job.experienceName ?? '',
    degree: job.degreeName ?? '',
    ...(job.locationName ? { cityName: job.locationName } : {}),
    ...(job.address ? { address: job.address } : {}),
    ...(job.latitude !== undefined ? { latitude: job.latitude } : {}),
    ...(job.longitude !== undefined ? { longitude: job.longitude } : {}),
    description: job.postDescription ?? '',
    skills: job.showSkills ?? [],
    ...(job.jobStatusDesc ? { jobStatusDesc: job.jobStatusDesc } : {}),
    recruiter: {
      ...(boss.name ? { name: boss.name } : {}),
      ...(boss.title ? { title: boss.title } : {}),
      ...(boss.online !== undefined && boss.online !== null ? { online: boss.online } : {}),
      ...(boss.large ? { avatar: boss.large } : {}),
    },
    company: {
      ...(brand.encryptBrandId ? { companyId: brand.encryptBrandId } : {}),
      ...(brand.brandName ? { name: brand.brandName } : {}),
      ...(brand.industryName ? { industry: brand.industryName } : {}),
      ...(brand.scaleName ? { scale: brand.scaleName } : {}),
      ...(brand.stageName ? { stage: brand.stageName } : {}),
      ...(brand.logo ? { logo: brand.logo } : {}),
    },
    jobUrl: makeJobUrl(baseUrl, jobId),
    fetchedAt: iso(now),
  };
}

export function mapCompanySummary(jobs: JobSummary[], companyId: string): CompanySummary {
  const first = jobs[0]!;
  const sorted = [...jobs].sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? -1 : 1));
  return {
    companyId,
    name: first.companyName,
    ...(first.companyIndustry ? { industry: first.companyIndustry } : {}),
    ...(first.companyScale ? { scale: first.companyScale } : {}),
    ...(first.companyStage ? { stage: first.companyStage } : {}),
    ...(first.cityName ? { cityName: first.cityName } : {}),
    jobCount: jobs.length,
    matchedJobs: jobs.slice(0, 10).map((j) => ({
      jobId: j.jobId,
      title: j.title,
      salaryText: j.salaryText,
      ...(j.cityName ? { cityName: j.cityName } : {}),
      ...(j.bossName ? { bossName: j.bossName } : {}),
      ...(j.bossTitle ? { bossTitle: j.bossTitle } : {}),
    })),
    firstSeenAt: sorted[0]!.firstSeenAt,
    lastSeenAt: sorted[sorted.length - 1]!.lastSeenAt,
  };
}

export interface ExtractedCompanyDetail {
  name?: string;
  fullName?: string;
  logo?: string;
  industry?: string;
  scale?: string;
  stage?: string;
  cityName?: string;
  address?: string;
  intro?: string;
  tags?: string[];
  benefits?: string[];
  jobCount?: number;
  bossCount?: number;
  hotJobs?: CompanyJob[];
  recruiters?: Array<{ name?: string; title?: string; online?: boolean }>;
  business?: Record<string, string>;
  url?: string;
}

export function mapCompanyDetail(extracted: ExtractedCompanyDetail, companyId: string, baseUrl: string, now = Date.now()): CompanyDetail {
  const b = extracted.business ?? {};
  return {
    companyId,
    name: extracted.name ?? b.companyName ?? companyId,
    ...(extracted.fullName ? { fullName: extracted.fullName } : {}),
    ...(extracted.logo ? { logo: extracted.logo } : {}),
    ...(extracted.industry ? { industry: extracted.industry } : {}),
    ...(extracted.scale ? { scale: extracted.scale } : {}),
    ...(extracted.stage ? { stage: extracted.stage } : {}),
    ...(extracted.cityName ? { cityName: extracted.cityName } : {}),
    ...(extracted.address ? { address: extracted.address } : {}),
    ...(extracted.intro ? { intro: extracted.intro.slice(0, 8000) } : {}),
    tags: extracted.tags ?? [],
    benefits: extracted.benefits ?? [],
    jobCount: extracted.jobCount ?? 0,
    bossCount: extracted.bossCount ?? 0,
    hotJobs: extracted.hotJobs ?? [],
    recruiters: extracted.recruiters ?? [],
    business: {
      ...(b['企业名称'] ? { companyName: b['企业名称'] } : {}),
      ...(b['法定代表人'] ? { legalRepresentative: b['法定代表人'] } : {}),
      ...(b['成立时间'] ? { foundedAt: b['成立时间'] } : {}),
      ...(b['企业类型'] ? { companyType: b['企业类型'] } : {}),
      ...(b['经营状态'] ? { businessStatus: b['经营状态'] } : {}),
      ...(b['注册资本'] ? { registeredCapital: b['注册资本'] } : {}),
      ...(b['注册地址'] ? { registeredAddress: b['注册地址'] } : {}),
      ...(b['营业期限'] ? { businessTerm: b['营业期限'] } : {}),
      ...(b['所属地区'] ? { region: b['所属地区'] } : {}),
      ...(b['统一社会信用代码'] ? { uscc: b['统一社会信用代码'] } : {}),
      ...(b['核准日期'] ? { approvalDate: b['核准日期'] } : {}),
      ...(b['登记机关'] ? { registrationAuthority: b['登记机关'] } : {}),
      ...(b['曾用名'] ? { formerNames: b['曾用名'] } : {}),
      ...(b['经营范围'] ? { businessScope: b['经营范围'] } : {}),
      usccSource: 'boss_company_page_text',
      textDerived: true,
    },
    url: extracted.url ?? `${baseUrl.replace(/\/+$/, '')}/gongsi/${encodeURIComponent(companyId)}.html`,
    fetchedAt: iso(now),
  };
}
