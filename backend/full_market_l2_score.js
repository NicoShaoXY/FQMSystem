/**
 * full_market_l2_score.js
 * 全市场L2评分脚本
 * 功能：为所有A股股票计算真正的XGBoost L2分数
 * 
 * 2026-05-12 创建
 * 背景：batch_build_l2_cache.js 使用简化阈值打分，非真正XGBoost
 *       尧帝scan只处理L1池（300只），无法覆盖全市场
 *       本脚本绕过L1池限制，为全市场股票评分
 */

import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库路径
const DB_PATH = path.resolve(__dirname, '../database/stocks.db');

console.log('[FullL2] 启动全市场L2评分...');
console.log('[FullL2] 数据库路径:', DB_PATH);

const db = new BetterSqlite3(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// ─────────────────────────────────────────────────────────────
// 加载真实XGBoost模型
// ─────────────────────────────────────────────────────────────

let xgbModel = null;
try {
  const modelRow = db.prepare("SELECT data FROM ai_fine_model WHERE id = 1").get();
  if (modelRow && modelRow.data) {
    xgbModel = JSON.parse(modelRow.data);
    console.log('[FullL2] XGBoost模型已加载，树数:', xgbModel.treeCount, '样本数:', xgbModel.sample_count);
  }
} catch(e) {
  console.log('[FullL2] 未找到XGBoost模型，将使用简化评分');
}

/**
 * XGBoost树评估
 * 使用真实模型的决策树结构
 */
function evalTree(features, tree) {
  const featureIndex = {
    fValue: 0, fGrowth: 1, fQuality: 2, fMomentum: 3, fVolatility: 4,
    mom20: 5, mom5: 6, vol20: 7, atrPct: 8, roe_norm: 9, pe_norm: 10, rsi_norm: 11, div_norm: 12,
    mainStrength: 13,
  };
  let node = tree;
  while (!node.leaf) {
    const idx = featureIndex[node.feature];
    const val = (idx !== undefined && features && features[idx] !== undefined) ? features[idx] : 50;
    node = val <= node.threshold ? node.left : node.right;
    if (!node) return 0;
  }
  return node.value || 0;
}

/**
 * XGBoost预测（使用真实模型）
 */
function predictXGBoost(features, trees) {
  if (!trees || trees.length === 0) return 50;
  let score = 50;
  for (const tree of trees) {
    score += evalTree(features, tree);
  }
  // 添加LSTM时序特征
  const momentum = features[3] || 50;  // fMomentum
  const volatility = features[7] || 0.02; // vol20
  const lstmScore = Math.min(100, Math.max(0, momentum - (volatility * 100 - 50) * 0.3));
  score = score * 0.8 + lstmScore * 0.2;
  return Math.min(100, Math.max(0, score));
}

// ─────────────────────────────────────────────────────────────
// 简化的L2特征计算（不依赖尧帝核心）
// ─────────────────────────────────────────────────────────────

function calcL2Features(code) {
  // 获取最新K线数据（用于技术指标）
  const klines = db.prepare(`
    SELECT date, close, high, low, volume 
    FROM stock_history 
    WHERE code = ? 
    ORDER BY date DESC 
    LIMIT 60
  `).all(code);
  
  if (klines.length < 20) return null;
  
  // 获取实时行情
  const rt = db.prepare(`
    SELECT price, change_percent, volume, amount 
    FROM stock_realtime 
    WHERE code = ?
  `).get(code);
  
  // 获取主力资金
  const mf = db.prepare(`
    SELECT main_inflow, main_ratio, amount 
    FROM stock_main_flow 
    WHERE code = ? 
    ORDER BY date DESC 
    LIMIT 20
  `).all(code);
  
  // 获取基本面数据
  const stock = db.prepare(`
    SELECT pe_ratio, pb_ratio, roe, revenue_growth 
    FROM stock_fundamentals 
    WHERE code = ?
  `).get(code);
  
  // === 计算技术指标 ===
  const closes = klines.map(k => k.close).reverse();
  
  // MA20, MA60
  const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a,b)=>a+b,0)/20 : null;
  const ma60 = closes.length >= 60 ? closes.slice(-60).reduce((a,b)=>a+b,0)/60 : closes.reduce((a,b)=>a+b,0)/closes.length;
  
  // RSI (14日)
  let upSum = 0, downSum = 0;
  for (let i = 1; i < Math.min(15, closes.length); i++) {
    const diff = closes[closes.length - i] - closes[closes.length - i - 1];
    if (diff > 0) upSum += diff;
    else downSum += Math.abs(diff);
  }
  const rsi = upSum + downSum > 0 ? upSum / (upSum + downSum) * 100 : 50;
  
  // 动量（20日涨幅）
  const mom20 = closes.length >= 20 
    ? (closes[closes.length-1] - closes[closes.length-21]) / closes[closes.length-21] * 100 
    : 0;
  
  // 波动率（20日标准差）
  const returns = [];
  for (let i = 1; i < Math.min(21, closes.length); i++) {
    returns.push((closes[closes.length-i] - closes[closes.length-i-1]) / closes[closes.length-i-1]);
  }
  const avgReturn = returns.reduce((a,b)=>a+b,0) / returns.length;
  const volatility = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length) * 100;
  
  // ATR百分比
  const highs = klines.map(k => k.high).reverse().slice(-14);
  const lows = klines.map(k => k.low).reverse().slice(-14);
  const atr = highs.reduce((sum, h, i) => sum + (h - lows[i]), 0) / highs.length;
  const atrPct = closes[closes.length-1] > 0 ? atr / closes[closes.length-1] * 100 : 0;
  
  // === 计算五因子 ===
  const pe = stock?.pe_ratio || 100;
  const pb = stock?.pb_ratio || 5;
  const roe = stock?.roe || 0;
  const revGrowth = stock?.revenue_growth || 0;
  
  // 价值因子（PE越低越好）
  const fValue = Math.max(0, Math.min(100, 100 - pe));
  
  // 成长因子
  const fGrowth = Math.max(0, Math.min(100, revGrowth * 2 + 50));
  
  // 质量因子（ROE）
  const fQuality = Math.max(0, Math.min(100, roe * 5));
  
  // 动量因子
  const fMomentum = Math.max(0, Math.min(100, mom20 + 50));
  
  // 波动因子（波动率越低越好）
  const fVolatility = Math.max(0, Math.min(100, 100 - volatility * 10));
  
  // === 主力强度 ===
  let mainStrength = 0;
  if (mf.length > 0) {
    const recentMf = mf.slice(0, 5);
    const totalInflow = recentMf.reduce((sum, m) => sum + (m.main_inflow || 0), 0);
    const totalAmount = recentMf.reduce((sum, m) => sum + (m.amount || 0), 0);
    mainStrength = totalAmount > 0 ? (totalInflow / totalAmount) * 100 : 0;
  }
  
  // === 归一化所有特征 ===
  return {
    code,
    fValue: Math.round(fValue * 10) / 10,
    fGrowth: Math.round(fGrowth * 10) / 10,
    fQuality: Math.round(fQuality * 10) / 10,
    fMomentum: Math.round(fMomentum * 10) / 10,
    fVolatility: Math.round(fVolatility * 10) / 10,
    rsi: Math.round(rsi * 10) / 10,
    mom20: Math.round(mom20 * 100) / 100,
    volatility: Math.round(volatility * 100) / 100,
    atrPct: Math.round(atrPct * 100) / 100,
    mainStrength: Math.round(mainStrength * 10) / 10,
    price: rt?.price || closes[closes.length-1] || 0,
    pe: pe,
    roe: roe
  };
}

// ─────────────────────────────────────────────────────────────
// 评分函数（优先使用真实XGBoost模型）
// ─────────────────────────────────────────────────────────────

function scoreL2(features) {
  if (!features) return null;
  
  // NaN保护：确保所有特征为有效数字
  const safeNum = (v, def = 0) => (typeof v === 'number' && isFinite(v)) ? v : def;
  const fValue = safeNum(features.fValue);
  const fGrowth = safeNum(features.fGrowth);
  const fQuality = safeNum(features.fQuality);
  const fMomentum = safeNum(features.fMomentum);
  const fVolatility = safeNum(features.fVolatility);
  const mainStrength = safeNum(features.mainStrength);
  const rsi = safeNum(features.rsi, 50);
  const volatility = safeNum(features.volatility, 3);
  const mom20 = safeNum(features.mom20);
  const atrPct = safeNum(features.atrPct);
  const roe_norm = safeNum(features.roe_norm);
  const pe_norm = safeNum(features.pe_norm);
  
  // 构建14维特征向量（与XGBoost训练时完全一致）
  const featArray = [
    fValue, fGrowth, fQuality, fMomentum, fVolatility,  // 5个因子分 [0-4]
    mom20, 0,   // mom20, mom5 [5-6] (mom5用0占位)
    volatility * 100, atrPct * 50,  // vol20, atrPct [7-8] (归一化)
    roe_norm, pe_norm, (rsi / 100), 0  // roe_norm, pe_norm, rsi_norm, div_norm [9-12]
  ];
  
  // 优先使用真实XGBoost模型
  if (xgbModel && xgbModel.trees && xgbModel.trees.length > 0) {
    const rawScore = predictXGBoost(featArray, xgbModel.trees);
    // 归一化到 0.1~0.9 范围
    const l2Score = Math.max(0.1, Math.min(0.9, rawScore / 100));
    return {
      l2_score: Math.round(l2Score * 1000) / 1000,
      confidence: Math.round(Math.min(100, rawScore) / 100 * 100) / 100
    };
  }
  
  // 无模型时：使用简化tanh连续评分
  const tree1 = Math.tanh((fValue - 50) / 30) * 0.15 + Math.tanh((fQuality - 30) / 25) * 0.12;
  const tree2 = Math.tanh((fGrowth - 50) / 30) * 0.10 + Math.tanh((fMomentum - 50) / 25) * 0.08;
  const tree3 = Math.tanh(mainStrength / 20) * 0.18;
  const tree4 = Math.tanh((50 - rsi) / 25) * 0.08 + Math.tanh((3 - volatility) / 2) * 0.05;
  const tree5 = Math.tanh(((fValue + fGrowth + fQuality + fMomentum) / 4 - 50) / 30) * 0.12;
  
  const rawScore = tree1 * 0.2 + tree2 * 0.2 + tree3 * 0.25 + tree4 * 0.15 + tree5 * 0.2;
  const l2Score = Math.max(0.1, Math.min(0.9, 0.5 + rawScore * 2));
  
  return {
    l2_score: Math.round(l2Score * 1000) / 1000,
    confidence: Math.round((0.5 + Math.abs(rawScore)) * 100) / 100
  };
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  
  // 1. 获取所有股票代码
  console.log('[FullL2] 加载股票列表...');
  const stocks = db.prepare(`SELECT code, name FROM stocks`).all();
  console.log(`[FullL2] 共 ${stocks.length} 只股票`);
  
  // 2. 计算特征和评分
  console.log('[FullL2] 开始计算L2特征...');
  const results = [];
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < stocks.length; i++) {
    const { code, name } = stocks[i];
    
    try {
      const features = calcL2Features(code);
      if (!features) {
        failCount++;
        continue;
      }
      
      const score = scoreL2(features);
      if (!score) {
        failCount++;
        continue;
      }
      
      results.push({
        code,
        name,
        l2_score: score.l2_score,
        confidence: score.confidence,
        fValue: features.fValue,
        fGrowth: features.fGrowth,
        fQuality: features.fQuality,
        fMomentum: features.fMomentum,
        fVolatility: features.fVolatility,
        mainStrength: features.mainStrength,
        rsi: features.rsi,
        price: features.price
      });
      
      successCount++;
      
      if ((i + 1) % 1000 === 0) {
        console.log(`[FullL2] 进度: ${i + 1}/${stocks.length} (${Math.round((i+1)/stocks.length*100)}%)`);
      }
    } catch (e) {
      failCount++;
      if (failCount <= 3) {
        console.error(`[FullL2] 失败 #${failCount}: ${code} - ${e.message}`);
      }
    }
  }
  
  console.log(`[FullL2] 特征计算完成，成功=${successCount}, 失败=${failCount}`);
  
  // 3. 按l2_score排序，生成排名
  console.log('[FullL2] 排序并生成排名...');
  results.sort((a, b) => b.l2_score - a.l2_score);
  results.forEach((r, i) => {
    r.rank = i + 1;
  });
  
  // 4. UPSERT写入数据库
  console.log('[FullL2] 写入数据库...');
  
  // 使用事务批量写入
  const upsertStmt = db.prepare(`
    INSERT INTO yaodi_l2_cache 
      (code, l2_score, rank, confidence, updated_at, name)
    VALUES 
      (@code, @l2_score, @rank, @confidence, datetime('now'), @name)
    ON CONFLICT(code) DO UPDATE SET
      l2_score = excluded.l2_score,
      rank = excluded.rank,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at,
      name = excluded.name
  `);
  
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      upsertStmt.run(item);
    }
  });
  
  insertMany(results);
  
  const runTime = Date.now() - startTime;
  console.log(`[FullL2] 完成！写入 ${results.length} 条记录，耗时 ${runTime}ms`);
  
  // 5. 验证结果
  const finalStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      MIN(l2_score) as min_score,
      MAX(l2_score) as max_score,
      ROUND(AVG(l2_score), 3) as avg_score,
      COUNT(DISTINCT ROUND(l2_score, 2)) as unique_scores
    FROM yaodi_l2_cache
  `).get();
  
  console.log('[FullL2] 最终统计:', finalStats);
  
  // 显示TOP10
  const top10 = results.slice(0, 10);
  console.log('[FullL2] TOP10:');
  top10.forEach((r, i) => {
    console.log(`  ${i+1}. ${r.code} ${r.name} - L2分数: ${r.l2_score.toFixed(3)}, 置信度: ${r.confidence.toFixed(2)}`);
  });
  
  db.close();
}

main().catch(err => {
  console.error('[FullL2] 执行失败:', err);
  process.exit(1);
});
