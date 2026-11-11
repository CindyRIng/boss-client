import { describe, it, expect } from 'vitest';
import { parseSalary, mapJobSummary, mapCompanySummary, mapCompanyDetail } from '../src/adapters/boss/mapper.js';

const rawJob = {
  encryptJobId: '9b480e5d72caccd303Zz3du6FFFS',
  securityId: 'sec_123',
  lid: 'lid.search.1',
  jobName: '外贸业务专员',
  salaryDesc: '4-8K',
  jobExperience: '在校/应届',
  jobDegree: '大专',
  city: 101090100,
  cityName: '石家庄',
  areaDistrict: '裕华区',
  businessDistrict: '谈固',
  encryptBrandId: 'd6c15290231e61e21Hd70965EFY~',
  brandName: '河北省钧益润科技',
  brandIndustry: '进出口贸易',
  brandScaleName: '20-99人',
  brandStageName: '不需要融资',
  bossName: '刘岐',
  bossTitle: '业务主管',
  bossOnline: true,
  skills: ['出口'],
  welfareList: ['双休'],
};

describe('mapper', () => {
  it('parses salary ranges', () => {
    expect(parseSalary('4-8K')).toEqual({ min: 4, max: 8 });
    expect(parseSalary('120-150元/天')).toEqual({});
    expect(parseSalary('')).toEqual({});
  });

  it('maps job summary', () => {
    const job = mapJobSummary(rawJob as never, 'https://www.zhipin.com');
    expect(job.jobId).toBe(rawJob.encryptJobId);
    expect(job.companyId).toBe(rawJob.encryptBrandId);
    expect(job.salaryMin).toBe(4);
    expect(job.cityCode).toBe('101090100');
    expect(job.jobUrl).toContain('/job_detail/');
  });

  it('dedupes companies from jobs', () => {
    const a = mapJobSummary(rawJob as never, 'https://www.zhipin.com');
    const b = { ...a, jobId: 'otherjob12345678', title: '外贸经理' };
    const company = mapCompanySummary([a, b], a.companyId);
    expect(company.jobCount).toBe(2);
    expect(company.matchedJobs).toHaveLength(2);
  });

  it('maps company detail business fields', () => {
    const detail = mapCompanyDetail(
      {
        name: '河北省钧益润科技',
        business: {
          企业名称: '河北省钧益润科技有限公司',
          统一社会信用代码: '91130108MA0G1TYC06',
          注册资本: '600万人民币',
          经营范围: '货物进出口',
        },
        jobCount: 11,
      },
      'd6c15290231e61e21Hd70965EFY~',
      'https://www.zhipin.com',
    );
    expect(detail.business.uscc).toBe('91130108MA0G1TYC06');
    expect(detail.business.textDerived).toBe(true);
    expect(detail.jobCount).toBe(11);
  });
});
