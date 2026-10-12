#!/usr/bin/env node
/**
 * 融资融券数据网页抓取脚本
 * 使用Playwright抓取东方财富网融资融券数据
 * 数据存入 margin_data 表
 */

import { chromium } from 'playwright';
import sqlite3 from 'better-sqlite3';
import { URL } from 'url';

// 数据库路径
const DB_PATH = process.env.PROJECT_ROOT 
  ? `${process.env.PROJECT_ROOT}/database/stocks.db`
  : '/Users/shao/Desktop/FQMSystem/database/stocks.db';

console.log('[融资融券] 数据库路径:', DB_PATH);
console.log('[融资融券] 开始抓取融资融券数据...');

const db = sqlite3(DB_PATH);

// 创建索引（如果不存在）
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_margin_code ON margin_data(code);
  CREATE INDEX IF NOT EXISTS idx_margin_date ON margin_data(date);
`);

/**
 * 抓取融资融券数据
 */
async function scrapeMarginData() {
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
    
    console.log('[融资融券] 正在访问东方财富网融资融券页面...');
    await page.goto('https://data.eastmoney.com/rzrq/', { 
      waitUntil: 'domcontentloaded',
      timeout: 90000 
    });
    
    console.log('[融资融券] 页面加载完成，等待数据加载...');
    await page.waitForTimeout(5000); // 等待5秒让数据加载
    
    // 尝试获取表格数据
    console.log('[融资融券] 正在提取表格数据...');
    
    const data = await page.evaluate(() => {
      const results = [];
      
      // 尝试多种可能的表格选择器
      const selectors = [
        'table.table tbody tr',
        'table tbody tr',
        '.list-table tbody tr',
        '#table_wrapper-table tbody tr'
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
        if (cells.length >= 8) {
          // 融资融券数据通常包含：代码、名称、融资买入、融资偿还、融资余额、融券卖出、融券偿还、融券余额
          results.push({
            code: cells[0]?.innerText?.trim() || '',
            name: cells[1]?.innerText?.trim() || '',
            marginBuy: parseFloat(cells[2]?.innerText?.trim()?.replace(/,/g, '')) || 0,
            marginSell: parseFloat(cells[3]?.innerText?.trim()?.replace(/,/g, '')) || 0,
            marginBalance: parseFloat(cells[4]?.innerText?.trim()?.replace(/,/g, '')) || 0,
            shortSell: parseFloat(cells[5]?.innerText?.trim()?.replace(/,/g, '')) || 0,
            shortCover: parseFloat(cells[6]?.innerText?.trim()?.replace(/,/g, '')) || 0,
            shortBalance: parseFloat(cells[7]?.innerText?.trim()?.replace(/,/g, '')) || 0
          });
        }
      });
      
      return { data: results };
    });
    
    if (data.error) {
      console.error('[融资融券] ❌ 未找到表格数据');
      console.error('[融资融券] 页面内容（前500字符）:', data.pageText);
      return [];
    }
    
    console.log(`[融资融券] ✅ 成功提取 ${data.data.length} 条数据`);
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
    console.log('[融资融券] 无数据可保存');
    return 0;
  }
  
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;
  
  const insert = db.prepare(`
    INSERT OR REPLACE INTO margin_data 
    (code, date, margin_buy, margin_sell, margin_balance, short_sell_volume, short_cover_volume, short_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((records) => {
    for (const record of records) {
      if (record && record.code) {
        insert.run(
          record.code,
          today,
          record.marginBuy || 0,
          record.marginSell || 0,
          record.marginBalance || 0,
          record.shortSell || 0,
          record.shortCover || 0,
          record.shortBalance || 0
        );
        successCount++;
      }
    }
  });
  
  insertMany(records);
  console.log(`[融资融券] ✅ 成功插入 ${successCount} 条记录到数据库`);
  return successCount;
}

// 主函数
async function main() {
  try {
    console.log('[融资融券] 开始执行...');
    
    const records = await scrapeMarginData();
    
    if (records.length > 0) {
      const count = saveToDatabase(records);
      console.log(`[融资融券] ✅ 完成！共抓取 ${count} 条融资融券数据`);
    } else {
      console.log('[融资融券] ⚠️ 未抓取到数据，请检查网页结构是否已变化');
    }
    
  } catch (err) {
    console.error('[融资融券] ❌ 错误:', err.message);
    console.error('[融资融券] 错误堆栈:', err.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
