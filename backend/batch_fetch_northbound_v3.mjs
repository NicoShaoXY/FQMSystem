#!/usr/bin/env node
/**
 * 北向持股数据采集脚本 V3
 * 从东方财富网API采集沪股通+深股通持股数据
 * 数据存入 northbound_holdings 表（已存在）
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
  CREATE INDEX IF NOT EXISTS idx_northbound_code ON northbound_holdings(code);
  CREATE INDEX IF NOT EXISTS idx_northbound_date ON northbound_holdings(date);
`);

/**
 * 获取需要采集的股票列表
 */
function getStockList() {
  const sql = `
    SELECT code FROM stocks 
    WHERE code NOT IN (
      SELECT DISTINCT code FROM northbound_holdings WHERE date >= date('now', '-7 days')
    )
    LIMIT 5000
  `;
  return db.prepare(sql).all();
}

/**
 * 获取北向持股数据（东方财富API）
 * API文档：https://data.eastmoney.com/hsgt/gegu.html
 */
async function fetchNorthboundData(date) {
  // 东方财富北向持股API（获取所有股票数据）
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
              hold_amount: parseFloat(item.HOLD_AMOUNT) || 0,
              hold_market_value: parseFloat(item.HOLD_MARKET_VALUE) || 0,
              change_amount: parseFloat(item.CHANGE_AMOUNT) || 0
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
        INSERT OR REPLACE INTO northbound_holdings 
        (code, date, hold_ratio, hold_amount, hold_market_value, change_amount)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = db.transaction((records) => {
        for (const record of records) {
          if (record && record.code) {
            insert.run(
              record.code,
              record.date,
              record.hold_ratio,
              record.hold_amount,
              record.hold_market_value,
              record.change_amount
            );
          }
        }
      });
      
      insertMany(records);
      successCount = records.length;
      console.log(`[北向持股] ✅ 成功插入 ${successCount} 条记录`);
    } else {
      console.log(`[北向持股] ⚠️ 未获取到数据，可能需要更换API端点`);
      console.log(`[北向持股] 尝试使用备用API...`);
      
      // 备用方案：使用东方财富数据中心API
      const backupUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_FUND_HOLD_DETAIL&columns=ALL&filter=&pageNumber=1&pageSize=5000&sortTypes=-1&sortColumns=HOLD_RATIO`;
      
      const backupData = await new Promise((resolve, reject) => {
        https.get(backupUrl, (res) => {
          let d = '';
          res.on('data', (chunk) => { d += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(d);
              if (json.result && json.result.data && Array.isArray(json.result.data)) {
                const records = json.result.data.map(item => ({
                  code: item.SCODE,
                  date: today,
                  hold_ratio: parseFloat(item.HOLD_RATIO) || 0,
                  hold_amount: parseFloat(item.HOLD_AMOUNT) || 0,
                  hold_market_value: parseFloat(item.HOLD_MARKET_VALUE) || 0,
                  change_amount: parseFloat(item.CHANGE_AMOUNT) || 0
                }));
                resolve(records);
              } else {
                resolve([]);
              }
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', reject);
      });
      
      if (backupData && backupData.length > 0) {
        console.log(`[北向持股] ✅ 备用API获取到 ${backupData.length} 条记录`);
        
        const insert = db.prepare(`
          INSERT OR REPLACE INTO northbound_holdings 
          (code, date, hold_ratio, hold_amount, hold_market_value, change_amount)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const insertMany = db.transaction((records) => {
          for (const record of records) {
            if (record && record.code) {
              insert.run(
                record.code,
                record.date,
                record.hold_ratio,
                record.hold_amount,
                record.hold_market_value,
                record.change_amount
              );
            }
          }
        });
        
        insertMany(backupData);
        successCount = backupData.length;
        console.log(`[北向持股] ✅ 备用API成功插入 ${successCount} 条记录`);
      } else {
        console.log(`[北向持股] ❌ 备用API也未获取到数据`);
        failCount++;
      }
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
