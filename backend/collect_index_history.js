import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
#!/usr/bin/env node
/**
 * collect_index_history.js
 * 采集上证指数(sh000001)历史K线数据到stock_history表
 * 
 * 用法: node collect_index_history.js [--days 365]
 */

import Database from 'better-sqlite3';
import axios from 'axios';

const DB_PATH = path.join(PROJECT_ROOT, 'database', 'stocks.db');
const TX_KLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';

const args = process.argv.slice(2);
const getArg = (name, defaultVal) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? parseInt(args[idx + 1]) || defaultVal : defaultVal;
};
const MAX_DAYS = getArg('days', 365);

async function fetchIndexKlines(days) {
  // 上证指数: sh000001
  const txCode = 'sh000001';
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days - 10);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = new Date().toISOString().slice(0, 10);
  
  try {
    const url = `${TX_KLINE_URL}?param=${txCode},day,${startStr},${endStr},${days + 10},qfq`;
    const resp = await axios.get(url, { timeout: 15000 });
    
    const stockData = resp.data?.data?.[txCode];
    if (!stockData) {
      console.log('⚠️ API返回数据结构异常');
      console.log('resp.data keys:', Object.keys(resp.data || {}));
      return [];
    }
    
    // 指数数据可能不在qfqday，而是在day
    const klines = stockData.qfqday || stockData.day || [];
    
    console.log(`✅ 获取到 ${klines.length} 条K线数据`);
    
    return klines.map(k => ({
      date: k[0],
      open: parseFloat(k[1]) || 0,
      close: parseFloat(k[2]) || 0,
      high: parseFloat(k[3]) || 0,
      low: parseFloat(k[4]) || 0,
      volume: parseFloat(k[5]) || 0,
      amount: 0,
      change_percent: 0,
    })).filter(k => k.date && k.close > 0);
  } catch (e) {
    console.error('❌ 获取数据失败:', e.message);
    return [];
  }
}

async function main() {
  console.log(`📊 采集上证指数历史数据 (sh000001)`);
  console.log(`   采集范围: 最近 ${MAX_DAYS} 天`);
  
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  
  // 先检查现有数据
  const existing = db.prepare(`SELECT COUNT(*) as cnt FROM stock_history WHERE code='sh000001'`).get();
  console.log(`   现有记录: ${existing.cnt} 条`);
  
  if (existing.cnt > 0) {
    console.log('⚠️ 已有数据，跳过采集。如需更新请先删除旧数据：');
    console.log('   DELETE FROM stock_history WHERE code="sh000001";');
    db.close();
    return;
  }
  
  const klines = await fetchIndexKlines(MAX_DAYS);
  
  if (klines.length === 0) {
    console.log('❌ 未获取到任何数据');
    db.close();
    return;
  }
  
  // 计算涨跌幅
  for (let i = 1; i < klines.length; i++) {
    if (klines[i-1].close > 0) {
      klines[i].change_percent = ((klines[i].close - klines[i-1].close) / klines[i-1].close * 100);
    }
  }
  
  // 批量插入
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO stock_history (code, name, date, open, high, low, close, volume, amount, change_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertBatch = db.transaction((items) => {
    for (const item of items) {
      insertStmt.run(...item);
    }
  });
  
  const rows = klines.map(k => [
    'sh000001',
    '上证指数',
    k.date,
    k.open,
    k.high,
    k.low,
    k.close,
    k.volume,
    k.amount,
    k.change_percent
  ]);
  
  insertBatch(rows);
  
  console.log(`✅ 插入完成: ${rows.length} 条`);
  
  // 验证
  const after = db.prepare(`SELECT COUNT(*) as cnt, MIN(date) as min_date, MAX(date) as max_date FROM stock_history WHERE code='sh000001'`).get();
  console.log(`   数据范围: ${after.min_date} ~ ${after.max_date}`);
  
  // 显示最后5条
  const last5 = db.prepare(`SELECT date, close FROM stock_history WHERE code='sh000001' ORDER BY date DESC LIMIT 5`).all();
  console.log('   最近5天收盘价:');
  last5.forEach(r => console.log(`     ${r.date}: ${r.close.toFixed(2)}`));
  
  db.close();
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});