import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
#!/usr/bin/env node
/**
 * batch_update_stock_history.js v3
 * 使用腾讯财经API批量采集缺失的K线数据
 * 
 * 数据源优先级：腾讯 web.ifzq.gtimg.cn（ISP不封锁）
 * 格式：[日期, 开, 收, 高, 低, 成交量]
 * 
 * 用法: node --stack-size=4096 batch_update_stock_history.js [--days 60] [--commit-every 100] [--delay 100]
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
const MAX_DAYS = getArg('days', 60);
const COMMIT_EVERY = getArg('commit-every', 100);
const DELAY = getArg('delay', 100);

// 股票代码 → 腾讯市场前缀
function getTxCode(code) {
  if (!code) return null;
  const num = code.replace(/^(sh|sz|SH|SZ)/, '');
  // 北交所跳过
  if (num.startsWith('4') || num.startsWith('8')) return null;
  if (num.startsWith('6') || num.startsWith('9')) return `sh${num}`;
  if (num.startsWith('0') || num.startsWith('2') || num.startsWith('3')) return `sz${num}`;
  return null;
}

async function fetchKlines(code, days) {
  const txCode = getTxCode(code);
  if (!txCode) return [];
  
  // 计算起始日期
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days - 10);  // 多取10天缓冲
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = new Date().toISOString().slice(0, 10);
  
  try {
    const url = `${TX_KLINE_URL}?param=${txCode},day,${startStr},${endStr},${days + 10},qfq`;
    const resp = await axios.get(url, { timeout: 10000 });
    
    const stockData = resp.data?.data?.[txCode];
    if (!stockData) return [];
    
    // 腾讯API返回 qfqday 或 day
    const klines = stockData.qfqday || stockData.day || [];
    
    return klines.map(k => ({
      date: k[0],
      open: parseFloat(k[1]) || 0,
      close: parseFloat(k[2]) || 0,
      high: parseFloat(k[3]) || 0,
      low: parseFloat(k[4]) || 0,
      volume: parseFloat(k[5]) || 0,
      amount: 0,  // 腾讯不提供成交额
      change_percent: 0,  // 后续计算
    })).filter(k => k.date && k.close > 0);
  } catch (e) {
    return [];
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`📊 批量更新 stock_history v3 (腾讯数据源)`);
  console.log(`   采集范围: 最近 ${MAX_DAYS} 天`);
  console.log(`   每批提交: ${COMMIT_EVERY} 只, 间隔: ${DELAY}ms`);
  
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  
  // 找出数据过时的股票
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 5);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);
  
  const staleCodes = db.prepare(`
    SELECT code, MAX(date) as latest_date 
    FROM stock_history 
    WHERE date LIKE '20%'
    GROUP BY code 
    HAVING latest_date < ?
  `).all(cutoffStr).map(r => r.code);
  
  console.log(`   需要更新的股票: ${staleCodes.length} 只（数据早于 ${cutoffStr}）`);
  
  if (staleCodes.length === 0) {
    console.log('✅ 所有股票数据已是最新！');
    db.close();
    return;
  }
  
  // INSERT OR IGNORE — 不覆盖已有记录
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO stock_history (code, name, date, open, high, low, close, volume, amount, change_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let totalInserted = 0;
  let totalFailed = 0;
  let buffer = [];
  
  const flushBuffer = db.transaction((items) => {
    let count = 0;
    for (const item of items) {
      insertStmt.run(...item);
      count++;
    }
    return count;
  });
  
  const startTime = Date.now();
  
  for (let i = 0; i < staleCodes.length; i++) {
    const code = staleCodes[i];
    const klines = await fetchKlines(code, MAX_DAYS);
    
    if (klines.length === 0) {
      totalFailed++;
    } else {
      // 计算涨跌幅（基于前一日收盘价）
      for (let j = 0; j < klines.length; j++) {
        const k = klines[j];
        let changePct = 0;
        if (j > 0 && klines[j-1].close > 0) {
          changePct = ((k.close - klines[j-1].close) / klines[j-1].close * 100);
        }
        buffer.push([code, '', k.date, k.open, k.high, k.low, k.close, k.volume, k.amount, changePct]);
      }
    }
    
    // 定期提交
    if (buffer.length > 0 && ((i + 1) % COMMIT_EVERY === 0 || i === staleCodes.length - 1)) {
      const inserted = flushBuffer(buffer);
      totalInserted += inserted;
      buffer = [];
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const pct = ((i + 1) / staleCodes.length * 100).toFixed(1);
      const rate = ((i + 1) / (Date.now() - startTime) * 1000).toFixed(1);
      console.log(`  [${pct}%] ${i+1}/${staleCodes.length} (${elapsed}s, ${rate}只/s) 插入${inserted}条, 累计${totalInserted}条, 失败${totalFailed}`);
    }
    
    await sleep(DELAY);
  }
  
  console.log(`\n✅ 完成!`);
  console.log(`   更新股票: ${staleCodes.length - totalFailed}/${staleCodes.length}`);
  console.log(`   插入记录: ${totalInserted} 条`);
  if (totalFailed > 0) console.log(`   失败股票: ${totalFailed} 只`);
  
  db.close();
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
