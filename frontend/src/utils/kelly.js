// 凯利仓位计算工具
// 基于凯利公式计算最优仓位比例

/**
 * 计算凯利仓位建议
 * @param {number} winRate - 胜率（0-100）
 * @param {number} avgWin - 平均盈利比例（如0.15表示15%）
 * @param {number} avgLoss - 平均亏损比例（如-0.08表示-8%）
 * @param {number} accountBalance - 账户余额
 * @param {number} stockPrice - 股票当前价格
 * @param {number} maxPositionPct - 最大仓位比例（默认25%）
 * @returns {object} - 凯利仓位建议
 */
export function calculateKellyPosition(winRate, avgWin, avgLoss, accountBalance, stockPrice, maxPositionPct = 0.25) {
  // 参数验证
  if (winRate <= 0 || winRate >= 100) {
    return { error: '胜率应在1-99之间', kellyFraction: 0, shares: 0 };
  }
  if (avgWin <= 0 || avgLoss >= 0) {
    return { error: '平均盈利应为正，平均亏损应为负', kellyFraction: 0, shares: 0 };
  }
  if (accountBalance <= 0 || stockPrice <= 0) {
    return { error: '账户余额和股价应大于0', kellyFraction: 0, shares: 0 };
  }

  // 凯利公式: f* = (bp - q) / b
  // b = 盈亏比（平均盈利 / 平均亏损绝对值）
  // p = 胜率
  // q = 1 - p
  const b = avgWin / Math.abs(avgLoss); // 盈亏比
  const p = winRate / 100; // 胜率（小数）
  const q = 1 - p; // 败率
  
  // 计算凯利比例
  let kellyFraction = (b * p - q) / b;
  
  // 凯利比例调整
  // 1. 如果凯利比例为负，表示不应投资
  if (kellyFraction <= 0) {
    return {
      kellyFraction: 0,
      adjustedFraction: 0,
      shares: 0,
      positionValue: 0,
      warning: '根据凯利公式，当前不建议投资此股票',
      details: {
        winLossRatio: b.toFixed(2),
        expectedValue: (b * p - q).toFixed(4),
        kellyFraction: kellyFraction.toFixed(4)
      }
    };
  }
  
  // 2. 使用半凯利策略降低风险
  let adjustedFraction = kellyFraction * 0.5;
  
  // 3. 设置最大仓位上限
  adjustedFraction = Math.min(adjustedFraction, maxPositionPct);
  
  // 计算买入股数（向下取整到100股的倍数）
  const maxShares = Math.floor((accountBalance * adjustedFraction) / stockPrice / 100) * 100;
  
  // 计算实际仓位金额
  const positionValue = maxShares * stockPrice;
  
  // 计算实际仓位比例
  const actualPositionPct = positionValue / accountBalance;
  
  return {
    kellyFraction: parseFloat((kellyFraction * 100).toFixed(2)), // 原始凯利比例（百分比）
    adjustedFraction: parseFloat((adjustedFraction * 100).toFixed(2)), // 调整后比例（百分比）
    shares: maxShares, // 建议买入股数
    positionValue: parseFloat(positionValue.toFixed(2)), // 仓位金额
    actualPositionPct: parseFloat((actualPositionPct * 100).toFixed(2)), // 实际仓位比例（百分比）
    details: {
      winLossRatio: b.toFixed(2), // 盈亏比
      expectedValue: (b * p - q).toFixed(4), // 期望值
      halfKelly: true, // 使用半凯利
      maxPositionPct: parseFloat((maxPositionPct * 100).toFixed(0)) // 最大仓位限制
    },
    // 风险提示
    riskWarning: generateRiskWarning(winRate, b, kellyFraction, adjustedFraction)
  };
}

/**
 * 根据尧帝信号计算凯利仓位
 * @param {object} signal - 尧帝信号对象
 * @param {number} accountBalance - 账户余额
 * @param {number} stockPrice - 股票当前价格
 * @returns {object} - 凯利仓位建议
 */
export function calculateKellyFromSignal(signal, accountBalance, stockPrice) {
  // 从信号中提取胜率和盈亏比
  const winRate = signal.confidence || 50;
  
  // 根据信号类型设置默认盈亏比
  let avgWin, avgLoss;
  
  if (signal.signal_status === 'buy' || signal.action === 'buy') {
    // 买入信号：根据置信度设置盈亏比
    avgWin = signal.kelly_pct ? signal.kelly_pct / 100 : 0.15; // 默认15%止盈
    avgLoss = signal.stop_loss_pct ? -signal.stop_loss_pct / 100 : -0.10; // 默认10%止损
  } else {
    // 其他信号：保守设置
    avgWin = 0.10;
    avgLoss = -0.08;
  }
  
  return calculateKellyPosition(winRate, avgWin, avgLoss, accountBalance, stockPrice);
}

/**
 * 生成风险提示
 */
function generateRiskWarning(winRate, winLossRatio, kellyFraction, adjustedFraction) {
  const warnings = [];
  
  if (winRate < 50) {
    warnings.push('⚠️ 胜率低于50%，投资风险较高');
  }
  
  if (winLossRatio < 1) {
    warnings.push('⚠️ 盈亏比小于1，长期期望收益为负');
  }
  
  if (kellyFraction > 0.5) {
    warnings.push('⚠️ 原始凯利比例超过50%，建议谨慎');
  }
  
  if (adjustedFraction > 0.2) {
    warnings.push('⚠️ 调整后仓位超过20%，注意分散风险');
  }
  
  if (warnings.length === 0) {
    warnings.push('✅ 仓位建议在合理范围内');
  }
  
  return warnings;
}

/**
 * 计算组合凯利仓位
 * @param {Array} signals - 多个股票信号数组
 * @param {number} accountBalance - 账户余额
 * @returns {Array} - 各股票凯利仓位建议
 */
export function calculatePortfolioKelly(signals, accountBalance) {
  // 过滤出买入信号
  const buySignals = signals.filter(s => 
    s.signal_status === 'buy' || s.action === 'buy'
  );
  
  if (buySignals.length === 0) {
    return [];
  }
  
  // 计算每个信号的凯利比例
  const kellyResults = buySignals.map(signal => {
    const result = calculateKellyFromSignal(signal, accountBalance, signal.price || 10);
    return {
      code: signal.code,
      name: signal.name,
      ...result,
      signal
    };
  });
  
  // 计算总凯利比例
  const totalKelly = kellyResults.reduce((sum, r) => sum + r.adjustedFraction, 0);
  
  // 如果总比例超过100%，按比例缩减
  if (totalKelly > 100) {
    const scale = 100 / totalKelly;
    kellyResults.forEach(r => {
      r.adjustedFraction = parseFloat((r.adjustedFraction * scale).toFixed(2));
      r.shares = Math.floor((accountBalance * r.adjustedFraction / 100) / (r.signal.price || 10) / 100) * 100;
      r.positionValue = r.shares * (r.signal.price || 10);
      r.scaled = true;
      r.scaleFactor = scale.toFixed(2);
    });
  }
  
  return kellyResults;
}

export default {
  calculateKellyPosition,
  calculateKellyFromSignal,
  calculatePortfolioKelly
};
