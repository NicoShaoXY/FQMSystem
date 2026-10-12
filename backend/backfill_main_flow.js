#!/usr/bin/env node
/**
 * stock_main_flow 全量补采脚本
 * 在 backend/ 目录下运行，复用已安装的 axios 和 better-sqlite3
 */

const path = require('path');
const axios = require('axios');
const sqlite3 = require('better-sqlite3');

// 数据库路径（相对于 backend/）
const DB_PATH = path.join(__dirname, '..', 'database', 'stocks.db');
const LOG_PATH = path.join(__dirname, '..', 'logs', 'backfill_main_flow.log');

const db = sqlite3(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 30000');

function log(msg) {
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  require('fs').appendFileSync(LOG_PATH, line + '\n');
}

// 获取所有A股代码
function getAllStockCodes() {
  return db.prepare(`SELECT code FROM stocks ORDER BY code`).all().map(r => r.code);
}

// 获取某只股票已有最新日期
function getLatestDate(code) {
  const row = db.prepare(`SELECT MAX(date) as d FROM stock_main_flow WHERE code = ?`).get(code);
  return row?.d || null;
}

// 调用东方财富 API 获取主力资金
async function fetchMainFlowFromAPI(code) {
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    // push2delay 实时资金流
    const resp = await axios.get('https://push2delay.eastmoney.com/api/qt/stock/get', {
      params: {
        secid,
        fields: 'f57,f58,f43,f169,f170,f171,f174,f175,f178,f184',
        ut: 'bd1d9ddb04089700cf9c27f6f7426281'
      },
      timeout: 10000,
      headers: {
        'Referer': 'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const rows = [];
    const d = resp.data?.data;
    if (d?.f169 !== undefined && d.f169 !== null) {
      rows.push({
        code,
        date: today,
        main_inflow: d.f169 * 10000,
        super_inflow: (d.f174 || 0) * 10000,
        retail_inflow: (d.f175 || 0) * 10000,
        main_ratio: d.f170 / 10,
        price: (d.f43 || 0) / 100,
        change_percent: 0,
        volume: 0,
        amount: 0,
        update_time: new Date().toISOString()
      });
    }

    // f178: 近5日主力净流入历史
    if (d?.f178) {
      try {
        const hist = JSON.parse(d.f178);
        for (const h of hist) {
          if (h.date && h.mainNetAmt !== undefined) {
            rows.push({
              code,
              date: h.date,
              main_inflow: h.mainNetAmt,
              super_inflow: 0,
              retail_inflow: 0,
              main_ratio: 0,
              price: 0,
              change_percent: 0,
              volume: 0,
              amount: 0,
              update_time: new Date().toISOString()
            });
          }
        }
      } catch (e) { /* ignore */ }
    }

    return rows;
  } catch (e) {
    log(`  ❌ ${code} API失败: ${e.message}`);
    return [];
  }
}

// 写入数据库
function saveToDB(rows) {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(`INSERT OR REPLACE INTO stock_main_flow
    (code, date, main_inflow, super_inflow, retail_inflow, main_ratio, price, change_percent, volume, amount, update_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = db.transaction((items) => {
    let n = 0;
    for (const r of items) {
      try {
        stmt.run(r.code, r.date, r.main_inflow, r.super_inflow, r.retail_inflow,
                 r.main_ratio, r.price, r.change_percent, r.volume, r.amount, r.update_time);
        n++;
      } catch (e) { /* 忽略 UNIQUE 冲突 */ }
    }
    return n;
  });
  return tx(rows);
}

// 主函数
async function main() {
  const allCodes = getAllStockCodes();
  log(`========== 开始补采 stock_main_flow ==========`);
  log(`总股票数: ${allCodes.length}`);
  log(`已有数据行数: ${db.prepare('SELECT COUNT(*) as c FROM stock_main_flow').get().c}`);
  log(`限速: 3000ms/只，预计耗时: ~${(allCodes.length * 3000 / 3600000).toFixed(1)}h`);

  let success = 0, skipped = 0, failed = 0, totalRows = 0;
  const startTime = Date.now();

  for (let i = 0; i < allCodes.length; i++) {
    const code = allCodes[i];
    const pct = ((i + 1) / allCodes.length * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    // 检查是否已有今天数据
    const latest = getLatestDate(code);
    const today = new Date().toISOString().slice(0, 10);
    if (latest === today) {
      skipped++;
      if (i % 100 === 0) log(`[${pct}%] ${code} 已是最新(${latest})，跳过 (${i + 1}/${allCodes.length})`);
      continue;
    }

    log(`[${pct}%] (${i + 1}/${allCodes.length}, 已${elapsed}分钟) 采集 ${code}...`);
    const rows = await fetchMainFlowFromAPI(code);
    if (rows.length > 0) {
      const n = saveToDB(rows);
      totalRows += n;
      success++;
      log(`  ✅ ${code}: 写入 ${n} 条`);
    } else {
      failed++;
    }

    // 限速 3 秒
    if (i < allCodes.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }

    // 每 100 只报告一次进度
    if ((i + 1) % 100 === 0) {
      const rate = (success / (i + 1) * 100).toFixed(1);
      log(`---------- 进度: ${pct}%, 成功${success}, 跳过${skipped}, 失败${failed}, 写入${totalRows}行, 成功率${rate}% ----------`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  log(`========== 补采完成 ==========`);
  log(`总股票数: ${allCodes.length}`);
  log(`成功: ${success}, 跳过: ${skipped}, 失败: ${failed}`);
  log(`总写入行数: ${totalRows}`);
  log(`最终表行数: ${db.prepare('SELECT COUNT(*) as c FROM stock_main_flow').get().c}`);
  log(`耗时: ${totalTime} 分钟`);

  db.close();
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  log(e.stack);
  db.close();
  process.exit(1);
});
