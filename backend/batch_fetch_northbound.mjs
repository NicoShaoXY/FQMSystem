#!/usr/bin/env node
/**
 * 北向持股数据采集脚本
 * 从东方财富网API采集沪股通+深股通持股数据
 * 数据存入 stock_northbound 表
 */

import sqlite3 from 'better-sqlite3';
import https from 'https';
import http from 'http';
import { URL } from 'url';

// 数据库路径（使用绝对路径）
const DB_PATH = process.env.PROJECT_ROOT 
  ? `${process.env.PROJECT_ROOT}/database/stocks.db`
  : '/Users/shao/Desktop/FQMSystem/database/stocks.db';

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
 * API文档：https://data.eastmoney.com/hsgt/gegu.html
 */
async function fetchNorthboundData(code, date) {
  // 东方财富北向持股API（沪股通+深股通）
  // 参数说明：
  //   - lbdq: 每页数量
  //   - page: 页码
  //   - sortField: 排序字段（HOLDRATIO=持股占比）
  //   - sortDirecion: 排序方向（0=升序，1=降序）
  //   - date: 日期（YYYY-MM-DD）
  
  const url = `https://data.eastmoney.com/DataCenter_V3/AjaxBasePage.aspx?type=hsgg&tablabel=hsgg&code=${code}&sortfield=HOLDRATIO&sortdirecion=DESC&page=1&pagesize=1&time=${date}`;
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.data && json.data.data && json.data.data.length > 0) {
            const item = json.data.data[0];
            resolve({
              code: code,
              date: date,
              hold_ratio: parseFloat(item.HOLDRATIO) || 0,
              hold_change: parseFloat(item.HOLDCHANGE) || 0,
              large_ratio: parseFloat(item.LARGERRATIO) || 0,
              hold_amount: parseFloat(item.HOLDAMOUNT) || 0
            });
          } else {
            resolve(null); // 无数据
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
  
  // 批量处理：每次20只股票
  const batchSize = 20;
  for (let i = 0; i < stocks.length; i += batchSize) {
    const batch = stocks.slice(i, i + batchSize);
    console.log(`[北向持股] 进度 ${i}/${stocks.length} (${(i/stocks.length*100).toFixed(1)}%)`);
    
    // 并发采集当前批次
    const promises = batch.map(stock => 
      fetchNorthboundData(stock.code, today)
        .then(data => ({ code: stock.code, data, success: true }))
        .catch(err => ({ code: stock.code, error: err.message, success: false }))
    );
    
    const results = await Promise.all(promises);
    
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
    
    const validRecords = results
      .filter(r => r.success && r.data)
      .map(r => r.data);
    
    if (validRecords.length > 0) {
      insertMany(validRecords);
      successCount += validRecords.length;
      console.log(`[北向持股] ✅ 批次插入 ${validRecords.length} 条`);
    }
    
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      failCount += failed.length;
      console.log(`[北向持股] ❌ 批次失败 ${failed.length} 条`);
    }
    
    // 延迟500ms避免限流
    await new Promise(resolve => setTimeout(resolve, 500));
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
