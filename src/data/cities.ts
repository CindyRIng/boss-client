/**
 * 内置常用城市（可被 BOSS 城市接口刷新覆盖）
 */
export interface CitySeed {
  cityCode: string;
  cityName: string;
  province?: string;
}

export const CITY_SEED: CitySeed[] = [
  { cityCode: '101010100', cityName: '北京', province: '北京' },
  { cityCode: '101020100', cityName: '上海', province: '上海' },
  { cityCode: '101280100', cityName: '广州', province: '广东' },
  { cityCode: '101280200', cityName: '深圳', province: '广东' },
  { cityCode: '101210100', cityName: '杭州', province: '浙江' },
  { cityCode: '101270100', cityName: '成都', province: '四川' },
  { cityCode: '101030100', cityName: '天津', province: '天津' },
  { cityCode: '101110100', cityName: '西安', province: '陕西' },
  { cityCode: '101190400', cityName: '苏州', province: '江苏' },
  { cityCode: '101200100', cityName: '武汉', province: '湖北' },
  { cityCode: '101230200', cityName: '厦门', province: '福建' },
  { cityCode: '101250100', cityName: '长沙', province: '湖南' },
  { cityCode: '101180100', cityName: '郑州', province: '河南' },
  { cityCode: '101040100', cityName: '重庆', province: '重庆' },
  { cityCode: '101090100', cityName: '石家庄', province: '河北' },
  { cityCode: '101190100', cityName: '南京', province: '江苏' },
  { cityCode: '101120200', cityName: '青岛', province: '山东' },
  { cityCode: '101120100', cityName: '济南', province: '山东' },
  { cityCode: '101070100', cityName: '沈阳', province: '辽宁' },
  { cityCode: '101070200', cityName: '大连', province: '辽宁' },
  { cityCode: '101050100', cityName: '哈尔滨', province: '黑龙江' },
  { cityCode: '101060100', cityName: '长春', province: '吉林' },
  { cityCode: '101230100', cityName: '福州', province: '福建' },
  { cityCode: '101240100', cityName: '南昌', province: '江西' },
  { cityCode: '101220100', cityName: '合肥', province: '安徽' },
  { cityCode: '101290100', cityName: '昆明', province: '云南' },
  { cityCode: '101260100', cityName: '贵阳', province: '贵州' },
  { cityCode: '101300100', cityName: '南宁', province: '广西' },
  { cityCode: '101310200', cityName: '海口', province: '海南' },
  { cityCode: '101100100', cityName: '太原', province: '山西' },
  { cityCode: '101080100', cityName: '呼和浩特', province: '内蒙古' },
  { cityCode: '101160100', cityName: '兰州', province: '甘肃' },
  { cityCode: '101150100', cityName: '西宁', province: '青海' },
  { cityCode: '101170100', cityName: '银川', province: '宁夏' },
  { cityCode: '101130100', cityName: '乌鲁木齐', province: '新疆' },
  { cityCode: '101210400', cityName: '宁波', province: '浙江' },
  { cityCode: '101190200', cityName: '无锡', province: '江苏' },
  { cityCode: '101280800', cityName: '佛山', province: '广东' },
  { cityCode: '101281600', cityName: '东莞', province: '广东' },
  { cityCode: '101280700', cityName: '珠海', province: '广东' },
  { cityCode: '101210700', cityName: '温州', province: '浙江' },
  { cityCode: '101230500', cityName: '泉州', province: '福建' },
  { cityCode: '101120500', cityName: '烟台', province: '山东' },
  { cityCode: '101090500', cityName: '唐山', province: '河北' },
  { cityCode: '101090200', cityName: '保定', province: '河北' },
  { cityCode: '101090600', cityName: '廊坊', province: '河北' },
  { cityCode: '101090900', cityName: '邢台', province: '河北' },
  { cityCode: '101091000', cityName: '邯郸', province: '河北' },
  { cityCode: '101090700', cityName: '沧州', province: '河北' },
  { cityCode: '101090800', cityName: '衡水', province: '河北' },
];

export function flattenCities(input: unknown): CitySeed[] {
  const out = new Map<string, CitySeed>();
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    const obj = v as Record<string, unknown>;
    const code = obj.code ?? obj.cityCode ?? obj.value;
    const name = obj.name ?? obj.cityName ?? obj.label;
    if ((typeof code === 'string' || typeof code === 'number') && typeof name === 'string' && /^\d{6,12}$/.test(String(code))) {
      out.set(String(code), { cityCode: String(code), cityName: name });
    }
    for (const child of Object.values(obj)) walk(child);
  };
  walk(input);
  return [...out.values()];
}
