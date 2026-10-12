#!/usr/bin/env node
/**
 * main_flow_history_sync.js
 * 独立脚本：全量同步主力资金历史数据
 * 
 * 策略：
 * 1. 找出stock_main_flow中缺失的股票
 * 2. 分批采集，每批200只
 * 3. 交易时段用push2his(30天历史)，非交易时段用push2delay(今日+5日)
 * 4. 完成后退出，后端定时器日常维护
 * 
 * Usage: node main_flow_history_sync.js [--batch-size 200] [--delay 150]
 */

import { fileURLToPath } from 'url';
import path from 'path';
import Database from 'better-sqlite3';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'database', 'stocks.db');
const db = new Database(DB_PATH);

const args = process.argv.slice(2);
const BATCH_SIZE = args.includes('--batch-size') ? parseInt(args[args.indexOf('--batch-size') + 1]) || 200 : 200;
const DELAY = args.includes('--delay') ? parseInt(args[args.indexOf('--delay') + 1]) || 150 : 150;
const TOTAL_TARGET = 5437;

console.log(`[主力资金全量同步] 目标: ${TOTAL_TARGET} 只, 批量: ${BATCH_SIZE}, 延迟: ${DELAY}ms`);

// 北京时间判断
function isTradingHours() {
  const now = new Date();
  const bjH = (now.getUTCHours() + 8) % 24;
  const bjM = now.getUTCMinutes();
  const day = now.getUTCDay(); // 0=Sun
  if (day === 0 || day === 6) return false;
  const mins = bjH * 60 + bjM;
  return (mins >= 540 && mins <= 690) || (mins >= 780 && mins <= 900); // 9:00-11:30, 13:00-15:00
}

function bjISO() {
  const d = new Date(Date.now() + 8 * 3600000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// ── push2delay 实时API (全天可用, 今日+5日) ──
async function fetchRealtime(code) {
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  try {
    const resp = await axios.get(`https://push2delay.eastmoney.com/api/qt/stock/get`, {
      params: {
        secid,
        fields: 'f57,f58,f43,f169,f170,f171,f174,f175,f178,f184',
        ut: 'bd1d9ddb04089700cf9c27f6f7426281'
      },
      timeout: 10000,
      headers: { 'Referer': 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' }
    });

    if (!resp.data?.data) return 0;
    const d = resp.data.data;
    const rows = [];
    const today = bjISO().slice(0, 10);

    if (d.f169 !== undefined && d.f169 !== null) {
      rows.push({
        code, date: today,
        main_inflow: d.f169 * 10000,
        main_ratio: d.f170 / 10,
        super_inflow: (d.f174 || 0) * 10000,
        retail_inflow: (d.f175 || 0) * 10000,
        price: (d.f43 || 0) / 100,
        change_percent: 0
      });
    }

    if (d.f178) {
      try {
        const hist = JSON.parse(d.f178);
        for (const h of hist) {
          if (h.date && h.mainNetAmt !== undefined) {
            rows.push({
              code, date: h.date,
              main_inflow: h.mainNetAmt,
              main_ratio: 0, super_inflow: 0, retail_inflow: 0,
              price: 0, change_percent: 0
            });
          }
        }
      } catch (e) { /* ignore */ }
    }

    if (rows.length > 0) {
      const stmt = db.prepare(`INSERT OR REPLACE INTO stock_main_flow
        (code, date, main_inflow, super_inflow, retail_inflow, main_ratio, price, change_percent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertMany = db.transaction((items) => {
        for (const item of items) stmt.run(item.code, item.date, item.main_inflow, item.super_inflow, item.retail_inflow, item.main_ratio, item.price, item.change_percent);
      });
      insertMany(rows);
      return rows.length;
    }
    return 0;
  } catch (e) {
    return -1;
  }
}

// ── push2his 历史K线API (交易时段, 30天) ──
async function fetchHistory(code) {
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  try {
    const resp = await axios.get('https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get', {
      params: {
        lmt: 30, klt: 101, secid,
        fields1: 'f1,f2,f3,f7',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63'
      },
      timeout: 10000,
      headers: { 'Referer': 'https://data.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' }
    });
    const klines = resp.data?.data?.klines;
    if (!klines || !klines.length) return 0;

    const stmt = db.prepare(`INSERT OR REPLACE INTO stock_main_flow
      (code, date, main_inflow, super_inflow, retail_inflow, main_ratio, price, change_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertMany = db.transaction((items) => {
      for (const item of items) stmt.run(item.code, item.date, item.main_inflow, item.super_inflow, item.retail_inflow, item.main_ratio, item.price, item.change_percent);
    });
    const rows = klines.map(line => {
      const p = line.split(',');
      return {
        code, date: p[0],
        main_inflow: parseFloat(p[1]) || 0,
        super_inflow: parseFloat(p[2]) || 0,
        retail_inflow: parseFloat(p[3]) || 0,
        main_ratio: parseFloat(p[6]) || 0,
        price: parseFloat(p[11]) || 0,
        change_percent: parseFloat(p[12]) || 0
      };
    });
    insertMany(rows);
    return rows.length;
  } catch (e) {
    return -1;
  }
}

// ── 主流程 ──
async function main() {
  const allCodes = db.prepare(`
    SELECT code FROM stocks
    WHERE code GLOB '6*' OR code GLOB '0*' OR code GLOB '3*' OR code GLOB '68*'
  `).all().map(r => r.code);

  const existingCodes = new Set(db.prepare('SELECT DISTINCT code FROM stock_main_flow').all().map(r => r.code));
  const missingCodes = allCodes.filter(c => !existingCodes.has(c));

  console.log(`全市场: ${allCodes.length} 只, 已覆盖: ${existingCodes.size}, 缺失: ${missingCodes.length}`);
  console.log(`交易时段: ${isTradingHours() ? '是(用push2his 30天历史)' : '否(用push2delay 今日+5日)'}`);

  if (missingCodes.length === 0) {
    console.log('✅ 主力资金数据已完整,无需采集');
    db.close();
    return;
  }

  const startTime = Date.now();
  let totalOk = 0, totalFail = 0;

  for (let i = 0; i < missingCodes.length; i += BATCH_SIZE) {
    const batch = missingCodes.slice(i, i + BATCH_SIZE);
    let ok = 0, fail = 0;

    for (const code of batch) {
      let count;
      if (isTradingHours()) {
        // 交易时段: 先试历史API,失败回退实时
        count = await fetchHistory(code);
        if (count <= 0) count = await fetchRealtime(code);
      } else {
        // 非交易时段: 用实时API
        count = await fetchRealtime(code);
      }

      if (count > 0) ok++;
      else fail++;
      await new Promise(r => setTimeout(r, DELAY));
    }

    totalOk += ok;
    totalFail += fail;

    const newCovered = db.prepare('SELECT COUNT(DISTINCT code) as cnt FROM stock_main_flow').get()?.cnt || 0;
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`批次 ${Math.floor(i / BATCH_SIZE) + 1}: 成功${ok}/失败${fail} | 总: ${totalOk}/${totalFail} | 覆盖: ${newCovered}/${TOTAL_TARGET} | 耗时: ${elapsed}min`);

    // 批次间休息2秒
    if (i + BATCH_SIZE < missingCodes.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const finalCovered = db.prepare('SELECT COUNT(DISTINCT code) as cnt FROM stock_main_flow').get()?.cnt || 0;
  const totalMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n🏁 全量同步完成! 覆盖: ${finalCovered}/${TOTAL_TARGET}, 成功: ${totalOk}, 失败: ${totalFail}, 耗时: ${totalMin}min`);

  db.close();
}

main().catch(e => { console.error('❌ 致命错误:', e); db.close(); process.exit(1); });
