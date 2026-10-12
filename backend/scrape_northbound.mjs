#!/usr/bin/env node
/**
 * 北向持股数据网页抓取脚本
 * 使用Playwright抓取东方财富网数据
 * 数据存入 northbound_holdings 表
 */

import { chromium } from 'playwright';
import sqlite3 from 'better-sqlite3';
import { URL } from 'url';

// 数据库路径
const DB_PATH = process.env.PROJECT_ROOT 
  ? `${process.env.PROJECT_ROOT}/database/stocks.db`
  : '/Users/shao/Desktop/FQMSystem/database/stocks.db';

console.log('[网页抓取] 数据库路径:', DB_PATH);
console.log('[网页抓取] 开始抓取北向持股数据...');

const db = sqlite3(DB_PATH);

// 创建索引（如果不存在）
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_northbound_code ON northbound_holdings(code);
  CREATE INDEX IF NOT EXISTS idx_northbound_date ON northbound_holdings(date);
`);

/**
 * 抓取北向持股数据
 */
async function scrapeNorthboundData() {
  const browser = await chromium.launch({ 
    headless: true,
    channel: 'chrome', // 使用系统已安装的Chrome
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    console.log('[网页抓取] 正在访问东方财富网北向持股页面...');
    await page.goto('https://data.eastmoney.com/hsgtcg/list.html', { 
      waitUntil: 'domcontentloaded',
      timeout: 90000 
    });
    
    console.log('[网页抓取] 页面加载完成，等待数据加载...');
    await page.waitForTimeout(10000); // 等待10秒让数据加载
    
    // 等待表格加载
    try {
      await page.waitForSelector('.dataview-table tbody tr', { timeout: 30000 });
      console.log('[网页抓取] 表格已加载');
    } catch (err) {
      console.log('[网页抓取] ⚠️ 等待表格超时，尝试直接提取...');
    }
    
    // 尝试获取表格数据
    console.log('[网页抓取] 正在提取表格数据...');
    
    const data = await page.evaluate(() => {
      const results = [];
      
      // 尝试多种可能的表格选择器
      const selectors = [
        '.dataview-table tbody tr',
        '.dataview-body tr',
        'table.dataview tbody tr',
        '#dt_1 tbody tr',
        'table tbody tr'
      ];
      
      let rows = [];
      for (const selector of selectors) {
        rows = document.querySelectorAll(selector);
        if (rows.length > 0) {
          console.log(`找到表格数据，使用选择器: ${selector}, 行数: ${rows.length}`);
          break;
        }
      }
      
      if (rows.length === 0) {
        // 如果找不到表格，尝试获取页面所有文本
        return { error: '未找到表格数据', pageText: document.body.innerText.substring(0, 500) };
      }
      
      // 提取每行数据
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
          results.push({
            code: cells[0]?.innerText?.trim() || '',
            name: cells[1]?.innerText?.trim() || '',
            holdRatio: parseFloat(cells[2]?.innerText?.trim()) || 0,
            holdChange: parseFloat(cells[3]?.innerText?.trim()) || 0,
            holdAmount: parseFloat(cells[4]?.innerText?.trim()) || 0,
            marketValue: parseFloat(cells[5]?.innerText?.trim()) || 0
          });
        }
      });
      
      return { data: results };
    });
    
    if (data.error) {
      console.error('[网页抓取] ❌ 未找到表格数据');
      console.error('[网页抓取] 页面内容（前500字符）:', data.pageText);
      return [];
    }
    
    console.log(`[网页抓取] ✅ 成功提取 ${data.data.length} 条数据`);
    return data.data;
    
  } finally {
    await browser.close();
  }
}

/**
 * 保存数据到数据库
 */
function saveToDatabase(records) {
  if (!records || records.length === 0) {
    console.log('[网页抓取] 无数据可保存');
    return 0;
  }
  
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;
  
  const insert = db.prepare(`
    INSERT OR REPLACE INTO northbound_holdings 
    (code, date, hold_ratio, hold_amount, hold_market_value, change_amount)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((records) => {
    for (const record of records) {
      if (record && record.code) {
        // 这里需要根据实际表格结构调整字段映射
        insert.run(
          record.code,
          today,
          record.holdRatio || 0,
          0, // hold_amount - 需要确认字段
          record.marketValue || 0,
          record.holdChange || 0
        );
        successCount++;
      }
    }
  });
  
  insertMany(records);
  console.log(`[网页抓取] ✅ 成功插入 ${successCount} 条记录到数据库`);
  return successCount;
}

// 主函数
async function main() {
  try {
    console.log('[网页抓取] 开始执行...');
    
    const records = await scrapeNorthboundData();
    
    if (records.length > 0) {
      const count = saveToDatabase(records);
      console.log(`[网页抓取] ✅ 完成！共抓取 ${count} 条北向持股数据`);
    } else {
      console.log('[网页抓取] ⚠️ 未抓取到数据，请检查网页结构是否已变化');
    }
    
  } catch (err) {
    console.error('[网页抓取] ❌ 错误:', err.message);
    console.error('[网页抓取] 错误堆栈:', err.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
