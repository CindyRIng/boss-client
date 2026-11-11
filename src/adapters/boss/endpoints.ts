/**
 * BOSS 直聘端点常量（2026-11-11 实测）
 */
export const BOSS_ENDPOINTS = {
  baseUrl: 'https://www.zhipin.com',
  loginUrl: 'https://www.zhipin.com/web/user/?from=passport-zp&fromUrl=https%3A%2F%2Fwww.zhipin.com%2F',
  searchPage: '/web/geek/jobs',
  searchApi: '/wapi/zpgeek/search/joblist.json',
  jobDetailApi: '/wapi/zpgeek/job/detail.json',
  userInfoApi: '/wapi/zpuser/wap/getUserInfo.json',
  accountStatusApi: '/wapi/zpuser/h5/account/getStatus',
  vipInfoApi: '/wapi/zpitem/geek/vip/info',
  cityGroupApi: '/wapi/zpCommon/data/cityGroup.json',
  citySiteApi: '/wapi/zpgeek/common/data/city/site.json',
  filterConditionsApi: '/wapi/zpgeek/pc/all/filter/conditions.json',
  companyPage: '/gongsi',
  companyJobsPage: '/gongsi/job',
  jobPage: '/job_detail',
} as const;

export function searchPageUrl(baseUrl: string, keyword: string, cityCode: string): string {
  const u = new URL('/web/geek/jobs', baseUrl);
  u.searchParams.set('query', keyword);
  u.searchParams.set('city', cityCode);
  u.searchParams.set('industry', '');
  u.searchParams.set('position', '');
  return u.toString();
}

export function jobUrl(baseUrl: string, jobId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/job_detail/${encodeURIComponent(jobId)}.html`;
}

export function companyUrl(baseUrl: string, companyId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/gongsi/${encodeURIComponent(companyId)}.html`;
}

export function companyJobsUrl(baseUrl: string, companyId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/gongsi/job/${encodeURIComponent(companyId)}.html`;
}
