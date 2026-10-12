/**
 * 修复 data_server.js 中红后紧急卖出代码块的重复 const price 声明
 * 问题：edit工具多次修改导致同一作用域内 const price 被声明两次
 * 方案：找到红后紧急卖出代码块，确保每个变量只声明一次
 */

const fs = require('fs');
const path = '/Users/shao/Projects/FQMSystem/backend/data_server.js';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

// 找到红后紧急卖出代码块的起始行
let startIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("decisions.filter(d => d.actions[0]?.urgent).forEach")) {
    startIdx = i;
    break;
  }
}

if (startIdx === -1) {
  console.log('❌ 未找到目标代码块');
  process.exit(1);
}

console.log(`✅ 找到目标代码块，起始行: ${startIdx + 1}`);

// 检查从 startIdx 开始的30行内，const price 出现几次
let priceCount = 0;
let profitPctCount = 0;
const linesToCheck = lines.slice(startIdx, startIdx + 80);
for (let i = 0; i < linesToCheck.length; i++) {
  const line = linesToCheck[i];
  if (/^\s*const\s+price\s*=/.test(line)) {
    priceCount++;
    console.log(`  第${startIdx + i + 1}行: const price (第${priceCount}次)`);
  }
  if (/^\s*const\s+profitPct\s*=/.test(line)) {
    profitPctCount++;
    console.log(`  第${startIdx + i + 1}行: const profitPct (第${profitPctCount}次)`);
  }
}

console.log(`\n汇总: const price 出现 ${priceCount} 次, const profitPct 出现 ${profitPctCount} 次`);

if (priceCount <= 1 && profitPctCount <= 1) {
  console.log('✅ 没有重复声明，无需修复');
  process.exit(0);
}

// 修复：从第二处重复声明开始，把 const 改成 let（或者删除整行）
// 最干净的做法：重写整个代码块，确保每个变量只声明一次
console.log('\n🔧 开始修复...\n');

// 构造修复后的代码块（从 startIdx 开始，到下一个 decisions.filter 或 function 为止）
const fixedBlock = `    // 红后紧急卖出:只有盈利>0.5%或亏损>8%才执行,避免正常波动乱卖
    decisions.filter(d => d.actions[0]?.urgent).forEach(d => {
      const h = db.prepare("SELECT * FROM shundi_mock_holdings WHERE code = ? AND shares > 0").get(d.code);
      if (!h) return;
      const price = h.current_price || h.avg_cost;
      const profitPct = h.avg_cost > 0 ? (price - h.avg_cost) / h.avg_cost * 100 : 0;
      // 在 [-8%, 0.5%] 区间内不卖（正常波动）
      if (profitPct > -8 && profitPct < 0.5) {
        console.log(\`[红后] \${h.name} 盈亏\${profitPct.toFixed(1)}%,未达卖出条件,跳过\`);
        return;
      }
      const pnl = (price - h.avg_cost) * h.shares;
      const oid = "RQ_SL_" + h.code + "_" + Date.now();
      if (!canSellByT1(h.buy_date)) {
        addRedQueenLog(\`⚠️ A股T+1注意:\${h.name} 今日买入,模拟盘允许止损但实盘受限\`);
      }
      db.prepare("DELETE FROM shundi_mock_holdings WHERE code = ?").run(h.code);
      db.prepare(\`INSERT INTO shundi_mock_trades (order_id, type, code, name, price, shares, amount, commission, status, filled_time, source, confidence, reason, pnl, yaodi_branch_id) VALUES (?, 'sell', ?, ?, ?, ?, ?, ?, 'filled', ?, 'redqueen', ?, ?, ?, ?)\`).run(oid, h.code, h.name, price, h.shares, h.market_value, h.market_value * 0.0013, bjNow(), d.confidence || 0, d.actions[0]?.reason || '止损', pnl, h.yaodi_branch_id || d.yaodi_branch_id || null);
      try {
        recordBacktestTrade({ trade_type: 'sell', code: h.code, name: h.name, shares: h.shares, price, amount: h.market_value, profit: pnl, profit_percent: profitPct, strategy: d.actions[0]?.type || '止损', signal_confidence: d.confidence || 0, hold_days: Math.floor((Date.now() - new Date(h.update_time || Date.now()).getTime()) / 86400000) });
      } catch(e) { /* ignore */ }
      try { resolvePendingTrade(oid, price, Date.now()); } catch(e) { /* ignore */ }
      addRedQueenLog(\`🔴 红后卖出: \${h.name} \${h.shares}股 @¥\${price.toFixed(2)} 盈亏¥\${pnl.toFixed(2)}(\${profitPct.toFixed(1)}%)\`, 'warning');
    });`;

// 找到代码块结束位置（下一个 decisions.filter 或 function 开头）
let endIdx = startIdx + 1;
while (endIdx < lines.length) {
  if (lines[endIdx].includes('decisions.filter(') && endIdx > startIdx + 5) break;
  if (lines[endIdx].includes('function ') && endIdx > startIdx + 5) break;
  if (lines[endIdx].includes('  // ==========') && endIdx > startIdx + 5) break;
  endIdx++;
}

console.log(`代码块范围: 行${startIdx + 1} ~ 行${endIdx}`);
console.log(`将替换 ${endIdx - startIdx} 行为修复后的 ${fixedBlock.split('\n').length} 行`);

// 执行替换
const newLines = [
  ...lines.slice(0, startIdx),
  ...fixedBlock.split('\n'),
  ...lines.slice(endIdx)
];

const newContent = newLines.join('\n');

// 验证语法
try {
  new Function(newContent.substring(0, Math.min(newContent.length, 1000000)));
  console.log('✅ 语法预检通过');
} catch(e) {
  console.log('⚠️ 语法预检警告:', e.message);
}

// 备份
const backupPath = path + '.bak.' + Date.now();
fs.copyFileSync(path, backupPath);
console.log(`📦 备份已保存: ${backupPath}`);

// 写入
fs.writeFileSync(path, newContent, 'utf8');
console.log(`✅ 修复完成！已写入 ${path}`);

// 验证
const { execSync } = require('child_process');
try {
  execSync(`node -c "${path}"`, { stdio: 'pipe' });
  console.log('✅ 语法检查通过！');
} catch(e) {
  console.log('❌ 语法检查失败:', e.stderr?.toString() || e.message);
  // 回滚
  fs.copyFileSync(backupPath, path);
  console.log('🔄 已回滚');
}
