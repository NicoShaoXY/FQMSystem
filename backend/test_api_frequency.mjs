// 测试动态API频率功能
import { API_FREQ_CONFIG, getApiInterval, splitBatchByApi } from './api_frequency_config.js';

console.log('🧪 测试动态API频率功能\n');

// 测试1: 获取各API的频率配置
console.log('📊 API频率配置:');
for (const [domain, config] of Object.entries(API_FREQ_CONFIG)) {
  console.log(`  ${config.name} (${domain}):`);
  console.log(`    推荐间隔: ${config.interval}ms`);
  console.log(`    最大批次: ${config.maxBatch}只`);
  console.log(`    Timeout: ${config.timeout}ms`);
  console.log(`    延迟: ${config.delay}ms`);
  console.log('');
}

// 测试2: 测试getApiInterval函数
console.log('⏱️ 测试getApiInterval():');
const testApis = [
  'https://qt.gtimg.cn/q=',
  'https://push2.eastmoney.com/api/qt/clist/get',
  'https://push2delay.eastmoney.com/api/qt/clist/get',
  'https://hq.sinajs.cn/list=',
  'https://unknown.api.com/test'
];

for (const apiUrl of testApis) {
  const interval = getApiInterval(apiUrl, true); // 假设交易时段
  console.log(`  ${apiUrl} → ${interval}ms`);
}
console.log('');

// 测试3: 测试splitBatchByApi函数
console.log('📦 测试splitBatchByApi():');
const testCodes = Array.from({length: 250}, (_, i) => String(600000 + i)); // 250只股票

for (const [domain, config] of Object.entries(API_FREQ_CONFIG)) {
  const batches = splitBatchByApi(testCodes, `https://${domain}/test`);
  console.log(`  ${config.name}: ${testCodes.length}只 → ${batches.length}批 (每批${config.maxBatch}只)`);
}
console.log('');

// 测试4: 模拟交易/非交易时段
console.log('🌓 测试交易/非交易时段:');
const testUrl = 'https://qt.gtimg.cn/q=';

// 模拟交易时段
let isPeakHour = () => true;
console.log(`  交易时段: ${getApiInterval(testUrl, true)}ms`);

// 模拟非交易时段
isPeakHour = () => false;
console.log(`  非交易时段: ${getApiInterval(testUrl, false)}ms`);
console.log('');

console.log('✅ 测试完成！');
