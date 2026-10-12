import { redqueenAPI, learningAPI, sentimentAPI, positionAPI, decisionAPI, indicatorAPI, shundiAPI } from '../config/api';
import { useState, useEffect, useCallback, useRef } from 'react';

import { API_BASE } from '../config/api';
import { getMarketStatus } from '../utils/marketTime';
import { formatBJTime, formatBJTimeFull } from '../utils/beijingTime';

// ==================== 溢出安全样式常量 ====================
const S = {
  // 防撑破 flex-1
  flex1: { flex: 1, minWidth: 0, overflow: 'hidden' },
  flexCol: { display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' },
  // 卡片容器（内层 flex 防撑破）
  cardInner: { display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' },
  // 12列大网格（舜帝主面板）
  grid12: { display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '20px', minWidth: 0, overflow: 'hidden' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', minWidth: 0 },
};

// 状态指示灯
function StatusDot({ active, size = 8 }) {
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      borderRadius: '50%',
      background: active ? 'var(--accent-green)' : 'var(--text-quaternary)',
      boxShadow: active ? '0 0 6px var(--accent-green)' : 'none',
      overflow: 'hidden',
      minWidth: 0,
    }} />
  );
}

// 指标行
function MetricRow({ label, value, sub, highlight }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{label}</span>
      <div className="metric-right">
        <span className={`metric-value ${highlight || ''}`}>{value}</span>
        {sub && <span className="metric-sub">{sub}</span>}
      </div>
    </div>
  );
}

// 舜帝收益颜色：正→红色，负→绿色，零→橙色
const getProfitColor = (p) => p > 0 ? 'var(--accent-red)' : p < 0 ? 'var(--accent-green)' : 'var(--accent-orange)';

// 决策卡片 - 舜帝对持仓的操作建议
function DecisionCard({ decision }) {
  const stock = decision.name || decision.stock || decision.code;
  const code = decision.code || '';
  const shares = decision.shares || 0;
  const avgCost = decision.avgCost || decision.avg_cost || 0;
  const currentPrice = decision.currentPrice || decision.current_price || 0;
  
  // profit_percent 后端返回百分比格式（如 -3.13 表示 -3.13%），前端直接显示
  const profitPct = (decision.profitPct || decision.profit_percent || 0);
  const profit = decision.profit || 0;
  const actions = decision.actions || [];
  const firstAction = actions[0] || {};
  const actionType = firstAction.type || firstAction.direction || '持有';
  const actionReason = firstAction.reason || decision.reason || '';
  const isUrgent = firstAction.urgent || decision.urgent;
  const priority = decision.priority || 99;
  
  // 止损价/目标价（新字段）
  const stopLossPrice = decision.stopLossPrice || firstAction.stopPrice || 0;
  const targetPrice = decision.targetPrice || firstAction.targetPrice || decision.takeProfitPrice || 0;
  const potentialGain = decision.potentialGain || (targetPrice > 0 && currentPrice > 0 ? Number((targetPrice / currentPrice - 1) * 100).toFixed(1) : '--');
  const potentialLoss = decision.potentialLoss || (stopLossPrice > 0 && currentPrice > 0 ? Number((stopLossPrice / currentPrice - 1) * 100).toFixed(1) : '--');
  
  // 时效性信息
  const lastAnalysisTime = decision.last_analysis_time || '';
  const signalExpiryHours = decision.signal_expiry_hours || 24;
  const nextCheckTime = decision.next_check_time || '';

  // 操作类型颜色
  const actionColors = {
    '买入': 'var(--accent-red)',
    '舜帝买入': 'var(--accent-red)',
    '加仓': 'var(--accent-red)',
    '卖出': 'var(--accent-green)',
    '止损': 'var(--accent-green)',
    '止盈': 'var(--accent-red)',
    '部分止盈': 'var(--accent-red)',
    '持有': 'var(--accent-red)',
    '观望': 'var(--text-secondary)'
  };
  const color = actionColors[actionType] || 'var(--text-secondary)';
  
  // 状态判断：基于盈亏和操作建议
  const getStatus = () => {
    if (actionType === '止损') return { text: '需止损', color: 'var(--accent-orange)' };
    if (actionType === '止盈' || actionType === '部分止盈') return { text: '可止盈', color: 'var(--accent-red)' };
    if (actionType === '卖出') return { text: '建议卖出', color: 'var(--accent-green)' };
    if (actionType === '舜帝买入') return { text: '舜帝买入', color: 'var(--accent-red)' };
    if (actionType === '加仓') return { text: '建议加仓', color: 'var(--accent-red)' };
    if (profitPct < -5) return { text: '亏损较大', color: 'var(--accent-orange)' };
    if (profitPct > 5) return { text: '盈利良好', color: 'var(--accent-red)' };
    return { text: '持有中', color: 'var(--text-secondary)' };
  };
  const status = getStatus();
  
  // 信号紧急度（剩余时间）
  const getExpiryLabel = () => {
    if (signalExpiryHours <= 1) return { text: `${signalExpiryHours}小时`, urgent: true };
    if (signalExpiryHours <= 4) return { text: `${signalExpiryHours}小时`, urgent: false };
    return { text: `${signalExpiryHours}小时`, urgent: false };
  };
  const expiry = getExpiryLabel();

  return (
    <div className="decision-card" style={{
      background: 'var(--bg-secondary)',
      border: `1px solid ${isUrgent ? 'var(--accent-orange)' : 'var(--border-color)'}`,
      borderRadius: '10px',
      padding: '12px 14px',
      marginBottom: '8px',
      opacity: actionType === '持有' ? 0.85 : 1
    }}>
      {/* 头部：股票信息 + 状态 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: '600', fontSize: '14px' }}>{stock}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{code}</span>
            <span style={{ 
              fontSize: '10px', 
              padding: '2px 6px',
              background: status.color + '22',
              color: status.color,
              borderRadius: '4px',
              overflow: 'hidden',
              minWidth: 0 }}>{status.text}</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {shares > 0 ? `持仓 ${shares}股 · 成本 ¥${Number(avgCost).toFixed(2)}` : '暂无持仓'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: getProfitColor(profitPct) }}>
            {profitPct >= 0 ? '+' : ''}{Number(profitPct).toFixed(2)}%
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            ¥{Number(currentPrice).toFixed(2)}
          </div>
        </div>
      </div>
      
      {/* 风控价格区：止损价 + 目标价 */}
      {(stopLossPrice > 0 || targetPrice > 0) && (
        <div style={{ 
          display: 'flex', 
          gap: '12px', 
          marginBottom: '8px',
          padding: '8px 10px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
          overflow: 'hidden',
          minWidth: 0 }}>
          {stopLossPrice > 0 && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: 'var(--accent-green)' }}>止损价</div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent-green)' }}>
                ¥{Number(stopLossPrice).toFixed(2)}
                <span style={{ fontSize: '10px', fontWeight: 'normal', marginLeft: '4px' }}>
                  ({potentialLoss}%)
                </span>
              </div>
            </div>
          )}
          {targetPrice > 0 && (
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--accent-red)' }}>目标价</div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent-red)' }}>
                ¥{Number(targetPrice).toFixed(2)}
                <span style={{ fontSize: '10px', fontWeight: 'normal', marginLeft: '4px' }}>
                  (+{potentialGain}%)
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* 操作建议区 */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '10px',
        padding: '10px 12px',
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        overflow: 'hidden',
        minWidth: 0 }}>
        <span style={{
          padding: '4px 10px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: '600',
          background: color + '22',
          color,
          overflow: 'hidden',
          minWidth: 0 }}>
          {actionType}
        </span>
        <span style={{ flex: 1, fontSize: '12px', color: 'var(--text-secondary)' }}>
          {actionReason || '暂无操作建议'}
        </span>
        {priority <= 10 && (
          <span style={{ fontSize: '10px', color: 'var(--accent-orange)' }}>
            #{priority}
          </span>
        )}
      </div>
      
      {/* 时效性信息 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginTop: '8px',
        paddingTop: '8px',
        borderTop: '1px solid var(--border-color)',
        fontSize: '11px',
        color: 'var(--text-tertiary)'
      }}>
        <span>分析: {lastAnalysisTime || '--'}</span>
        <span style={{ color: expiry.urgent ? 'var(--accent-orange)' : 'var(--text-tertiary)' }}>
          有效: {expiry.text}
        </span>
        <span>检查: {nextCheckTime || '--'}</span>
      </div>
      
      {isUrgent && (
        <div style={{ fontSize: '11px', color: 'var(--accent-orange)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          ⚠ 紧急操作
        </div>
      )}
    </div>
  );
}

// 交易信号卡片
function SignalCard({ signal }) {
  const isBuy = signal.signal === 'buy';
  const color = isBuy ? 'var(--accent-red)' : 'var(--accent-green)';
  return (
    <div className="signal-card" style={{
      background: 'var(--bg-secondary)',
      border: `1px solid var(--border-color)`,
      borderRadius: '12px',
      padding: '12px 14px',
      marginBottom: '10px',
      overflow: 'hidden',
      minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div>
          <span style={{ fontWeight: '600', fontSize: '15px' }}>{signal.name || signal.code}</span>
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: '8px' }}>{signal.code}</span>
        </div>
        <span style={{
          padding: '4px 12px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: '600',
          background: isBuy ? 'rgba(255,59,48,0.15)' : 'rgba(52,199,89,0.15)',
          color,
          overflow: 'hidden',
          minWidth: 0 }}>
          {isBuy ? '买入' : '卖出'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        <span>置信度 <strong style={{ color }}>{signal.confidence != null ? Number(signal.confidence).toFixed(0) : '--'}%</strong></span>
        <span>现价 ¥{signal.price != null ? Number(signal.price).toFixed(2) : '--'}</span>
        {signal.target_price && <span>目标 ¥{Number(signal.target_price).toFixed(2)}</span>}
      </div>
      {signal.reason && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
          {signal.reason}
        </div>
      )}
    </div>
  );
}

// 尧帝五维评分迷你条
function YaodiScoreBar({ label, value, color }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
      <span style={{ width: '28px', color: 'var(--text-tertiary)', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: '6px', background: 'var(--bg-primary)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ width: '24px', textAlign: 'right', color: 'var(--text-secondary)', flexShrink: 0 }}>{value}</span>
    </div>
  );
}

// 舜帝模拟盘持仓卡片
function ShundiHoldingCard({ holding, onSell }) {
  const profit = holding.profit || 0;
  const profitPct = (holding.profit_percent || 0);
  const isUp = profit >= 0;
  const ya = holding.yaodi_analysis || {};
  const scores = ya.scores || {};
  const atr = ya.atr || {};
  const sig = ya.signal || {};
  const bs = ya.black_swan || {};
  const rec = ya.recommendation || '-';
  const recColor = rec === '强烈推荐' ? 'var(--accent-red)' : rec === '推荐' ? '#FF9500' : rec === '观察' ? 'var(--text-secondary)' : 'var(--accent-green)';
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: `1px solid ${bs.active ? '#FF3B30' : 'var(--border-color)'}`,
      borderRadius: '10px',
      padding: '12px 14px',
      marginBottom: '10px',
      overflow: 'visible',
      minWidth: 0,
      borderLeft: bs.active ? '3px solid #FF3B30' : scores.final >= 70 ? '3px solid var(--accent-red)' : 'none' }}>
      {/* 头部：名称+代码+股份+尧帝评分 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: '600', fontSize: '14px' }}>{holding.name}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{holding.code}</span>
          {(holding.is_favorite === 1 || holding.is_favorite === true) && <span style={{ fontSize: '10px' }}>⭐</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {scores.final != null && (
            <span style={{
              padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
              background: scores.final >= 70 ? 'rgba(255,59,48,0.12)' : scores.final >= 55 ? 'rgba(255,149,0,0.12)' : 'rgba(142,142,147,0.12)',
              color: scores.final >= 70 ? 'var(--accent-red)' : scores.final >= 55 ? '#FF9500' : 'var(--text-tertiary)' }}>
              {scores.final}分
            </span>
          )}
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{holding.shares}股</span>
        </div>
      </div>

      {/* 价格行 - 使用 flex-wrap 防止溢出 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '13px', marginBottom: '4px' }}>
        <span style={{ color: 'var(--text-secondary)' }}>成本 ¥{holding.avg_cost != null ? Number(holding.avg_cost).toFixed(2) : '--'}</span>
        <span style={{ color: 'var(--text-secondary)' }}>现价 ¥{holding.current_price != null ? Number(holding.current_price).toFixed(2) : '--'}</span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>市值¥{holding.market_value != null ? Number(holding.market_value).toFixed(0) : '--'}</span>
      </div>

      {/* 盈亏+信号行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div style={{ fontSize: '14px', fontWeight: '600', color: isUp ? 'var(--accent-red)' : 'var(--accent-green)' }}>
          {isUp ? '+' : ''}{Number(profit).toFixed(2)} ({profitPct >= 0 ? '+' : ''}{Number(profitPct).toFixed(2)}%)
        </div>
        {sig.type && sig.type !== '-' && (
          <span style={{
            padding: '1px 6px', borderRadius: '4px', fontSize: '11px',
            background: sig.type === 'buy' ? 'rgba(255,59,48,0.12)' : 'rgba(52,199,89,0.12)',
            color: sig.type === 'buy' ? 'var(--accent-red)' : 'var(--accent-green)' }}>
            {sig.type === 'buy' ? '📈买入' : '📉卖出'} {sig.confidence}%
          </span>
        )}
      </div>

      {/* ATR止损止盈行 */}
      {atr.stop_loss && (
        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
          <span>🛡止损 <b style={{ color: 'var(--accent-green)' }}>¥{atr.stop_loss}</b></span>
          <span>🎯止盈 <b style={{ color: 'var(--accent-red)' }}>¥{atr.take_profit}</b></span>
          {rec !== '-' && <span style={{ color: recColor }}>{rec}</span>}
        </div>
      )}

      {/* 黑天鹅警告 */}
      {bs.active && (
        <div style={{ padding: '4px 8px', background: 'rgba(255,59,48,0.08)', borderRadius: '4px', fontSize: '11px', color: '#FF3B30', marginBottom: '6px' }}>
          ⚠️ 黑天鹅: {bs.title}
        </div>
      )}

      {/* 展开/收起尧帝五维评分 */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={() => setShowDetail(!showDetail)} style={{
          background: 'none', border: 'none', color: 'var(--text-tertiary)', fontSize: '11px',
          cursor: 'pointer', padding: '2px 8px' }}>
          尧帝五维 {showDetail ? '▲' : '▼'}
        </button>
      </div>
      {showDetail && (
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <YaodiScoreBar label="技术" value={scores.tech || 0} color="#5AC8FA" />
          <YaodiScoreBar label="动量" value={scores.momentum || 0} color="#FF9500" />
          <YaodiScoreBar label="均值" value={scores.meanReversion || 0} color="#34C759" />
          <YaodiScoreBar label="支撑" value={scores.support || 0} color="#AF52DE" />
          <YaodiScoreBar label="尧帝" value={scores.yaodi || 0} color="#FF3B30" />
          {sig.reason && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>💡 {sig.reason}</div>}
          {ya.best_strategy && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>🧬 {ya.best_strategy.name} Lv.{ya.best_strategy.level} ({ya.best_strategy.accuracy}%)</div>}
        </div>
      )}

      {onSell && (
        <button onClick={() => onSell(holding)} style={{
          marginTop: '8px', width: '100%', padding: '6px 12px',
          background: 'var(--accent-green)', color: 'white', border: 'none',
          borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
          卖出
        </button>
      )}
    </div>
  );
}

// 舜帝模拟盘交易记录卡片
function ShundiTradeCard({ trade }) {
  const isBuy = trade.type === 'buy';
  const pnlColor = trade.pnl > 0 ? 'var(--accent-red)' : trade.pnl < 0 ? 'var(--accent-green)' : 'var(--text-secondary)';
  
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '8px',
      padding: '10px 12px',
      marginBottom: '8px',
      fontSize: '12px',
      overflow: 'hidden',
      minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontWeight: '600' }}>{trade.name} ({trade.code})</span>
        <span style={{
          padding: '2px 8px',
          borderRadius: '4px',
          background: isBuy ? 'rgba(255,59,48,0.15)' : 'rgba(52,199,89,0.15)',
          color: isBuy ? 'var(--accent-red)' : 'var(--accent-green)',
          overflow: 'hidden',
          minWidth: 0 }}>
          {isBuy ? '买入' : '卖出'}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
        <span>{trade.shares}股 @ ¥{trade.price != null ? Number(trade.price).toFixed(2) : '--'}</span>
        <span>金额: ¥{trade.amount != null ? Number(trade.amount).toFixed(0) : '--'}</span>
      </div>
      {!isBuy && trade.pnl !== 0 && (
        <div style={{ marginTop: '4px', color: pnlColor, fontWeight: '600' }}>
          盈亏: {trade.pnl > 0 ? '+' : ''}{trade.pnl != null ? Number(trade.pnl).toFixed(2) : '--'}
        </div>
      )}
      <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
        {formatBJTimeFull(trade.created_at || trade.filled_time)}
      </div>
    </div>
  );
}

export default function RedQueen() {
  const [activeTab, setActiveTab] = useState('trading'); // trading | simulation
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qlearning, setQlearning] = useState(null);
  const [sentiment, setSentiment] = useState(null);
  const [position, setPosition] = useState(null);
  const [decision, setDecision] = useState(null);
  const [signals, setSignals] = useState([]);
  const [learningHistory, setLearningHistory] = useState([]);
  const [marketEnv, setMarketEnv] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [rlStatus, setRlStatus] = useState(null);
  const [masters, setMasters] = useState([]);
  const [autonomous, setAutonomous] = useState(null);
  const [executorConfig, setExecutorConfig] = useState(null);
  
  // 舜帝模拟盘状态
  const [shundiCapital, setShundiCapital] = useState(null);
  const [editTotalCapital, setEditTotalCapital] = useState('');
  const [showEditTotal, setShowEditTotal] = useState(false);
  const [shundiHoldings, setShundiHoldings] = useState([]);
  const [shundiTrades, setShundiTrades] = useState([]);
  const [tradePage, setTradePage] = useState(1);
  const [tradeTotal, setTradeTotal] = useState(0);
  const [tradeStartDate, setTradeStartDate] = useState('');
  const [tradeEndDate, setTradeEndDate] = useState('');
  const [tradeType, setTradeType] = useState('');

  // 舜帝交易类型 → 买/卖方向映射（加仓/新仓 = 买入，止损/止盈/sell = 卖出）
  const getTradeDir = (type) =>
    type && ['buy','舜帝买入','舜帝加仓','智能选股新仓','加仓','尧帝信号执行','高抛低吸·买入'].includes(type) ? 'buy' : 'sell';
  const [shundiStats, setShundiStats] = useState(null);
  const [shundiLoading, setShundiLoading] = useState(false);
  const [shundiEngineRunning, setShundiEngineRunning] = useState(false);  // 新增：引擎状态
  
  // 手动交易弹窗状态
  const [tradeModal, setTradeModal] = useState({ show: false, type: 'buy', holding: null });
  const [tradeShares, setTradeShares] = useState(100);
  const [buyCode, setBuyCode] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyShares, setBuyShares] = useState(100);
  const [buyStockName, setBuyStockName] = useState('');
  const [buyStockLoading, setBuyStockLoading] = useState(false);

  // 自动匹配股票名称（输入代码时）
  useEffect(() => {
    if (!buyCode || buyCode.length < 4) {
      setBuyStockName('');
      return;
    }
    const timer = setTimeout(async () => {
      setBuyStockLoading(true);
      try {
        const res = await fetch(`${API_BASE}/stock/${buyCode}`);
        const data = await res.json();
        if (data.success && data.name) {
          setBuyStockName(data.name);
        } else {
          setBuyStockName('');
        }
      } catch (e) {
        setBuyStockName('');
      }
      setBuyStockLoading(false);
    }, 300); // 300ms 防抖
    return () => clearTimeout(timer);
  }, [buyCode]);

  const fetchAll = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/redqueen/status`);
      const data = await res.json();
      if (data.success) setStatus(data);
    } catch (e) {}
    
    try {
      const [qRes, sRes, pRes, dRes, sigRes, lhRes, envRes, rlRes, mastersRes, autoRes, execRes] = await Promise.all([
        fetch(`${API_BASE}/redqueen/qtable`),
        fetch(`${API_BASE}/sentiment/radar`),
        fetch(`${API_BASE}/position/engine`),
        learningAPI.decide().catch(() => ({ success: false })),
        fetch(`${API_BASE}/signals/list`).catch(() => null),
        fetch(`${API_BASE}/learning/history`).catch(() => null),
        fetch(`${API_BASE}/decision/environment`).catch(() => null),
        fetch(`${API_BASE}/smart/rl`).catch(() => null),
        fetch(`${API_BASE}/evolution/masters`).catch(() => null),
        fetch(`${API_BASE}/decision/autonomous`).catch(() => null),
        fetch(`${API_BASE}/executor/config`).catch(() => null),
      ]);
      const [q, s, p] = await Promise.all([qRes.json(), sRes.json(), pRes.json()]);
      if (q.success) setQlearning(q);
      if (s.success) setSentiment(s);
      if (p.success) setPosition(p);
      if (dRes.success) setDecision(dRes);
      if (sigRes) {
        const sigData = await sigRes.json();
        if (sigData.success) setSignals(sigData.signals || []);
      }
      if (lhRes) {
        const lhData = await lhRes.json();
        if (lhData.success) setLearningHistory(lhData.history || []);
      }
      if (envRes) {
        const envData = await envRes.json();
        if (envData.success) { const e = envData.environment || {}; const typeMap = { bullish: "bull", bearish: "bear", neutral: "neutral" }; setMarketEnv({ ...e, type: typeMap[e.environment] || "neutral" }); }
      }
      if (rlRes) {
        const rlData = await rlRes.json();
        if (rlData.success) setRlStatus(rlData.rl);
      }
      if (mastersRes) {
        const mastersData = await mastersRes.json();
        if (mastersData.success) setMasters(mastersData.masters || []);
      }
      if (autoRes) {
        const autoData = await autoRes.json();
        if (autoData.success) setAutonomous(autoData.decision);
      }
      if (execRes) {
        const execData = await execRes.json();
        if (execData.success) setExecutorConfig(execData.config);
      }
    } catch (e) {}
    
    setLoading(false);
  };

  // 获取舜帝交易记录（分页+时间筛选+类型筛选）
  const fetchShundiTrades = useCallback(async (page = 1, startDate = '', endDate = '', tradeTypeFilter = '') => {
    try {
      let url = `/api/shundi/trades?page=${page}&pageSize=20`;
      if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
      if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;
      if (tradeTypeFilter) url += `&type=${encodeURIComponent(tradeTypeFilter)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setShundiTrades(data.trades || []);
        setTradeTotal(data.pagination?.total || 0);
        setTradePage(data.pagination?.page || 1);
      }
    } catch (e) {
      console.error('获取舜帝交易记录失败:', e);
    }
  }, []);

  // 获取舜帝模拟盘数据
  const fetchShundiData = useCallback(async (showLoading = false) => {
    if (showLoading) setShundiLoading(true);
    try {
      const [capitalRes, holdingsRes, statsRes, engineRes] = await Promise.all([
        shundiAPI.getCapital(),
        shundiAPI.getHoldings(),
        shundiAPI.getStats(),
        shundiAPI.getEngineStatus(),
      ]);
      if (capitalRes.success) setShundiCapital(capitalRes.config);
      if (holdingsRes.success) setShundiHoldings(holdingsRes.holdings || []);
      if (statsRes.success) {
        setShundiStats(statsRes.stats);
      }
      if (engineRes.success) setShundiEngineRunning(engineRes.running);
      // 交易记录单独请求（带分页+时间筛选+类型筛选）
      await fetchShundiTrades(tradePage, tradeStartDate, tradeEndDate, tradeType);
    } catch (e) {
      console.error('获取舜帝模拟盘数据失败:', e);
    }
    if (showLoading) setShundiLoading(false);
  }, [tradePage, tradeStartDate, tradeEndDate, tradeType, fetchShundiTrades]);

  // 控制舜帝引擎（新增）
  const handleShundiEngineToggle = async () => {
    try {
      if (shundiEngineRunning) {
        await shundiAPI.stopEngine();
      } else {
        await shundiAPI.startEngine();
      }
      await fetchShundiData(true);  // 首次加载显示loading
    } catch (e) {
      console.error('控制舜帝引擎失败:', e);
    }
  };

  useEffect(() => {
    fetchAll(true);  // 首次加载显示loading
    const t = setInterval(fetchAll, 30000);
    return () => clearInterval(t);
  }, []);

  // 市场状态（自动刷新）
  const [marketStatus, setMarketStatus] = useState(getMarketStatus());
  useEffect(() => {
    const timer = setInterval(() => setMarketStatus(getMarketStatus()), 10000);
    return () => clearInterval(timer);
  }, []);
  const fetchShundiRef = useRef(fetchShundiData);
  useEffect(() => { fetchShundiRef.current = fetchShundiData; }, [fetchShundiData]);

  useEffect(() => {
    fetchShundiRef.current();
    const t = setInterval(() => fetchShundiRef.current(), 5000);
    return () => clearInterval(t);
  }, []); // 空依赖，组件生命周期内永不停止

  const handleToggle = async () => {
    setToggling(true);
    try {
      const newState = !status?.redqueen?.running;
      await fetch(`${API_BASE}/redqueen/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: newState ? 'start' : 'stop' })
      });
      await fetchAll();
    } catch (e) {}
    setToggling(false);
  };

  // 舜帝模拟盘交易
  const handleShundiTrade = async (type, holding) => {
    try {
      const price = holding.current_price;
      const shares = type === 'sell' ? holding.shares : Math.floor((shundiCapital?.available_capital || 1000000) * 0.02 / price / 100) * 100; // A股规则：单笔最多2%可用资金，100股整数倍
      if (shares < 100) {
        alert('资金不足以买入100股');
        return;
      }
      const result = await shundiAPI.trade({
        type,
        code: holding.code,
        name: holding.name,
        price,
        shares,
        reason: type === 'buy' ? '舜帝买入信号' : '舜帝卖出信号',
        confidence: 75
      });
      if (result.success) {
        alert(result.message);
        fetchShundiData();
      } else {
        alert(result.error || '交易失败');
      }
    } catch (e) {
      alert('交易失败: ' + e.message);
    }
  };


  // 手动卖出
  const handleManualSell = async () => {
    if (!tradeModal.holding || tradeShares <= 0) return;
    try {
      const result = await shundiAPI.trade({
        type: 'sell',
        code: tradeModal.holding.code,
        name: tradeModal.holding.name,
        price: tradeModal.holding.current_price,
        shares: tradeShares,
        reason: '手动卖出',
        confidence: 50
      });
      if (result.success) {
        setTradeModal({ show: false, type: 'buy', holding: null });
        setTradeShares(100);
        fetchShundiData();
      } else {
        alert(result.error || '卖出失败');
      }
    } catch (e) {
      alert('卖出失败: ' + e.message);
    }
  };

  // 手动买入
  const handleManualBuy = async () => {
    if (!buyCode || !buyPrice || buyShares < 100) {
      alert('请填写完整信息');
      return;
    }
    try {
      // 使用已匹配的股票名称，或重新获取
      let stockName = buyStockName;
      if (!stockName) {
        const stockRes = await fetch(`${API_BASE}/stock/${buyCode}`);
        const stockData = await stockRes.json();
        stockName = stockData?.name || buyCode;
      }
      
      const result = await shundiAPI.trade({
        type: 'buy',
        code: buyCode,
        name: stockName,
        price: parseFloat(buyPrice),
        shares: parseInt(buyShares),
        reason: '手动买入',
        confidence: 50
      });
      if (result.success) {
        setTradeModal({ show: false, type: 'buy', holding: null });
        setBuyCode('');
        setBuyPrice('');
        setBuyShares(100);
        setBuyStockName('');
        fetchShundiData();
      } else {
        alert(result.error || '买入失败');
      }
    } catch (e) {
      alert('买入失败: ' + e.message);
    }
  };

  // 保存用户编辑的总资产
  const handleSaveTotalCapital = async () => {
    const total = parseFloat(editTotalCapital);
    if (isNaN(total) || total <= 0) {
      alert('请输入有效的总资产金额');
      return;
    }
    try {
      const res = await shundiAPI.setCapital({ total_capital: total });
      if (res.success) {
        setShundiCapital(res.config);
        setShowEditTotal(false);
      }
    } catch (e) {
      console.error('保存总资产失败:', e);
    }
  };

  if (loading) return <div className="loading"><div className="loading-spinner" /></div>;

  const rq = status?.redqueen || {};
  const { decisions = [], execution = {} } = rq;
  const isRunning = status?.redqueen?.running;
  const posRatio = execution.positionRatio || 0;

  return (
    <div className="redqueen-page">
      {/* 页面标题 */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">
              舜帝交易中心{' '}
              <span style={{
                fontSize: '0.55em',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '4px',
                background: marketStatus === '交易中' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.08)',
                color: marketStatus === '交易中' ? '#22c55e' : 'var(--text-quaternary)',
                border: marketStatus === '交易中' ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(255,255,255,0.1)',
                verticalAlign: 'middle',
                letterSpacing: '0.05em',
              }}>
                {marketStatus === '交易中' ? '● 交易时间' : '○ 非交易时间'}
              </span>
            </h1>
            <p className="page-subtitle">
              自主交易决策引擎{' '}
              <span style={{ color: '#60a5fa', fontWeight: 600 }}>
                V{shundiStats?.mainVersion ?? '?'}
              </span>
            </p>
          </div>
          {/* 主开关 */}
          <button
            className={`power-btn ${isRunning ? 'running' : ''}`}
            onClick={handleToggle}
            disabled={toggling}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>
            </svg>
            {toggling ? '切换中...' : isRunning ? '运行中' : '已停止'}
          </button>
        </div>
      </div>

      {/* Tab切换 */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '14px',
        padding: '3px',
        background: 'var(--bg-secondary)',
        borderRadius: '10px',
        width: 'fit-content',
        overflow: 'hidden',
        minWidth: 0 }}>
        <button
          onClick={() => setActiveTab('trading')}
          style={{
            padding: '8px 20px',
            borderRadius: '8px',
            border: 'none',
            background: activeTab === 'trading' ? 'var(--accent-blue)' : 'transparent',
            color: activeTab === 'trading' ? 'white' : 'var(--text-secondary)',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s' }}
        >
          交易决策
        </button>
        <button
          onClick={() => setActiveTab('simulation')}
          style={{
            padding: '8px 20px',
            borderRadius: '8px',
            border: 'none',
            background: activeTab === 'simulation' ? 'var(--accent-orange)' : 'transparent',
            color: activeTab === 'simulation' ? 'white' : 'var(--text-secondary)',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s' }}
        >
          舜帝模拟盘
        </button>
      </div>

      {/* 市场环境条 */}
      {marketEnv && activeTab === 'trading' && (
        <div className="market-env-bar" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          padding: '8px 20px',
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          marginBottom: '14px',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
          minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>
              {marketEnv.type === 'bull' ? '🐂' : marketEnv.type === 'bear' ? '🐻' : '🔄'}
            </span>
            <div>
              <div style={{ fontWeight: '600', fontSize: '15px', color: 
                marketEnv.type === 'bull' ? 'var(--accent-red)' : 
                marketEnv.type === 'bear' ? 'var(--accent-green)' : 'var(--accent-orange)'
              }}>
                {marketEnv.type === 'bull' ? '牛市环境' : marketEnv.type === 'bear' ? '熊市环境' : '震荡市'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                置信度 {marketEnv.confidence ? marketEnv.confidence + '%' : '--'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span>涨跌比 <strong>{marketEnv.upDownRatio != null ? marketEnv.upDownRatio.toFixed(2) : '--'}</strong></span>
            <span>涨停 <strong style={{ color: 'var(--accent-red)' }}>{marketEnv.limitUp ?? 0}</strong></span>
            <span>跌停 <strong style={{ color: 'var(--accent-green)' }}>{marketEnv.limitDown ?? 0}</strong></span>
            <span>北向 <strong style={{ color: (marketEnv.northFlow ?? 0) >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
              {marketEnv.northNote
                ? <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{marketEnv.northNote}</span>
                : <>
                    {(marketEnv.northFlow ?? 0) >= 0 ? '+' : ''}{(marketEnv.northFlow ?? 0).toFixed(0)}亿
                  </>
              }
            </strong></span>
          </div>
        </div>
      )}

      {/* 交易决策Tab */}
      {activeTab === 'trading' && (
        <div className="redqueen-grid">
          {/* 左列：核心状态 */}
          <div className="rq-col-left">
            {/* 运行状态 */}
            <div className="rq-card">
              <h3 className="rq-card-title">运行状态</h3>
              <div className="status-list">
                <div className="status-item">
                  <StatusDot active={isRunning} />
                  <span>自主决策引擎</span>
                  <span className={isRunning ? 'status-on' : 'status-off'}>{isRunning ? '运行中' : '已停止'}</span>
                </div>
                <div className="status-item">
                  <StatusDot active={!!qlearning} />
                  <span>Q-Learning</span>
                  <span className="status-on">{qlearning ? `${qlearning.statesCount || 0}个状态` : '未激活'}</span>
                </div>
                <div className="status-item">
                  <StatusDot active={!!sentiment} />
                  <span>舆情雷达</span>
                  <span className="status-on">{sentiment ? `情绪${sentiment.fearGreedIndex || 50}` : '未激活'}</span>
                </div>
                <div className="status-item">
                  <StatusDot active={!!position} />
                  <span>仓位引擎</span>
                  <span className="status-on">{position ? `${posRatio}%` : '未激活'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 中列：决策信号 */}
          <div className="rq-col-mid">
            <div className="rq-card rq-card-full">
              <div className="rq-card-header">
                <h3 className="rq-card-title">决策信号</h3>
                <span className="badge badge-info">{decisions.length}个信号</span>
              </div>
              {decisions.length > 0 ? (
                <div className="decisions-list">
                  {decisions.slice(0, 8).map((d, i) => (
                    <DecisionCard key={i} decision={d} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                  </svg>
                  <p>暂无决策信号</p>
                  <span>{isRunning ? '等待市场机会...' : '启动舜帝以开始分析'}</span>
                </div>
              )}
            </div>
          </div>

          {/* 右列：智能分析 */}
          <div className="rq-col-right">
            {/* 舆情雷达 */}
            {sentiment && (
              <div className="rq-card">
                <h3 className="rq-card-title">市场情绪</h3>
                <div className="sentiment-gauge">
                  <div className="gauge-value" style={{
                    color: sentiment.fearGreedIndex > 60 ? 'var(--accent-red)' : 
                           sentiment.fearGreedIndex < 40 ? 'var(--accent-green)' : 'var(--text-primary)'
                  }}>
                    {sentiment.fearGreedIndex || 50}
                  </div>
                  <div className="gauge-label">
                    {sentiment.fearGreedIndex > 60 ? '贪婪' : 
                     sentiment.fearGreedIndex < 40 ? '恐惧' : '中性'}
                  </div>
                </div>
                <div className="metrics-list">
                  <MetricRow label="牛熊比" value={(sentiment.bullBearRatio || 0).toFixed(2)} />
                  <MetricRow label="综合情绪" value={(sentiment.overallSentiment || 0).toFixed(2)} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 舜帝模拟盘Tab - 专业版 */}
      {activeTab === 'simulation' && (
        <div style={{ padding: '24px' }}>
          {/* 头部标题区 */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '24px',
            padding: '20px 24px',
            background: 'linear-gradient(135deg, rgba(22,119,255,0.1) 0%, rgba(114,46,209,0.1) 100%)',
            borderRadius: '16px',
            border: '1px solid rgba(22,119,255,0.2)',
            overflow: 'hidden',
            minWidth: 0 }}>
            <div>
              <h2 style={{ 
                fontSize: '24px', 
                fontWeight: '700', 
                marginBottom: '4px',
                background: 'linear-gradient(90deg, #1677ff, #722ed1)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}>舜帝模拟盘</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>AI自主交易 · {(shundiCapital?.total_capital || 1000000) >= 100000000 ? '资金池' : `¥${(((shundiCapital?.total_capital || 1000000) / 10000) || 100)?.toFixed(0)}万初始资金`} · 实时盈亏追踪</p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {/* 引擎控制按钮 */}
              <button
                onClick={handleShundiEngineToggle}
                style={{
                  padding: '10px 20px',
                  background: shundiEngineRunning ? 'rgba(52,199,89,0.15)' : 'var(--bg-card)',
                  border: `1px solid ${shundiEngineRunning ? 'var(--accent-green)' : 'var(--border-color)'}`,
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: shundiEngineRunning ? 'var(--accent-green)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => { 
                  e.target.style.background = shundiEngineRunning ? 'rgba(52,199,89,0.25)' : 'var(--bg-hover)'; 
                }}
                onMouseLeave={e => { 
                  e.target.style.background = shundiEngineRunning ? 'rgba(52,199,89,0.15)' : 'var(--bg-card)'; 
                }}
              >
                <span style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: shundiEngineRunning ? 'var(--accent-green)' : 'var(--text-tertiary)',
                  animation: shundiEngineRunning ? 'pulse 2s infinite' : 'none' }}/>
                {shundiEngineRunning ? '引擎运行中' : '启动引擎'}
              </button>
            </div>
          </div>

          {shundiLoading ? (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center',
              height: '300px',
              color: 'var(--text-tertiary)'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ 
                  width: '40px', 
                  height: '40px', 
                  border: '3px solid var(--border-color)', 
                  borderTopColor: 'var(--accent-blue)',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto 16px' }}/>
                <p>加载数据中...</p>
              </div>
            </div>
          ) : (
            // 舜帝模拟盘主体：三列等高布局（flex 等高，max-height 控制溢出滚动）
            <div style={{ display: 'flex', gap: '20px', minWidth: 0, overflow: 'hidden', alignItems: 'stretch' }}>
              {/* 左侧：资金概览（固定宽度） */}
              <div style={{ flex: '0 0 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* 总资产卡片 */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '24px',
                  marginBottom: '16px',
                  overflow: 'hidden',
                  minWidth: 0 }}>
                  {showEditTotal ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input
                        type="number"
                        value={editTotalCapital}
                        onChange={e => setEditTotalCapital(e.target.value)}
                        placeholder="输入总资产（元）"
                        autoFocus
                        style={{
                          width: '100%', padding: '10px', fontSize: '16px',
                          border: '1px solid var(--accent-blue)', borderRadius: '8px',
                          background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                          outline: 'none'
                        }}
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => { setShowEditTotal(false); setEditTotalCapital(''); }}
                          style={{ flex: 1, padding: '8px', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px' }}
                        >取消</button>
                        <button
                          onClick={handleSaveTotalCapital}
                          style={{ flex: 1, padding: '8px', border: 'none', borderRadius: '8px', background: 'var(--accent-blue)', color: 'white', cursor: 'pointer', fontSize: '13px' }}
                        >保存</button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => { setEditTotalCapital(String(shundiCapital?.total_capital || 1000000)); setShowEditTotal(true); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        总资产 <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>（点击编辑）</span>
                      </div>
                      <div style={{ 
                        fontSize: '36px', 
                        fontWeight: '700',
                        color: getProfitColor(shundiStats?.totalProfit ?? 0)
                      }}>
                        ¥{((shundiStats?.totalAssets || shundiCapital?.total_capital || 1000000) / 10000)?.toFixed(2)}万
                      </div>
                    </div>
                  )}
                  {shundiStats && (
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      marginTop: '12px',
                      padding: '8px 12px',
                      background: shundiStats.totalProfit > 0 ? 'rgba(255,59,48,0.1)' : shundiStats.totalProfit < 0 ? 'rgba(52,199,89,0.1)' : 'rgba(255,152,0,0.1)',
                      borderRadius: '8px',
                      width: 'fit-content',
                      overflow: 'hidden',
                      minWidth: 0 }}>
                      <span style={{
                        fontSize: '14px',
                        fontWeight: '600',
                        color: getProfitColor(shundiStats.totalProfit)
                      }}>
                        {shundiStats.totalProfit > 0 ? '+' : shundiStats.totalProfit < 0 ? '' : ''}{shundiStats.totalProfit != null ? Number(shundiStats.totalProfit).toFixed(2) : '--'}
                      </span>
                      <span style={{
                        fontSize: '12px',
                        color: getProfitColor(shundiStats.totalReturn)
                      }}>
                        ({(shundiStats.totalReturn > 0 ? '+' : shundiStats.totalReturn < 0 ? '-' : '')}{shundiStats.totalReturn}%)
                      </span>
                    </div>
                  )}
                </div>

                {/* 资金分布 */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '20px',
                  overflow: 'hidden',
                  minWidth: 0,
                }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '16px' }}>资金分布</h3>
                  {shundiCapital && (
                    <>
                      <div style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>可用资金</span>
                          <span style={{ fontSize: '14px', fontWeight: '600' }}>¥{(shundiCapital.available_capital / 10000)?.toFixed(2)}万</span>
                        </div>
                        <div style={{ 
                          height: '6px', 
                          background: 'var(--bg-tertiary)', 
                          borderRadius: '3px',
                          overflow: 'hidden',
                          minWidth: 0 }}>
                          <div style={{
                            height: '100%',
                            width: `${(shundiCapital.available_capital / shundiCapital.total_capital) * 100}%`,
                            background: 'var(--accent-blue)',
                            borderRadius: '3px'
                          }}/>
                        </div>
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>持仓市值</span>
                          <span style={{ fontSize: '14px', fontWeight: '600' }}>¥{((shundiCapital.used_capital || 0) / 10000)?.toFixed(2)}万</span>
                        </div>
                        <div style={{ 
                          height: '6px', 
                          background: 'var(--bg-tertiary)', 
                          borderRadius: '3px',
                          overflow: 'hidden',
                          minWidth: 0 }}>
                          <div style={{
                            height: '100%',
                            width: `${((shundiCapital.used_capital || 0) / shundiCapital.total_capital) * 100}%`,
                            background: 'var(--accent-orange)',
                            borderRadius: '3px'
                          }}/>
                        </div>
                      </div>
                    </>
                  )}

                  {/* 交易统计 */}
                  {shundiStats && (
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: '1fr 1fr',
                      gap: '12px',
                      marginTop: '20px',
                      paddingTop: '16px',
                      borderTop: '1px solid var(--border-color)',
                      minWidth: 0,
                      overflow: 'hidden'
                    }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--accent-blue)' }}>{shundiStats.totalTrades || 0}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>总交易</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--accent-green)' }}>{shundiStats.winRate || 0}%</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>胜率</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 中间：持仓列表（max-height 限制 + 内部滚动） */}
              <div style={{ flex: '5 1 0', minWidth: '400px', maxHeight: '580px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '20px',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  minWidth: 0 }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '16px'
                  }}>
                    <h3 style={{ fontSize: '15px', fontWeight: '600' }}>当前持仓</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <button
                        onClick={() => setTradeModal({ show: true, type: 'buy', holding: null })}
                        style={{
                          padding: '4px 12px',
                          background: 'rgba(255,59,48,0.15)',
                          border: '1px solid var(--accent-red)',
                          borderRadius: '6px',
                          color: 'var(--accent-red)',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer' }}
                      >
                        + 买入
                      </button>
                      <span style={{ 
                        fontSize: '12px', 
                        padding: '4px 10px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: '12px',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        minWidth: 0 }}>{shundiHoldings.length} 只</span>
                    </div>
                  </div>

                  {shundiHoldings.length === 0 ? (
                    <div style={{ 
                      textAlign: 'center', 
                      padding: '60px 20px',
                      color: 'var(--text-tertiary)'
                    }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 16px', opacity: 0.5 }}>
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M3 9h18"/>
                      </svg>
                      <p>暂无持仓</p>
                      <p style={{ fontSize: '12px', marginTop: '4px' }}>等待舜帝发出买入信号...</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, minHeight: 0, overflowX: 'hidden' }}>
                      {shundiHoldings.map((h, i) => (
                        <ShundiHoldingCard key={h.code || `shundi-${i}`} holding={h} onSell={(holding) => {
                          setTradeModal({ show: true, type: 'sell', holding });
                          setTradeShares(Math.min(100, holding.shares));
                        }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧：交易记录（max-height 限制 + 内部滚动） */}
              <div style={{ flex: '3 1 0', minWidth: 0, maxHeight: '580px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '20px',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  minWidth: 0 }}>
                  {/* 标题栏 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: '600' }}>交易记录</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      共 {tradeTotal} 条
                    </span>
                  </div>

                  {/* 筛选栏：类型 + 时间 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {/* 类型筛选 */}
                      <select
                        value={tradeType}
                        onChange={e => { setTradeType(e.target.value); setTradePage(1); }}
                        style={{
                          padding: '6px 8px',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                          minWidth: '90px',
                          overflow: 'hidden'}}
                      >
                        <option value="">全部类型</option>
                        <option value="buy">买入</option>
                        <option value="舜帝买入">舜帝买入</option>
                        <option value="智能选股新仓">智能选股新仓</option>
                        <option value="加仓">加仓</option>
                        <option value="舜帝加仓">舜帝加仓</option>
                        <option value="sell">卖出</option>
                        <option value="ATR止盈">ATR止盈</option>
                        <option value="ATR止损">ATR止损</option>
                      </select>

                      {/* 开始日期 */}
                      <input
                        type="date"
                        value={tradeStartDate}
                        onChange={e => { setTradeStartDate(e.target.value); setTradePage(1); }}
                        style={{
                          flex: 1, padding: '6px 8px',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '12px' }}
                      />
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', flexShrink: 0 }}>至</span>
                      <input
                        type="date"
                        value={tradeEndDate}
                        onChange={e => { setTradeEndDate(e.target.value); setTradePage(1); }}
                        style={{
                          flex: 1, padding: '6px 8px',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '12px' }}
                      />
                    </div>

                    {/* 操作按钮 */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => fetchShundiTrades(1, tradeStartDate, tradeEndDate, tradeType)}
                        style={{
                          padding: '6px 14px',
                          background: 'var(--accent-orange)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          fontWeight: '600' }}
                      >筛选</button>
                      {(tradeStartDate || tradeEndDate || tradeType) && (
                        <button
                          onClick={() => {
                            setTradeStartDate(''); setTradeEndDate(''); setTradeType('');
                            setTradePage(1);
                            fetchShundiTrades(1, '', '', '');
                          }}
                          style={{
                            padding: '6px 10px',
                            background: 'transparent',
                            color: 'var(--text-tertiary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: 'pointer' }}
                        >清空</button>
                      )}
                    </div>
                  </div>

                  {/* 交易列表（内部滚动） */}
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px', minHeight: 0 }}>
                    {shundiTrades.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
                        <p style={{ fontSize: '13px' }}>暂无交易记录</p>
                      </div>
) : (
                      shundiTrades.map((t, i) => (
                        <div key={t.id || `trade-${i}`} style={{
                          padding: '10px 12px',
                          background: 'var(--bg-secondary)',
                          borderRadius: '8px',
                          borderLeft: `3px solid ${getTradeDir(t.type) === 'buy' ? 'var(--accent-red)' : 'var(--accent-green)'}`
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                            <span style={{ fontSize: '13px', fontWeight: '600' }}>{t.name}</span>
                            <span style={{
                              fontSize: '11px', padding: '2px 7px', borderRadius: '4px',
                              background: getTradeDir(t.type) === 'buy' ? 'rgba(255,59,48,0.15)' : 'rgba(52,199,89,0.15)',
                              color: getTradeDir(t.type) === 'buy' ? 'var(--accent-red)' : 'var(--accent-green)',
                              overflow: 'hidden',
                              minWidth: 0 }}>
                              {getTradeDir(t.type) === 'buy' ? '买入' : '卖出'} {t.typeName || t.type}
                            </span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {t.shares}股 × ¥{t.price != null ? Number(t.price).toFixed(2) : '--'}
                          </div>
                          <div style={{
                            fontSize: '12px', fontWeight: '600', marginTop: '3px',
                            color: getTradeDir(t.type) === 'buy' ? 'var(--text-secondary)' : (t.pnl > 0 ? 'var(--accent-green)' : t.pnl < 0 ? 'var(--accent-red)' : 'var(--text-secondary)')
                          }}>
                            {(getTradeDir(t.type) === 'sell' || t.typeName?.includes('卖出') || t.typeName?.includes('止损')) && t.pnl != null ? (
                              <>{t.pnl > 0 ? '+' : ''}{t.pnl != null ? Number(t.pnl).toFixed(2) : '--'}</>
                            ) : (
                              <>¥{t.amount != null ? Number(t.amount).toFixed(0) : '--'}</>
                            )}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-quaternary)', marginTop: '3px' }}>
                            {formatBJTimeFull(t.created_at || t.filled_time)}
                          </div>
                        </div>
                      ))  // end map
                    )}
                  </div>

                  {/* 分页 */}
                  {tradeTotal > 20 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        第 {tradePage} / {Math.ceil(tradeTotal / 20)} 页
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => { const p = tradePage - 1; setTradePage(p); fetchShundiTrades(p, tradeStartDate, tradeEndDate, tradeType); }}
                          disabled={tradePage <= 1}
                          style={{
                            padding: '4px 10px', fontSize: '12px',
                            background: tradePage <= 1 ? 'var(--bg-secondary)' : 'var(--accent-orange)',
                            color: tradePage <= 1 ? 'var(--text-tertiary)' : 'white',
                            border: 'none', borderRadius: '6px', cursor: tradePage <= 1 ? 'default' : 'pointer',
                            fontWeight: '600' }}
                        >上一页</button>
                        <button
                          onClick={() => { const p = tradePage + 1; setTradePage(p); fetchShundiTrades(p, tradeStartDate, tradeEndDate, tradeType); }}
                          disabled={tradePage >= Math.ceil(tradeTotal / 20)}
                          style={{
                            padding: '4px 10px', fontSize: '12px',
                            background: tradePage >= Math.ceil(tradeTotal / 20) ? 'var(--bg-secondary)' : 'var(--accent-orange)',
                            color: tradePage >= Math.ceil(tradeTotal / 20) ? 'var(--text-tertiary)' : 'white',
                            border: 'none', borderRadius: '6px', cursor: tradePage >= Math.ceil(tradeTotal / 20) ? 'default' : 'pointer',
                            fontWeight: '600' }}
                        >下一页</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 交易弹窗 */}
      {tradeModal.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '16px',
            padding: '24px',
            width: '360px',
            maxWidth: '90%',
            border: '1px solid var(--border-color)',
            overflow: 'hidden',
            minWidth: 0 }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700' }}>
                {tradeModal.type === 'buy' ? '手动买入' : `卖出 ${tradeModal.holding?.name}`}
              </h3>
              <button
                onClick={() => setTradeModal({ show: false, type: 'buy', holding: null })}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: '20px',
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>

            {tradeModal.type === 'buy' ? (
              <div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                    股票代码
                  </label>
                  <input
                    type="text"
                    value={buyCode}
                    onChange={e => setBuyCode(e.target.value.toUpperCase())}
                    placeholder="如: 600519"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '14px' }}
                  />
                  {buyStockLoading && (
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                      匹配中...
                    </div>
                  )}
                  {buyStockName && !buyStockLoading && (
                    <div style={{ fontSize: '12px', color: 'var(--accent-green)', marginTop: '4px', fontWeight: 500 }}>
                      ✓ {buyStockName}
                    </div>
                  )}
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                    买入价格
                  </label>
                  <input
                    type="number"
                    value={buyPrice}
                    onChange={e => setBuyPrice(e.target.value)}
                    placeholder="如: 1500.00"
                    step="0.01"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '14px' }}
                  />
                </div>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                    买入数量（股）
                  </label>
                  <input
                    type="number"
                    value={buyShares}
                    onChange={e => setBuyShares(Math.max(100, parseInt(e.target.value) || 100))}
                    step="100"
                    min="100"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '14px' }}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                    需要: ¥{((parseFloat(buyPrice) || 0) * buyShares).toFixed(0)}
                  </div>
                </div>
                <button
                  onClick={handleManualBuy}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'var(--accent-red)',
                    border: 'none',
                    borderRadius: '10px',
                    color: 'white',
                    fontSize: '15px',
                    fontWeight: '600',
                    cursor: 'pointer' }}
                >
                  确认买入
                </button>
              </div>
            ) : (
              <div>
                <div style={{ 
                  background: 'var(--bg-secondary)', 
                  borderRadius: '10px', 
                  padding: '12px',
                  marginBottom: '16px',
                  overflow: 'hidden',
                  minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: '600' }}>{tradeModal.holding?.name}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{tradeModal.holding?.code}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '13px' }}>
                    <span>持仓: {tradeModal.holding?.shares}股</span>
                    <span>现价: ¥{tradeModal.holding?.current_price != null ? Number(tradeModal.holding.current_price).toFixed(2) : '--'}</span>
                  </div>
                </div>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                    卖出数量（股）
                  </label>
                  <input
                    type="number"
                    value={tradeShares}
                    onChange={e => setTradeShares(Math.min(tradeModal.holding?.shares || 0, Math.max(100, parseInt(e.target.value) || 100)))}
                    max={tradeModal.holding?.shares}
                    step="100"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '14px' }}
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    {[100, '半仓', '全仓'].map(opt => (
                      <button
                        key={opt}
                        onClick={() => setTradeShares(
                          opt === '全仓' ? Math.max(100, tradeModal.holding?.shares) :
                          opt === '半仓' ? Math.max(100, Math.floor(tradeModal.holding?.shares / 2 / 100) * 100) :
                          Math.min(tradeModal.holding?.shares, 100)
                        )}
                        style={{
                          flex: 1,
                          padding: '6px',
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-secondary)',
                          fontSize: '12px',
                          cursor: 'pointer' }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleManualSell}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'var(--accent-green)',
                    border: 'none',
                    borderRadius: '10px',
                    color: 'white',
                    fontSize: '15px',
                    fontWeight: '600',
                    cursor: 'pointer' }}
                >
                  确认卖出 {tradeShares}股
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
