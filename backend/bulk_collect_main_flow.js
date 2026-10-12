import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
#!/usr/bin/env node
/**
 * 批量采集全市场股票主力资金数据
 * 复制自 data_server.js → fetchStockMainFlow() 逻辑
 * 
 * 用法：
 *   node bulk_collect_main_flow.js          # 采集全部6107只
 *   node bulk_collect_main_flow.js --limit 50  # 测试前50只
 *   node bulk_collect_main_flow.js --resume     # 从已有数据继续
 */

const Database = require('better-sqlite3');
const axios = require('axios');

const DB_FILE = path.join(PROJECT_ROOT, 'database', 'stocks.db');
const DELAY_MS = 300;       // 300ms间隔（~3次/秒）
const LOG_EVERY = 20;       // 每20只打印一次

const db = new Database(DB_FILE);

// ── 单只股票采集（复制自 fetchStockMainFlow）─────────────────
async function fetchStockMainFlow(code) {
  if (!code) return 0;  // 防护：code为null/undefined/空字符串时直接返回
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`;
  const rows = [];
  
  try {
    const resp = await axios.get('https://push2delay.eastmoney.com/api/qt/stock/get', {
      params: {
        secid,
        fields: 'f57,f58,f43,f169,f170,f171,f174,f175,f178,f184',
        ut: 'bd1d9ddb04089700cf9c27f6f7426281',
      },
      timeout: 10000,
      headers: {
        'Referer': 'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (resp.data?.data) {
      const d = resp.data.data;
      const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      
      // 今日主力数据
      if (d.f169 !== undefined && d.f169 !== null) {
        rows.push({
          code,
          date: today,
          main_inflow: d.f169 * 10000,        // 万元→元
          main_ratio: d.f170 / 10,             // ‰→%
          super_inflow: (d.f174 || 0) * 10000,
          retail_inflow: (d.f175 || 0) * 10000,
          price: (d.f43 || 0) / 100,           // 分→元
          change_percent: d.f58 || 0,
        });
      }
      
      // f178: 近5日主力净流入历史 (JSON数组)
      if (d.f178) {
        try {
          const hist = JSON.parse(d.f178);
          for (const h of hist) {
            if (h.date && h.mainNetAmt !== undefined) {
              rows.push({
                code,
                date: h.date,
                main_inflow: h.mainNetAmt,
                main_ratio: 0,
                super_inflow: 0,
                retail_inflow: 0,
                price: 0,
                change_percent: 0,
              });
            }
          }
        } catch (e) { /* ignore */ }
      }
    }
    
    // 按日期降序排列
    rows.sort((a, b) => b.date.localeCompare(a.date));
    
    // 批量写入数据库
    if (rows.length > 0) {
      const stmt = db.prepare(`INSERT OR REPLACE INTO stock_main_flow
        (code, date, main_inflow, super_inflow, retail_inflow, main_ratio, price, change_percent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertMany = db.transaction((items) => {
        for (const item of items) {
          stmt.run(item.code, item.date, item.main_inflow, item.super_inflow, item.retail_inflow,
                   item.main_ratio, item.price, item.change_percent);
        }
      });
      insertMany(rows);
      return rows.length;
    }
    return 0;
  } catch (e) {
    // 输出错误便于调试
    console.error(`  ❌ ${code} 错误: ${e.message}`);
    return 0;
  }
}

// ── 主函数 ──────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
  const missingOnly = args.includes('--missing-only');
  const resume = args.includes('--resume');
  
  // 获取股票列表
  let codes;
  if (missingOnly) {
    const existing = new Set(db.prepare("SELECT DISTINCT code FROM stock_main_flow").pluck().all());
    codes = db.prepare("SELECT code FROM stocks ORDER BY code").all()
      .map(r => r.code).filter(c => !existing.has(c));
    console.log(`[仅缺失] 目标 ${codes.length} 只股票（无主力数据）`);
  } else if (resume) {
    const existing = new Set(db.prepare('SELECT DISTINCT code FROM stock_main_flow').pluck().all());
    codes = db.prepare('SELECT code FROM stocks ORDER BY code').all()
      .map(r => r.code).filter(c => !existing.has(c));
    console.log(`[恢复模式] 还需采集 ${codes.length} 只股票`);
  } else {
    codes = db.prepare('SELECT code FROM stocks ORDER BY code').all().map(r => r.code).filter(c => c);
    console.log(`[全量模式] 共 ${codes.length} 只股票`);
  }
  
  if (limit) {
    codes = codes.slice(0, limit);
    console.log(`[测试模式] 限制前 ${limit} 只`);
  }
  
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();
  let totalRows = 0;
  
  console.log(`\n开始批量采集，间隔 ${DELAY_MS}ms\n`);
  
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const progress = `[${i + 1}/${codes.length}] (${( (i / codes.length) * 100).toFixed(1)}%)`;
    
    const count = await fetchStockMainFlow(code);
    if (count > 0) {
      successCount++;
      totalRows += count;
      if ((i + 1) % LOG_EVERY === 0) console.log(`${progress} ✅ ${code} +${count}条`);
    } else {
      failCount++;
      if ((i + 1) % LOG_EVERY === 0) console.log(`${progress} ⚠️  ${code} 无数据`);
    }
    
    // 每100只显示统计
    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = (i + 1) / elapsed;
      const eta = (codes.length - i - 1) / rate;
      console.log(`   ✅ 成功: ${successCount} | ⚠️  失败: ${failCount} | 速度: ${rate.toFixed(1)}只/分钟 | 剩余: ${eta.toFixed(1)}分钟\n`);
    }
    
    // 延迟（最后一只不延迟）
    if (i < codes.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }
  
  const totalTime = (Date.now() - startTime) / 1000 / 60;
  console.log(`\n========== 采集完成 ==========`);
  console.log(`✅ 成功: ${successCount} 只股票`);
  console.log(`⚠️  失败: ${failCount} 只股票`);
  console.log(`📊 总数据行: ${totalRows} 条`);
  console.log(`⏱️  耗时: ${totalTime.toFixed(1)} 分钟`);
  
  const dbStats = db.prepare('SELECT COUNT(DISTINCT code) as c, COUNT(*) as t FROM stock_main_flow').get();
  console.log(`💾 数据库现状: ${dbStats.c} 只股票，${dbStats.t} 条记录`);
  
  db.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
