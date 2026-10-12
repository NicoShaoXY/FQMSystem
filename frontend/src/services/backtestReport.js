/**
 * 策略回测报告服务
 * 
 * 功能：
 * 1. 生成尧帝表现日报/周报/月报
 * 2. 分析历史建议准确率
 * 3. 统计盈亏比和收益曲线
 * 4. 导出报告为文件
 */

import { toBeijingTime, bjDate, bjISO } from '../utils/beijingTime';
const pad = n => String(n).padStart(2,'0');

// ========== 报告数据结构 ==========

// 从localStorage获取历史分析记录
function getAnalysisHistory() {
  try {
    const saved = localStorage.getItem('yaodi_analysis_history');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // 忽略错误
  }
  return [];
}

// 保存分析记录
export function saveAnalysisRecord(record) {
  const history = getAnalysisHistory();
  history.push({
    ...record,
    timestamp: bjISO(),
  });
  
  // 只保留最近1000条
  if (history.length > 1000) {
    history.splice(0, history.length - 1000);
  }
  
  try {
    localStorage.setItem('yaodi_analysis_history', JSON.stringify(history));
  } catch {
    // 忽略错误
  }
}

// ========== 统计计算 ==========

// 计算准确率
function calculateAccuracy(records) {
  if (records.length === 0) return 0;
  
  // 统计建议类型和后续表现
  const completed = records.filter(r => r.actualResult !== undefined);
  if (completed.length === 0) return null; // 无已完成记录
  
  const correct = completed.filter(r => {
    const suggestion = r.suggestion;
    const actual = r.actualResult; // 'up', 'down', 'flat'
    
    if (suggestion === '买入' || suggestion === '加仓') {
      return actual === 'up';
    } else if (suggestion === '卖出' || suggestion === '止损') {
      return actual === 'down';
    } else if (suggestion === '观望') {
      return actual === 'flat';
    }
    return false;
  });
  
  return (correct.length / completed.length * 100).toFixed(1);
}

// 计算收益率
function calculateReturn(records) {
  const trades = records.filter(r => r.executed && r.pnl !== undefined);
  if (trades.length === 0) return null;
  
  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalInvest = trades.reduce((sum, t) => sum + (t.amount || 0), 0);
  
  return {
    totalPnl,
    totalInvest,
    returnRate: totalInvest > 0 ? (totalPnl / totalInvest * 100).toFixed(2) : 0,
    tradeCount: trades.length,
  };
}

// 计算胜率
function calculateWinRate(records) {
  const trades = records.filter(r => r.executed && r.pnl !== undefined);
  if (trades.length === 0) return null;
  
  const wins = trades.filter(t => t.pnl > 0);
  return (wins.length / trades.length * 100).toFixed(1);
}

// 计算最大回撤
function calculateMaxDrawdown(records) {
  const trades = records.filter(r => r.executed && r.pnl !== undefined);
  if (trades.length === 0) return null;
  
  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;
  
  trades.forEach(t => {
    cumulative += t.pnl;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  });
  
  return maxDrawdown;
}

// ========== 报告生成 ==========

// 生成日报
export function generateDailyReport() {
  const history = getAnalysisHistory();
  const today = bjDate();
  
  const todayRecords = history.filter(r => 
    bjDate(new Date(r.timestamp)) === today
  );
  
  return generateReport(todayRecords, '日报', 'day');
}

// 生成周报
export function generateWeeklyReport() {
  const history = getAnalysisHistory();
  const weekAgo = toBeijingTime();
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  const weekRecords = history.filter(r => 
    new Date(r.timestamp) >= weekAgo
  );
  
  return generateReport(weekRecords, '周报', 'week');
}

// 生成月报
export function generateMonthlyReport() {
  const history = getAnalysisHistory();
  const monthAgo = toBeijingTime();
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  
  const monthRecords = history.filter(r => 
    new Date(r.timestamp) >= monthAgo
  );
  
  return generateReport(monthRecords, '月报', 'month');
}

// 通用报告生成
function generateReport(records, title, period) {
  const yaodiState = JSON.parse(localStorage.getItem('yaodi_state') || '{}');
  const mainMetrics = yaodiState.main || {};
  
  const report = {
    title: `尧帝智能体${title}`,
    generatedAt: (() => { const t = toBeijingTime(); return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`; })(),
    period,
    
    // 统计数据
    stats: {
      totalAnalysis: records.length,
      buySignals: records.filter(r => r.suggestion?.includes('买')).length,
      sellSignals: records.filter(r => r.suggestion?.includes('卖') || r.suggestion?.includes('止损')).length,
      holdSignals: records.filter(r => r.suggestion?.includes('观望') || r.suggestion?.includes('持有')).length,
    },
    
    // 准确率分析
    accuracy: calculateAccuracy(records),
    
    // 收益分析
    returns: calculateReturn(records),
    
    // 胜率
    winRate: calculateWinRate(records),
    
    // 最大回撤
    maxDrawdown: calculateMaxDrawdown(records),
    
    // 尧帝当前状态
    yaodiMetrics: {
      version: `V${mainMetrics.main_version || 1}.0`,
      accuracy: mainMetrics.accuracy?.toFixed(1) || '--',
      winRate: mainMetrics.win_rate?.toFixed(1) || '--',
      sharpe: mainMetrics.sharpe_ratio?.toFixed(2) || '--',
      drawdown: mainMetrics.max_drawdown?.toFixed(2) || '--',
      return: mainMetrics.avg_return?.toFixed(1) || '--',
      evolutionCount: mainMetrics.evolution_count?.toLocaleString() || '--',
      branchCount: yaodiState.branches?.filter(b => b.active).length || 0,
    },
    
    // 建议
    recommendations: generateRecommendations(records, mainMetrics),
  };
  
  return report;
}

// 生成改进建议
function generateRecommendations(records, metrics) {
  const recommendations = [];
  
  // 基于准确率
  if (metrics.accuracy && metrics.accuracy < 80) {
    recommendations.push({
      type: 'warning',
      text: '准确率偏低，建议加强训练数据质量',
    });
  }
  
  // 基于回撤
  if (metrics.max_drawdown && metrics.max_drawdown > 10) {
    recommendations.push({
      type: 'risk',
      text: '最大回撤较大，建议收紧止损线',
    });
  }
  
  // 基于夏普
  if (metrics.sharpe_ratio && metrics.sharpe_ratio < 2) {
    recommendations.push({
      type: 'info',
      text: '夏普比率偏低，风险收益比需优化',
    });
  }
  
  // 基于情绪
  if (metrics.market_sentiment && metrics.market_sentiment < -0.2) {
    recommendations.push({
      type: 'alert',
      text: '市场情绪偏空，建议降低仓位',
    });
  }
  
  return recommendations;
}

// ========== 报告导出 ==========

export function exportReport(report, format = 'text') {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }
  
  // 文本格式
  const lines = [
    `╔════════════════════════════════════════════════════════════╗`,
    `║            ${report.title.padEnd(40)}    ║`,
    `╠════════════════════════════════════════════════════════════╣`,
    `║ 生成时间: ${report.generatedAt.padEnd(42)} ║`,
    `╠════════════════════════════════════════════════════════════╣`,
    `║ 【统计概览】                                              ║`,
    `║  分析总数: ${String(report.stats.totalAnalysis).padEnd(43)} ║`,
    `║  买入信号: ${String(report.stats.buySignals).padEnd(43)} ║`,
    `║  卖出信号: ${String(report.stats.sellSignals).padEnd(43)} ║`,
    `║  观望信号: ${String(report.stats.holdSignals).padEnd(43)} ║`,
    `╠════════════════════════════════════════════════════════════╣`,
    `║ 【绩效指标】                                              ║`,
    `║  预测准确率: ${report.accuracy ? `${report.accuracy}%`.padEnd(40) : '数据不足'.padEnd(40)} ║`,
    `║  交易胜率: ${report.winRate ? `${report.winRate}%`.padEnd(42) : '数据不足'.padEnd(42)} ║`,
    `║  累计收益: ${report.returns ? `¥${report.returns.totalPnl.toFixed(2)} (${report.returns.returnRate}%)`.padEnd(33) : '数据不足'.padEnd(40)} ║`,
    `║  最大回撤: ${report.maxDrawdown ? `¥${report.maxDrawdown.toFixed(2)}`.padEnd(41) : '数据不足'.padEnd(41)} ║`,
    `╠════════════════════════════════════════════════════════════╣`,
    `║ 【尧帝状态】                                              ║`,
    `║  版本: ${report.yaodiMetrics.version.padEnd(47)} ║`,
    `║  准确率: ${`${report.yaodiMetrics.accuracy}%`.padEnd(44)} ║`,
    `║  胜率: ${`${report.yaodiMetrics.winRate}%`.padEnd(46)} ║`,
    `║  夏普: ${report.yaodiMetrics.sharpe.padEnd(46)} ║`,
    `║  回撤: ${`${report.yaodiMetrics.drawdown}%`.padEnd(46)} ║`,
    `║  收益: ${`${report.yaodiMetrics.return}%`.padEnd(46)} ║`,
    `║  进化次数: ${report.yaodiMetrics.evolutionCount.padEnd(42)} ║`,
    `║  活跃分支: ${String(report.yaodiMetrics.branchCount).padEnd(42)} ║`,
    `╠════════════════════════════════════════════════════════════╣`,
    `║ 【改进建议】                                              ║`,
  ];
  
  if (report.recommendations.length === 0) {
    lines.push(`║  暂无特殊建议，系统运行良好                               ║`);
  } else {
    report.recommendations.forEach((r, i) => {
      lines.push(`║  ${i + 1}. ${r.text.padEnd(51)} ║`);
    });
  }
  
  lines.push(`╚════════════════════════════════════════════════════════════╝`);
  
  return lines.join('\n');
}

// 下载报告文件
export function downloadReport(report, format = 'txt') {
  const content = format === 'json' 
    ? exportReport(report, 'json')
    : exportReport(report, 'text');
  
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `尧帝报告_${report.period}_${bjDate()}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export default {
  saveAnalysisRecord,
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
  exportReport,
  downloadReport,
};
