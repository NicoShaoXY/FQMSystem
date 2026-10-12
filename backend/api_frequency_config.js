// ─── API频率配置（根据官方推荐设置）────────────────────────────
// 该文件被 data_server.js 引用

const API_FREQ_CONFIG = {
  // 腾讯财经
  'qt.gtimg.cn': {
    name: '腾讯财经',
    interval: 3000,      // 3秒（官方建议≥3秒）
    maxBatch: 100,       // 每次最多100只
    timeout: 8000,
    delay: 0            // 无额外延迟
  },
  // 东方财富（实时）
  'push2.eastmoney.com': {
    name: '东方财富(实时)',
    interval: 5000,      // 5秒（官方建议≥5秒）
    maxBatch: 20,        // 每次最多20只
    timeout: 10000,
    delay: 0
  },
  // 东方财富（延迟）
  'push2delay.eastmoney.com': {
    name: '东方财富(延迟)',
    interval: 3000,      // 3秒（已有1-3秒延迟）
    maxBatch: 20,
    timeout: 10000,
    delay: 2000          // 额外延迟2秒
  },
  // 新浪财经
  'hq.sinajs.cn': {
    name: '新浪财经',
    interval: 5000,      // 5秒（官方建议≥5秒）
    maxBatch: 150,       // 每次最多150只
    timeout: 8000,
    delay: 0
  }
};

// 判断当前是否为交易时段（峰值时段）
function isPeakHour() {
  const now = new Date();
  const bjTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = bjTime.getUTCDay();
  
  // 周末（周日是0，周六是6）
  if (day === 0 || day === 6) return false;
  
  const hour = bjTime.getUTCHours();
  const minute = bjTime.getUTCMinutes();
  const time = hour * 100 + minute;
  
  // 交易时段：9:30-11:30, 13:00-15:00
  return (time >= 930 && time <= 1130) || (time >= 1300 && time <= 1500);
}

// 获取API域名对应的推荐频率
function getApiInterval(apiUrl, isPeak = null) {
  if (isPeak === null) isPeak = isPeakHour();
  
  let domain = '';
  try {
    domain = new URL(apiUrl).hostname;
  } catch (e) {
    // 如果不是完整URL，尝试提取域名
    const match = apiUrl.match(/https?:\/\/([^\/]+)/);
    if (match) domain = match[1];
  }
  
  const config = API_FREQ_CONFIG[domain];
  if (config) {
    console.log(`[API频率] ${config.name}: ${config.interval}ms (交易时段)`);
    return isPeak ? config.interval : 60000;  // 非交易时段1分钟
  }
  
  // 默认 fallback
  console.log('[API频率] 未知API，使用默认5秒');
  return isPeak ? 5000 : 60000;
}

// 根据API配置拆分批次
function splitBatchByApi(codes, apiUrl) {
  let domain = '';
  try {
    domain = new URL(apiUrl).hostname;
  } catch (e) {
    const match = apiUrl.match(/https?:\/\/([^\/]+)/);
    if (match) domain = match[1];
  }
  
  const config = API_FREQ_CONFIG[domain];
  const maxBatch = config ? config.maxBatch : 20;
  
  const batches = [];
  for (let i = 0; i < codes.length; i += maxBatch) {
    batches.push(codes.slice(i, i + maxBatch));
  }
  return batches;
}

export { API_FREQ_CONFIG, getApiInterval, splitBatchByApi };
