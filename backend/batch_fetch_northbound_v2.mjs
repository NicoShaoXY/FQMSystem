#!/usr/bin/env node
/**
 * 北向持股数据采集脚本 V2
 * 从东方财富网API采集沪股通+深股通持股数据
 * 数据存入 stock_northbound 表
 */

import sqlite3 from 'better-sqlite3';
import https from 'https';
import http from 'http';

// 数据库路径（使用绝对路径）
const PROJECT_ROOT = process.env.PROJECT_ROOT || '/Users/shao/Desktop/FQMSystem';
const DB_PATH = `${PROJECT_ROOT}/database/stocks.db`;

console.log(`[北向持股] 数据库路径: ${DB_PATH}`);

const db = sqlite3(DB_PATH);

// 创建索引（如果不存在）
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_northbound_code ON stock_northbound(code);
  CREATE INDEX IF NOT EXISTS idx_northbound_date ON stock_northbound(date);
`);

/**
 * 获取需要采集的股票列表
 */
function getStockList() {
  const sql = `
    SELECT code FROM stock_basic 
    WHERE code NOT IN (
      SELECT DISTINCT code FROM stock_northbound WHERE date >= date('now', '-7 days')
    )
    LIMIT 5000
  `;
  return db.prepare(sql).all();
}

/**
 * 获取北向持股数据（东方财富API）
 * 使用北向资金流向API（更可靠）
 */
async function fetchNorthboundData(date) {
  // 东方财富北向资金流向API
  // 返回沪深港通持股数据
  const url = `https://push2.eastmoney.com/api/qt/stock/smartmoney/northbound.html?cb=&pageSize=5000&pageIndex=0&sortType=DESC&sortColumn=HOLD_RATIO&startTime=${date}&endTime=${date}`;
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          // 去除JSONP回调（如果有）
          let jsonStr = data;
          if (data.startsWith('cb(') || data.startsWith('jQuery')) {
            const start = data.indexOf('(');
            const end = data.lastIndexOf(')');
            jsonStr = data.substring(start + 1, end);
          }
          
          const json = JSON.parse(jsonStr);
          
          // 检查数据结构
          if (json.data && json.data.data && Array.isArray(json.data.data)) {
            const records = json.data.data.map(item => ({
              code: item.SCODE || item.code,
              date: date,
              hold_ratio: parseFloat(item.HOLD_RATIO) || 0,
              hold_change: parseFloat(item.HOLD_CHANGE) || 0,
              large_ratio: parseFloat(item.LARGE_RATIO) || 0,
              hold_amount: parseFloat(item.HOLD_AMOUNT) || 0
            }));
            resolve(records);
          } else {
            resolve([]); // 无数据
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * 批量采集北向持股数据
 */
async function batchFetchNorthbound() {
  const stocks = getStockList();
  console.log(`[北向持股] 需要采集 ${stocks.length} 只股票`);
  
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;
  let failCount = 0;
  
  try {
    // 获取北向持股数据（一次性获取所有股票）
    console.log(`[北向持股] 正在获取 ${today} 的北向持股数据...`);
    const records = await fetchNorthboundData(today);
    
    if (records && records.length > 0) {
      console.log(`[北向持股] ✅ 获取到 ${records.length} 条记录`);
      
      // 插入数据库
      const insert = db.prepare(`
        INSERT OR REPLACE INTO stock_northbound 
        (code, date, hold_ratio, hold_change, large_ratio, hold_amount)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((records) => {
        for (const record of records) {
          if (record && record.code) {
            insert.run(
              record.code,
              record.date,
              record.hold_ratio,
              record.hold_change,
              record.large_ratio,
              record.hold_amount
            );
          }
        }
      });
      
      insertMany(records);
      successCount = records.length;
      console.log(`[北向持股] ✅ 成功插入 ${successCount} 条记录`);
    } else {
      console.log(`[北向持股] ⚠️ 未获取到数据，可能需要更换API端点`);
    }
  } catch (err) {
    console.error(`[北向持股] ❌ 采集失败: ${err.message}`);
    failCount++;
  }
  
  console.log(`[北向持股] ✅ 采集完成！成功=${successCount}，失败=${failCount}`);
}

// 主函数
async function main() {
  try {
    await batchFetchNorthbound();
  } catch (err) {
    console.error('[北向持股] ❌ 错误:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
