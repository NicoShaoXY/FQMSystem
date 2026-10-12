#!/usr/bin/env node
/**
 * 批量补充 stock_history 历史K线数据
 * 用于估算主力资金占比
 */
import axios from 'axios';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = '/Users/shao/Desktop/FQMSystem/database/stocks.db';
const db = new Database(DB_PATH);

// 获取需要补充的股票代码
const needUpdateCodes = db.prepare(`
  SELECT DISTINCT code FROM stock_main_flow 
  WHERE code NOT IN (SELECT DISTINCT code FROM stock_history WHERE date >= '2026-04-28')
`).all().map(r => r.code);

console.log(`需要补充历史数据的股票: ${needUpdateCodes.length} 只`);

// 批量获取历史K线（每次20只，避免触发限流）
const BATCH_SIZE = 20;
const DELAY_MS = 500;
let totalInserted = 0;
let failedCount = 0;

async function fetchKline(code) {
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  try {
    const resp = await axios.get('https://push2his.eastmoney.com/api/qt/stock/kline/get', {
      params: {
        secid,
        fields1: 'f1,f2,f3,f4,f5,f6',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63',
        klt: 101,  // 日线
        fqt: 1,    // 前复权
        end: '20500101',
        lmt: 30    // 最近30天
      },
      timeout: 5000,
      headers: {
        'Referer': 'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    
    if (!resp.data?.data?.klines) return [];
    
    return resp.data.data.klines.map(line => {
      const p = line.split(',');
      return {
        code,
        date: p[0],
        open: parseFloat(p[1]),
        close: parseFloat(p[2]),
        high: parseFloat(p[3]),
        low: parseFloat(p[4]),
        volume: parseFloat(p[5]),
        amount: parseFloat(p[6]),
        change_percent: parseFloat(p[7])
      };
    });
  } catch (e) {
    return [];
  }
}

async function main() {
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO stock_history 
    (code, name, date, open, high, low, close, volume, amount, change_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insertStmt.run(item.code, '', item.date, item.open, item.high, item.low, item.close, item.volume, item.amount, item.change_percent);
    }
  });
  
  for (let i = 0; i < needUpdateCodes.length; i += BATCH_SIZE) {
    const batch = needUpdateCodes.slice(i, i + BATCH_SIZE);
    
    for (const code of batch) {
      const klines = await fetchKline(code);
      if (klines.length > 0) {
        insertMany(klines);
        totalInserted += klines.length;
      } else {
        failedCount++;
      }
    }
    
    console.log(`进度: ${i + batch.length}/${needUpdateCodes.length}, 已插入: ${totalInserted}, 失败: ${failedCount}`);
    
    // 延迟避免限流
    if (i + BATCH_SIZE < needUpdateCodes.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  
  console.log(`\n✅ 完成! 总插入: ${totalInserted} 条, 失败: ${failedCount} 只`);
  db.close();
}

main().catch(e => {
  console.error('脚本失败:', e);
  process.exit(1);
});
