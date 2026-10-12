import { useState, useEffect } from 'react';
import { useMarketStore, useYaodiStore } from '../store/store';
import { yaodiAPI, selectionAPI, signalAPI, blackswanAPI, historyAPI, API_BASE, poolAPI, holdingAPI, shundiAPI } from '../config/api';

import { bjDate } from '../utils/beijingTime';
function useBodyScrollLock(isOpen) {
  useEffect(() => {
    if (isOpen) {
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
      return () => {
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
      };
    }
  }, [isOpen]);
}

import {
  performStockSelection,
  SELECTION_TYPES,
  isTradingTimeForSelection,
  shouldUseSnapshot,
  initializeSelectionDatabase
} from '../services/stockSelectionService';
import { registerPageRefresh, unregisterPageRefresh } from '../services/realtimeRefresh';
// ThreeLayerSelectorButton 已删除——双引擎均由后端定时任务自动运行
// EnhancedBacktestEngine - 不再使用（接口不匹配），回测评分改用内置计算
import { fuseAllData } from '../services/dataFusion.js';
import { fetchStockDetail } from '../services/realTimeData.js';
import { toBeijingTime, bjISO } from '../utils/beijingTime';
import { Clock, RefreshCw, Plus, Brain, TrendingUp, TrendingDown, CheckCircle, AlertTriangle, Target, X, TrendingUp as TrendUp, ShieldAlert, BarChart2, DollarSign, Calendar, ChevronDown, Zap, TrendingDown as TrendDownIcon, Newspaper } from 'lucide-react';

// ── 历史选股记录弹窗 ──
function HistorySelectionModal({ onClose, onAddToPool }) {
  useBodyScrollLock(true);
  const [history, setHistory] = useState([]); // [{date, type, stocks: []}]
  const [loading, setLoading] = useState(true);
  const [expandedDate, setExpandedDate] = useState(null); // 展开的日期
  const [detailStock, setDetailStock] = useState(null); // 查看详情的个股

  useEffect(() => {
    const loadHistory = async () => {
      setLoading(true);
      try {
        const resp = await selectionAPI.getHistory();
        const data = await resp;
        if (data.success) {
          setHistory(data.history || []);
        }
      } catch (e) {
        console.error('加载历史选股失败:', e);
      } finally {
        setLoading(false);
      }
    };
    loadHistory();
  }, []);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
  };

  const getTypeLabel = (type) => {
    return type === 'morning' ? '🌅 早盘' : type === 'evening' ? '🌆 尾盘' : '📋 ' + type;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-hidden" style={{ display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div
        className="relative w-full max-w-3xl mx-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl"
        style={{ height:'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="sticky top-0 bg-[var(--bg-primary)] border-b border-[var(--border-light)] px-6 py-4 flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">历史选股记录</h2>
              <div className="text-sm text-[var(--text-tertiary)]">尧帝每日精选个股回顾</div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] flex items-center justify-center">
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 p-4" style={{ overflowY: 'auto' }}>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[var(--text-tertiary)]">
              <Calendar className="w-12 h-12 mb-4 opacity-30" />
              <p>暂无历史选股记录</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((day, idx) => (
                <div key={day.date + day.type} className="bg-[var(--bg-secondary)]/50 rounded-xl border border-[var(--border-color)] overflow-hidden">
                  {/* 日期头部 */}
                  <div
                    className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                    onClick={() => setExpandedDate(expandedDate === `${day.date}-${day.type}` ? null : `${day.date}-${day.type}`)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">{formatDate(day.date)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        day.type === 'morning' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {getTypeLabel(day.type)}
                      </span>
                      <span className="text-xs text-[var(--text-tertiary)]">{day.count} 只</span>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform ${
                      expandedDate === `${day.date}-${day.type}` ? 'rotate-180' : ''
                    }`} />
                  </div>

                  {/* 展开的股票列表 */}
                  {expandedDate === `${day.date}-${day.type}` && (
                    <div className="border-t border-[var(--border-light)] p-3">
                      <div className="grid grid-cols-3 gap-2">
                        {day.stocks.map((stock, i) => (
                          <div
                            key={stock.code + i}
                            className="bg-[var(--bg-primary)]/50 rounded-lg p-3 border border-[var(--border-light)] hover:border-purple-500/30 transition-colors cursor-pointer group relative"
                            onClick={() => setDetailStock(stock)}
                          >
                            {/* 收藏按钮 */}
                            <button
                              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-[var(--bg-tertiary)]/60 hover:bg-blue-500/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                              title="加入收藏股"
                              onClick={(e) => { e.stopPropagation(); onAddToPool(stock); }}
                            >
                              <Plus className="w-3 h-3 text-blue-400" />
                            </button>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-sm">{stock.name}</span>
                              <span className={`text-xs font-medium ${
                                (stock.changePercent || 0) >= 0 ? 'text-red-400' : 'text-green-400'
                              }`}>
                                {(stock.changePercent || 0) >= 0 ? '+' : ''}{Number(stock.changePercent || 0).toFixed(2)}%
                              </span>
                            </div>
                            <div className="text-xs text-[var(--text-tertiary)]">{stock.code}</div>
                            <div className="flex items-center justify-between mt-2">
                              <div className="text-xs">
                                <span className="text-[var(--text-tertiary)]">尧帝置信度</span>
                                <span className="ml-1 font-semibold text-purple-400">{stock.winRate || stock.yaodiConfidence || '--'}%</span>
                              </div>
                              <div className="text-xs text-[var(--text-tertiary)]">
                                ¥{stock.price || '--'}
                              </div>
                            </div>
                            {stock.reason && (
                              <div className="text-[10px] text-[var(--text-tertiary)] mt-2 line-clamp-2">
                                {stock.reason}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 个股详情弹窗 */}
        {detailStock && (
          <StockDetailModal
            stock={detailStock}
            onClose={() => setDetailStock(null)}
            onAddToPool={(stock) => { onAddToPool(stock); setDetailStock(null); }}
          />
        )}
      </div>
    </div>
  );
}

// ── 个股详情弹窗 ──
function StockDetailModal({ stock, onClose, onAddToPool }) {
  const [stockBS, setStockBS] = useState(null); // 个股黑天鹅事件
  const [sentimentData, setSentimentData] = useState(null); // 情绪融合数据
  const [loadingSentiment, setLoadingSentiment] = useState(false);
  const [enrichedStock, setEnrichedStock] = useState(stock); // 实时补充数据后的stock

  // 弹窗打开时获取实时行情 + 黑天鹅事件 + 情绪数据
  useEffect(() => {
    if (!stock?.code) return;
    const code = stock.code.replace(/^(sh|sz|bj)/, '');

    // 实时行情补充 + 尧帝分析字段补充
    fetchStockDetail(code).then(detail => {
      if (detail) {
        // 计算尧帝分析字段（与 enhanceWithRealtimeData 逻辑一致）
        const currentPrice = detail.price || stock.price || 10;
        const score = stock.score || stock.winRate || 70;
        const scoreRatio = Math.min(score / 130, 1);
        const yaodiAccuracy = metrics?.accuracy ?? null; // 【BUG-25修复】移除硬编码78，无数据时用null
        const yaodiConfidence = stock.yaodiConfidence || (yaodiAccuracy ? Math.round(score * 0.6 + yaodiAccuracy * 0.4) : score);
        const pct = detail.changePercent ?? stock.changePercent ?? 0;
        const isMorn = stock.selectionType?.includes('morning') || !stock.selectionType?.includes('evening');
        const expectedGain = stock.expectedGain || parseFloat((pct * 0.4 + 1.5 + scoreRatio * 2.0).toFixed(1));
        const holdingPeriod = stock.holdingPeriod || (isMorn ? '1~3天' : '2~5天');
        const holdingDesc = stock.holdingDesc || (isMorn ? '短线波段，快进快出' : '中线持有，等待轮动');
        const buyPriceLow = stock.buyPriceLow || parseFloat((currentPrice * 0.98).toFixed(2));
        const buyPriceHigh = stock.buyPriceHigh || parseFloat((currentPrice * 1.01).toFixed(2));
        const buyStrategy = stock.buyStrategy || (isMorn ? '回调低吸' : '尾盘潜伏');
        const exitTarget = stock.exitTarget || parseFloat((currentPrice * (1 + expectedGain / 100) * 1.005).toFixed(2));
        const positionScore = score / 130;
        let positionAdvice, positionPct;
        if (positionScore > 0.80 && yaodiConfidence >= 90) {
          positionAdvice = '重仓'; positionPct = '30~40%';
        } else if (positionScore > 0.65 && yaodiConfidence >= 85) {
          positionAdvice = '半仓'; positionPct = '20~30%';
        } else {
          positionAdvice = '轻仓'; positionPct = '10~20%';
        }

        setEnrichedStock(prev => ({
          ...prev,
          price: detail.price || prev.price,
          changePercent: detail.changePercent ?? prev.changePercent,
          high: detail.high ?? prev.high,
          low: detail.low ?? prev.low,
          volume: detail.volume ?? prev.volume,
          // 补充尧帝分析字段
          yaodiConfidence: prev.yaodiConfidence || yaodiConfidence,
          expectedGain: prev.expectedGain || expectedGain,
          holdingPeriod: prev.holdingPeriod || holdingPeriod,
          holdingDesc: prev.holdingDesc || holdingDesc,
          buyPriceLow: prev.buyPriceLow || buyPriceLow,
          buyPriceHigh: prev.buyPriceHigh || buyPriceHigh,
          buyStrategy: prev.buyStrategy || buyStrategy,
          exitTarget: prev.exitTarget || exitTarget,
          positionAdvice: prev.positionAdvice || positionAdvice,
          positionPct: prev.positionPct || positionPct,
        }));
      }
    }).catch(() => {});

    // 尧帝系统数据补充（夏普比率、最大回撤、市场情绪、活跃分支）
    // 优先从 /api/yaodi/comprehensive 获取真实数据（包含sharpe/max_drawdown/market_sentiment）
    fetch('http://localhost:8769/api/yaodi/comprehensive')
      .then(r => r.json())
      .then(data => {
        const m = data?.main || {};
        if (m && Object.keys(m).length > 0) {
          setEnrichedStock(prev => ({
            ...prev,
            yaodiSharpe: prev.yaodiSharpe ?? m.sharpe_ratio ?? null,
            yaodiMaxDrawdown: prev.yaodiMaxDrawdown ?? m.max_drawdown ?? null,
            yaodiMarketSentiment: prev.yaodiMarketSentiment ?? m.market_sentiment ?? null,
            yaodiBranchCount: prev.yaodiBranchCount ?? null,
          }));
        }
      })
      .catch(() => {});
    // yaodi-v2/stats 补充活跃分支数（覆盖上面的null值）
    fetch('http://localhost:8769/api/yaodi-v2/stats')
      .then(r => r.json())
      .then(data => {
        const s = data?.stats || {};
        if (s && Object.keys(s).length > 0) {
          setEnrichedStock(prev => ({
            ...prev,
            yaodiBranchCount: s.activeBranches ?? s.active_branches ?? prev.yaodiBranchCount,
          }));
        }
      })
      .catch(() => {});

    // 黑天鹅事件
    const fetchBS = async () => {
      try {
        const resp = await blackswanAPI.getEventsForStock(stock.code);
        const data = await resp;
        const match = data?.events?.find(e => e.affectedStocks?.some(c => c === stock.code || c === `sh${stock.code}` || c === `sz${stock.code}`));
        if (match) setStockBS(match);
      } catch(e) { /* 静默 */ }
    };
    fetchBS();
    
    // 获取情绪融合数据
    setLoadingSentiment(true);
    fuseAllData(code, stock.name)
      .then(data => setSentimentData(data))
      .catch(() => {})
      .finally(() => setLoadingSentiment(false));
  }, [stock?.code]);

  if (!stock) return null;

  const s = enrichedStock; // 简写
  // 确保所有数值都是有效数字，避免 NaN
  const price      = !isNaN(Number(s.price)) && Number(s.price) > 0 ? Number(s.price) : 10; // 默认10元避免全0
  const buyLow     = !isNaN(Number(s.buyPriceLow)) && Number(s.buyPriceLow) > 0 ? Number(s.buyPriceLow) : parseFloat((price * 0.98).toFixed(2));
  const buyHigh    = !isNaN(Number(s.buyPriceHigh)) && Number(s.buyPriceHigh) > 0 ? Number(s.buyPriceHigh) : parseFloat((price * 1.01).toFixed(2));
  const buyMid     = parseFloat(((buyLow + buyHigh) / 2).toFixed(2));
  const exitTarget = !isNaN(Number(s.exitTarget)) && Number(s.exitTarget) > 0 ? Number(s.exitTarget) : parseFloat((price * 1.05).toFixed(2));
  const high       = !isNaN(Number(s.high)) ? Number(s.high) : null;
  const low        = !isNaN(Number(s.low)) ? Number(s.low) : null;

  // 止盈：目标价（exitTarget）
  const takeProfitPct = (price > 0 && buyMid > 0) 
    ? Number(((exitTarget - buyMid) / buyMid) * 100).toFixed(1) 
    : '--';

  // 止损：买入中间价下方 3%（早盘）/ 2.5%（尾盘）
  const stopLossPct  = s.selectionType === 'morning' ? 3.0 : 2.5;
  const stopLossPrice = buyMid > 0 ? parseFloat((buyMid * (1 - stopLossPct / 100)).toFixed(2)) : 0;

  // 盈亏比
  const rr = (stopLossPct > 0 && !isNaN(parseFloat(takeProfitPct)))
    ? (parseFloat(takeProfitPct) / stopLossPct).toFixed(1)
    : '--';

  const isMorning = s.selectionType === 'morning';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-hidden" style={{ display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div
        className="relative w-full max-w-lg mx-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl"
        style={{ height:'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="sticky top-0 bg-[var(--bg-primary)] border-b border-[var(--border-light)] px-6 py-4 flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <BarChart2 className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{s.name}</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-tertiary)]">{s.code}</span>
                <span className={`text-sm font-medium ${s.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {s.changePercent >= 0 ? '+' : ''}{Number(s.changePercent).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] flex items-center justify-center">
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* 黑天鹅事件标识 */}
        {stockBS && (
          <div className="mx-4 mt-3 bg-red-500/15 border border-red-500/30 rounded-xl p-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <div className="text-sm font-bold text-red-400">{stockBS.title}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">{stockBS.message}</div>
              <div className={`mt-1 inline-block text-[10px] px-2 py-0.5 rounded font-bold ${
                stockBS.action === 'forbidden_buy' ? 'bg-red-600/40 text-red-200' :
                stockBS.action === 'strong_sell' ? 'bg-red-500/40 text-red-200' : 'bg-orange-500/40 text-orange-200'
              }`}>
                {stockBS.action === 'forbidden_buy' ? '⛔ 禁止买入' : stockBS.action === 'strong_sell' ? '🚫 强烈卖出' : '⚠️ 建议卖出'}
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-5 space-y-5 flex-1" style={{ overflowY: 'auto' }}>

          {/* 实时价格 */}
          <div className="bg-[var(--bg-secondary)]/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-semibold text-yellow-400">实时行情</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="text-center">
                <div className="text-[var(--text-tertiary)] text-xs mb-1">当前价</div>
                <div className="text-xl font-bold text-[var(--text-primary)]">{Number(price || 0).toFixed(2)}</div>
              </div>
              <div className="text-center">
                <div className="text-[var(--text-tertiary)] text-xs mb-1">今日最高</div>
                <div className="font-semibold text-red-400">{high != null ? high.toFixed(2) : '--'}</div>
              </div>
              <div className="text-center">
                <div className="text-[var(--text-tertiary)] text-xs mb-1">今日最低</div>
                <div className="font-semibold text-green-400">{low != null ? low.toFixed(2) : '--'}</div>
              </div>
            </div>
          </div>

          {/* 建议买入价 */}
          <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-blue-400">建议买入价</span>
              <span className="ml-auto text-xs text-blue-500/70 bg-blue-500/10 px-2 py-0.5 rounded">{s.buyStrategy || '现价附近'}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-center">
                <div className="text-xs text-[var(--text-tertiary)] mb-1">低位介入</div>
                <div className="text-lg font-bold text-blue-300">{buyLow}</div>
              </div>
              <div className="flex-1 mx-3 flex items-center gap-1">
                <div className="flex-1 h-1 bg-blue-500/30 rounded" />
                <div className="text-xs text-blue-400 font-bold">{buyMid}</div>
                <div className="flex-1 h-1 bg-blue-500/30 rounded" />
              </div>
              <div className="text-center">
                <div className="text-xs text-[var(--text-tertiary)] mb-1">高位介入</div>
                <div className="text-lg font-bold text-blue-300">{buyHigh}</div>
              </div>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-2 text-center">建议以 {buyMid} 为中间价分批介入</p>
          </div>

          {/* 止盈止损 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className="w-4 h-4 text-red-400" />
                <span className="text-xs font-semibold text-red-400">止盈目标</span>
              </div>
              <div className="text-xl font-bold text-red-300">{exitTarget}</div>
              <div className="text-xs text-red-400/70 mt-1">+{takeProfitPct}%</div>
              <div className="text-xs text-[var(--text-tertiary)] mt-1">分批减仓，目标位附近出</div>
            </div>
            <div className="bg-green-500/10 border border-green-500/25 rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <ShieldAlert className="w-4 h-4 text-green-400" />
                <span className="text-xs font-semibold text-green-400">止损位</span>
              </div>
              <div className="text-xl font-bold text-green-300">{stopLossPrice}</div>
              <div className="text-xs text-green-400/70 mt-1">-{stopLossPct}%</div>
              <div className="text-xs text-[var(--text-tertiary)] mt-1">跌破即止损，严格执行</div>
            </div>
          </div>

          {/* 盈亏比 */}
          <div className="bg-[var(--bg-secondary)]/60 rounded-xl p-3 flex items-center justify-between">
            <span className="text-sm text-[var(--text-secondary)]">盈亏比（止盈/止损）</span>
            <span className={`text-lg font-bold ${parseFloat(rr) >= 2 ? 'text-green-400' : parseFloat(rr) >= 1.5 ? 'text-yellow-400' : 'text-[var(--text-secondary)]'}`}>
              {rr} : 1
            </span>
          </div>

          {/* 持仓周期 */}
          <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-amber-400">建议持仓周期</span>
              <span className="ml-auto text-base font-bold text-amber-300">{s.holdingPeriod || '--'}</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">{s.holdingDesc || '--'}</p>
            <div className="mt-2 pt-2 border-t border-amber-500/15 flex items-center gap-4 text-xs">
              <div>
                <span className="text-[var(--text-tertiary)]">上涨概率</span>
                <span className="ml-1.5 text-blue-400 font-bold">{s.winRate || '--'}%</span>
              </div>
              <div>
                <span className="text-[var(--text-tertiary)]">预期涨幅</span>
                <span className="ml-1.5 text-green-400 font-bold">+{s.expectedGain || '--'}%</span>
              </div>
              <div>
                <span className="text-[var(--text-tertiary)]">尧帝置信度</span>
                <span className="ml-1.5 text-purple-400 font-bold">{s.yaodiConfidence || '--'}%</span>
              </div>
            </div>
          </div>

          {/* 选股逻辑及依据 */}
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold text-purple-400">尧帝选股逻辑及依据</span>
              <span className="ml-auto text-xs text-purple-500/60 bg-purple-500/10 px-2 py-0.5 rounded">
                {isMorning ? '早盘策略' : '尾盘策略'}
              </span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{s.reason || '--'}</p>
            <div className="mt-3 pt-3 border-t border-purple-500/15 space-y-1.5 text-xs text-[var(--text-tertiary)]">
              <div className="flex items-start gap-2">
                <span className="text-purple-400 shrink-0">评分依据</span>
                <span>
                  {isMorning
                    ? `涨幅 ${Number(s.changePercent).toFixed(2)}%（甜区1-4%）· 成交量 ${s.volume ? (s.volume / 10000).toFixed(0) + '万手' : '--'} · 价格弹性适中 · 趋势延续性强`
                    : `全天涨跌 ${Number(s.changePercent).toFixed(2)}%（抗跌性好）· 成交量 ${s.volume ? (s.volume / 10000).toFixed(0) + '万手' : '--'} · 资金护盘信号 · 次日高开概率高`}
                </span>
              </div>
              {s.selectionTime && (
                <div className="flex items-center gap-2">
                  <span className="text-purple-400">选股时间</span>
                  <span>{(() => {
                    const ts = s.selectionTime;
                    // 兼容 "11:14"(仅时间) 和完整日期时间字符串
                    let dt;
                    if (/^\d{1,2}:\d{2}/.test(ts) && ts.length <= 8) {
                      // 仅时间 → 用 created_at 或今天日期拼接
                      const base = s.created_at || s.date || new Date().toISOString().slice(0, 10);
                      dt = new Date(`${base} ${ts}`);
                    } else {
                      dt = new Date(ts);
                    }
                    return isNaN(dt.getTime()) ? ts : dt.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  })()}</span>
                </div>
              )}
            </div>
          </div>

          {/* 技术分析大模型结论 */}
          {s.techSummaries && s.techSummaries.length > 0 && (
          <div className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <BarChart2 className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-amber-400">技术分析大模型</span>
            </div>
            <div className="space-y-1.5">
              {s.techSummaries.map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0">{t.icon}</span>
                  <span className="text-[var(--text-tertiary)] shrink-0 w-16">{t.name}</span>
                  <span className={t.bullish ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'}>{t.conclusion}</span>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* 尧帝系统全景 */}
          <div className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-xl p-3">
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div>
                <div className="text-[var(--text-tertiary)]">夏普比率</div>
                <div className="font-bold text-blue-400">{s.yaodiSharpe ?? '--'}</div>
              </div>
              <div>
                <div className="text-[var(--text-tertiary)]">最大回撤</div>
                <div className="font-bold text-red-400">{s.yaodiMaxDrawdown ?? '--'}%</div>
              </div>
              <div>
                <div className="text-[var(--text-tertiary)]">市场情绪</div>
                <div className={`font-bold ${(s.yaodiMarketSentiment ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {(s.yaodiMarketSentiment ?? 0) > 0 ? '+' : ''}{s.yaodiMarketSentiment ?? '--'}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-tertiary)]">活跃分支</div>
                <div className="font-bold text-purple-400">{s.yaodiBranchCount || '--'}</div>
              </div>
            </div>
          </div>

          {/* 情绪融合数据 */}
          {sentimentData && (
          <div className="bg-[var(--bg-secondary)]/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold text-purple-400">多源情绪分析</span>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded font-bold ${
                sentimentData.fusedLabel === '强烈看多' ? 'bg-red-500/30 text-red-300' :
                sentimentData.fusedLabel === '偏多' ? 'bg-orange-500/30 text-orange-300' :
                sentimentData.fusedLabel === '强烈看空' ? 'bg-green-500/30 text-green-300' :
                sentimentData.fusedLabel === '偏空' ? 'bg-teal-500/30 text-teal-300' :
                'bg-gray-500/30 text-gray-300'
              }`}>
                {sentimentData.fusedLabel}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs mb-2">
              <div className="text-center bg-[var(--bg-primary)] rounded-lg p-2">
                <div className="text-[var(--text-tertiary)]">新闻情绪</div>
                <div className={`font-bold ${sentimentData.factors?.newsSentiment >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {(Number(sentimentData.factors?.newsSentiment * 100) ?? 0).toFixed(0)}%
                </div>
              </div>
              <div className="text-center bg-[var(--bg-primary)] rounded-lg p-2">
                <div className="text-[var(--text-tertiary)]">北向资金</div>
                <div className={`font-bold ${sentimentData.factors?.northboundFlow >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {sentimentData.factors?.northboundFlow >= 0 ? '流入' : '流出'}
                </div>
              </div>
              <div className="text-center bg-[var(--bg-primary)] rounded-lg p-2">
                <div className="text-[var(--text-tertiary)]">主力资金</div>
                <div className={`font-bold ${sentimentData.factors?.mainFlow >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {sentimentData.factors?.mainFlow >= 0 ? '净入' : '净出'}
                </div>
              </div>
            </div>
            <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
              <span>综合情绪: {sentimentData.fusedSentiment}</span>
              <span>置信度: {sentimentData.confidence != null ? Number(sentimentData.confidence).toFixed(0) : '--'}%</span>
            </div>
          </div>
          )}

          {/* 风险提示 */}
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-400/80">{(() => {
                const r = s.risk;
                if (!r) return '注意市场风险，严格止损';
                if (r === 'low') return '风险较低，可适当放宽仓位';
                if (r === 'medium') return '中等风险，建议控制仓位在20%以内';
                if (r === 'high') return '风险较高，建议轻仓试探，严格止损';
                return r;
              })()}</p>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 pb-2">
            <button
              onClick={() => { onAddToPool(stock); onClose(); }}
              className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 rounded-xl text-[var(--text-primary)] font-medium flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              加入收藏股
            </button>
            <button
              onClick={onClose}
              className="px-6 py-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] rounded-xl text-[var(--text-secondary)] font-medium"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectionCard({ stock, onAddToPool, selected, onToggle, isSnapshot = false, onDetail }) {
  // 回测评分（useEffect 异步获取，避免渲染中 fetch 导致无限循环）
  const [btScore, setBtScore] = useState(null);
  useEffect(() => {
    if (!stock?.code) return;
    let cancelled = false;
    (async () => {
      try {
        const histData = await historyAPI.get(stock.code, 60);
        const history = histData?.history || [];
        console.log(`[回测] ${stock.code} 历史数据: ${history.length} 条`);
        if (history.length >= 10 && !cancelled) {
          // 历史数据倒序（最新在前），反转为正序
          const bars = history.slice().reverse();
          // 简单回测：每5天买入持有3天卖出
          const capital0 = 1000000;
          let capital = capital0;
          const returns = [];
          const equityCurve = [capital];
          for (let i = 0; i < bars.length - 4; i += 5) {
            const buyPrice = bars[i].close;
            const sellIdx = Math.min(i + 3, bars.length - 1);
            const sellPrice = bars[sellIdx].close;
            const shares = Math.floor(capital * 0.2 / buyPrice);
            if (shares <= 0) continue;
            const cost = shares * buyPrice * 1.001;
            const proceeds = shares * sellPrice * 0.999;
            capital = capital - cost + proceeds;
            const ret = (sellPrice - buyPrice) / buyPrice;
            returns.push(ret);
            equityCurve.push(capital);
          }
          // 计算指标
          const totalReturn = (capital - capital0) / capital0;
          const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
          const winTrades = returns.filter(r => r > 0).length;
          const winRate = returns.length > 0 ? winTrades / returns.length : 0;
          const variance = returns.length > 1 ? returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length - 1) : 0;
          const stdDev = Math.sqrt(variance);
          const annualizedReturn = avgReturn * 50;
          const annualizedStd = stdDev * Math.sqrt(50);
          const sharpeRatio = annualizedStd > 0 ? (annualizedReturn - 0.03) / annualizedStd : 0;
          let maxDD = 0, peak = equityCurve[0];
          for (const eq of equityCurve) { if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd; }
          const score = Math.round(Math.min(100, Math.max(0, 40 + winRate * 30 + (sharpeRatio > 0 ? sharpeRatio * 10 : sharpeRatio * 5) + totalReturn * 100 * 0.3)));
          if (!cancelled) {
            setBtScore({ score, totalR: totalReturn * 100, sr: sharpeRatio, maxDD, winRate: winRate * 100, trades: returns.length });
          }
        }
      } catch(e) { /* 静默 */ }
    })();
    return () => { cancelled = true; };
  }, [stock?.code]);

  // 判断是否为科创板或北交所股票
  const isFilteredStock = () => {
    if (!stock.code) return false;

    // 科创板: 688开头
    if (stock.code.startsWith('688')) return '科创板';

    // 北交所: 8开头
    if (stock.code.startsWith('8')) return '北交所';

    // ST股
    if (stock.name.includes('ST') || stock.name.includes('*ST')) return 'ST股';

    // 涨停股（区分板块）
    const _c = stock.code || '';
    const _isHigh = _c.startsWith('300') || _c.startsWith('301') || _c.startsWith('688') || _c.startsWith('689');
    const _limitPct = _isHigh ? 19.5 : 9.5;
    if (Math.abs(stock.changePercent || 0) >= _limitPct) return '涨停股';

    return null;
  };

  const filteredType = isFilteredStock();

  return (
    <div
      className={`bg-[var(--bg-secondary)] border rounded-xl p-4 transition-all relative cursor-pointer ${selected ? 'border-blue-500 ring-1 ring-blue-500' : 'border-[var(--border-color)] hover:border-blue-500/50 hover:bg-[var(--bg-secondary)]/80'}`}
      onClick={() => onDetail && onDetail(stock)}
    >
      {/* 快照标记 */}
      {isSnapshot && (
        <div className="absolute top-3 right-3">
          <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded-full flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            快照
          </span>
        </div>
      )}

      {/* 过滤标记 */}
      {filteredType && (
        <div className="absolute top-3 left-3">
          <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded-full">
            {filteredType}
          </span>
        </div>
      )}

      <div className="flex justify-between items-start mb-3 pt-2">
        <div>
          <h4 className="font-semibold text-lg">{stock.name}</h4>
          <span className="text-sm text-[var(--text-tertiary)]">{stock.code}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-sm font-medium ${stock.changePercent >= 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
            {stock.changePercent >= 0 ? '+' : ''}{Number(stock.changePercent).toFixed(2)}%
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(stock.code); }}
            className={`w-6 h-6 rounded border flex items-center justify-center ${selected ? 'bg-blue-500 border-blue-500' : 'border-[var(--border-color)]'}`}
          >
            {selected && <CheckCircle className="w-4 h-4 text-[var(--text-primary)]" />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
        <div className="bg-[var(--bg-primary)] rounded p-2">
          <span className="text-[var(--text-tertiary)] block">现价</span>
          <span className="font-medium">{stock.price != null ? Number(stock.price).toFixed(2) : '--'}</span>
        </div>
        <div className="bg-[var(--bg-primary)] rounded p-2">
          <span className="text-[var(--text-tertiary)] block">涨跌幅</span>
          <span className={stock.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}>
            {stock.changePercent >= 0 ? '+' : ''}{Number(stock.changePercent).toFixed(2)}%
          </span>
        </div>
        <div className="bg-[var(--bg-primary)] rounded p-2">
          <span className="text-[var(--text-tertiary)] block">上涨概率</span>
          <span className="text-blue-400 font-bold">{stock.winRate || '--'}%</span>
        </div>
      </div>

      {/* 尧帝核心指标 */}
      <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
        <div className="bg-purple-500/10 border border-purple-500/20 rounded p-2">
          <span className="text-purple-400 text-xs block">尧帝置信度</span>
          <span className="text-purple-300 font-bold">{stock.yaodiConfidence || '--'}%</span>
        </div>
        <div className="bg-green-500/10 border border-green-500/20 rounded p-2">
          <span className="text-red-400 text-xs block">预期涨幅</span>
          <span className="text-green-300 font-bold">+{stock.expectedGain || '--'}%</span>
        </div>
      </div>

      {/* 建议买入价 & 持仓周期 */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 mb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Target className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-semibold text-blue-400">尧帝操作建议</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-[var(--text-tertiary)] block mb-1">建议买入区间</span>
            {stock.buyPriceLow && stock.buyPriceHigh ? (
              <div>
                <span className="text-orange-300 font-bold">
                  {stock.buyPriceLow} ~ {stock.buyPriceHigh}
                </span>
                <span className="ml-1.5 text-[var(--text-tertiary)] bg-[var(--bg-tertiary)]/50 px-1.5 py-0.5 rounded">
                  {stock.buyStrategy}
                </span>
              </div>
            ) : (
              <span className="text-[var(--text-tertiary)]">--</span>
            )}
          </div>
          <div>
            <span className="text-[var(--text-tertiary)] block mb-1">目标止盈价</span>
            <span className="text-red-300 font-bold">{stock.exitTarget || '--'}</span>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-blue-500/10">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[var(--text-tertiary)] text-xs">持仓周期</span>
              <span className="ml-2 text-yellow-300 font-bold text-xs">{stock.holdingPeriod || '--'}</span>
            </div>
          </div>
          {stock.holdingDesc && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1">{stock.holdingDesc}</p>
          )}
        </div>
      </div>

      {/* 入选逻辑 */}
      <div className="bg-[var(--bg-primary)]/30 rounded-lg p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-purple-400">尧帝分析</span>
          {isSnapshot && (
            <span className="text-xs text-yellow-500 bg-yellow-500/20 px-2 py-0.5 rounded">历史快照</span>
          )}
        </div>
        <p className="text-xs text-[var(--text-secondary)]">{stock.reason || '基于量价关系和技术形态综合分析，该股处于强势上涨趋势中'}</p>
        {stock.selectionTime && (
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            选股时间: {(() => {
              const ts = stock.selectionTime;
              let dt;
              if (/^\d{1,2}:\d{2}/.test(ts) && ts.length <= 8) {
                const base = stock.created_at || stock.date || new Date().toISOString().slice(0, 10);
                dt = new Date(`${base} ${ts}`);
              } else {
                dt = new Date(ts);
              }
              return isNaN(dt.getTime()) ? ts : dt.toLocaleString('zh-CN', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            })()}
          </p>
        )}
      </div>

      {/* 风险提示 */}
      <div className="text-xs text-yellow-500 bg-yellow-500/10 rounded p-2 mb-3">
        ⚠️ {(() => {
          const r = stock.risk;
          if (!r) return '注意追高风险，建议回调买入';
          // 兼容英文风险等级（历史数据）
          if (r === 'low') return '风险较低，可适当放宽仓位';
          if (r === 'medium') return '中等风险，建议控制仓位在20%以内';
          if (r === 'high') return '风险较高，建议轻仓试探，严格止损';
          return r; // 中文提示直接显示
        })()}
      </div>

      {/* 仓位建议 + 回测验证 */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {/* 仓位建议 */}
        <div className={`rounded-lg p-2 border text-center ${
          stock.positionAdvice === '重仓' ? 'bg-red-500/10 border-red-500/30' :
          stock.positionAdvice === '半仓' ? 'bg-orange-500/10 border-orange-500/30' :
          'bg-blue-500/10 border-blue-500/30'
        }`}>
          <div className="text-[10px] text-[var(--text-tertiary)] mb-0.5">尧帝仓位建议</div>
          <div className={`font-bold text-sm ${
            stock.positionAdvice === '重仓' ? 'text-red-400' :
            stock.positionAdvice === '半仓' ? 'text-orange-400' :
            'text-blue-400'
          }`}>{stock.positionAdvice || '轻仓'}</div>
          <div className="text-[10px] text-[var(--text-tertiary)]">{stock.positionPct || '5~10%'}</div>
        </div>
        {/* 回测验证（使用 useEffect 预计算，避免渲染中 fetch 无限循环） */}
        {(() => {
          const score = btScore?.score || 0;
          return (
            <div className={`rounded-lg p-2 border text-center ${
              score >= 65 ? 'bg-green-500/10 border-green-500/30' :
              score >= 45 ? 'bg-yellow-500/10 border-yellow-500/30' :
              'bg-[var(--bg-primary)]/50 border-[var(--border-color)]'
            }`}>
              <div className="text-[10px] text-[var(--text-tertiary)] mb-0.5">增强回测评分</div>
              <div className={`font-bold text-sm ${
                score >= 65 ? 'text-green-400' : score >= 45 ? 'text-yellow-400' : 'text-[var(--text-secondary)]'
              }`}>
                {btScore ? `${btScore.score}分` : '--'}
              </div>
              {btScore ? (
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  收益{btScore.totalR >= 0 ? '+' : ''}{Number(btScore.totalR ?? 0).toFixed(1)}% | 夏普{Number(btScore.sr ?? 0).toFixed(1)}
                </div>
              ) : (
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  加载中...
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* 市场环境标签 */}
      {stock.marketEnvironment && stock.marketEnvironment !== 'unknown' && (
        <div className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 mb-3 ${
          stock.marketEnvironment === 'bull' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
          stock.marketEnvironment === 'bear' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
          'bg-gray-500/10 text-gray-400 border border-gray-500/20'
        }`}>
          <span>{stock.marketEnvironment === 'bull' ? '🐂' : stock.marketEnvironment === 'bear' ? '🐻' : '📊'}</span>
          <span className="font-medium">
            {stock.marketEnvironment === 'bull' ? '牛市环境·动量权重×1.4' :
             stock.marketEnvironment === 'bear' ? '熊市环境·防御权重×1.4' : '震荡市·均衡权重'}
          </span>
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onAddToPool(stock); }}
        className="w-full py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" />
        加入收藏股
      </button>
    </div>
  );
}

// ━━━━━━ 尧帝V2引擎选股卡片 ━━━━━━
function ThreeLayerStockCard({ stock, onAddToPool, onDetail }) {
  const changePct = stock.changePercent ?? stock.change ?? 0;
  const isUp = changePct > 0;
  const isDown = changePct < 0;

  // Phase升级信息
  const techSignal = stock.techSignal || 'neutral';
  const techScore = stock.techScore || 50;
  const marketRegime = stock.marketRegime || 'UNKNOWN';
  const sectorStrength = stock.sectorStrength || 'neutral';
  
  // 技术信号样式
  const techSignalStyle = {
    'strong_buy': { color: 'text-red-400', bg: 'bg-red-500/20', label: '强买' },
    'buy': { color: 'text-orange-400', bg: 'bg-orange-500/20', label: '买入' },
    'neutral': { color: 'text-gray-400', bg: 'bg-gray-500/20', label: '中性' },
    'sell': { color: 'text-green-400', bg: 'bg-green-500/20', label: '卖出' },
    'strong_sell': { color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: '强卖' },
  };
  const techStyle = techSignalStyle[techSignal] || techSignalStyle['neutral'];

  return (
    <div
      className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 hover:border-blue-500/40 transition-all cursor-pointer"
      onClick={() => onDetail && onDetail(stock)}
    >
      {/* 头部：股票名 + 涨跌 */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-[var(--text-primary)] truncate">{stock.name}</span>
            <span className="text-xs text-[var(--text-tertiary)]">{stock.code}</span>
            {stock.rank != null && stock.rank !== '' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-purple-300 font-medium">
                #{stock.rank}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-lg font-bold text-[var(--text-primary)]">
              ¥{stock.price != null ? Number(stock.price).toFixed(2) : '--'}
            </span>
            <span className={`text-sm font-medium ${isUp ? 'text-red-400' : isDown ? 'text-green-400' : 'text-[var(--text-secondary)]'}`}>
              {isUp ? '+' : ''}{changePct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* 综合评分 */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-[var(--text-tertiary)]">L2得分</span>
          <span className="font-bold text-amber-400">{stock.score}分</span>
        </div>
        <div className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
            style={{ width: `${Math.min(stock.score, 100)}%` }}
          />
        </div>
      </div>

      {/* Phase升级信息：技术信号 + 市场格局 + 板块强度 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className={`${techStyle.bg} rounded-lg px-2 py-1.5 text-center`}>
          <div className="text-[10px] text-[var(--text-tertiary)]">技术信号</div>
          <div className={`text-sm font-bold ${techStyle.color}`}>{techStyle.label}</div>
        </div>
        <div className="bg-blue-500/10 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[10px] text-blue-400">市场格局</div>
          <div className="text-sm font-bold text-blue-300">{marketRegime}</div>
        </div>
        <div className="bg-purple-500/10 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[10px] text-purple-400">板块强度</div>
          <div className="text-sm font-bold text-purple-300">{sectorStrength}</div>
        </div>
      </div>

      {/* 底部信息 */}
      <div className="flex justify-between items-center text-[10px] text-[var(--text-tertiary)] border-t border-[var(--border-light)] pt-2 mt-1">
        <span>置信度 <span className="text-amber-400 font-medium">{stock.yaodiConfidence ?? '--'}%</span></span>
        <span>凯利 <span className="text-purple-300 font-medium">{stock.kellyPct ?? '--'}</span></span>
        <span>仓位 <span className="text-purple-300 font-medium">{stock.positionPct ?? '--'}</span></span>
        <button
          onClick={(e) => { e.stopPropagation(); onAddToPool(stock); }}
          className="px-2 py-0.5 text-[10px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded"
        >
          + 收藏
        </button>
      </div>
    </div>
  );
}

export default function StockSelection() {
  const { stocks, addToPool } = useMarketStore();
  const { metrics, loadFromAPI } = useYaodiStore();

  // 三层引擎数据增强：补充快照中缺少的 yaodiConfidence / positionPct / 实时行情
  const enhanceThreeLayer = async (stocks) => {
    // 从尧帝API获取真实准确率，替代硬编码78
    const yaodiAccuracy = metrics?.accuracy ?? null; // 【BUG-25修复】移除硬编码78，无数据时用null
    const results = [];
    for (const stock of stocks) {
      // ⚠️ 实时行情过滤：涨停股、科创板(688)、北交所(8xx)、ST股 不应进入选股结果
      const code = stock.code || stock.stock_code || '';
      const changePct = stock.changePercent ?? stock.change ?? 0;
      const name = stock.name || '';
      if (code.startsWith('688')) continue; // 科创板
      if (/^[48]/.test(code)) continue; // 北交所
      if (name.includes('ST') || name.includes('*ST')) continue; // ST股
      const _isHL = code.startsWith('300') || code.startsWith('301') || code.startsWith('688') || code.startsWith('689');
      const _lp = _isHL ? 19.5 : 9.5;
      if (Math.abs(changePct) >= _lp) continue; // 涨停/跌停股（区分板块）

      const score = stock.score || 70;
      const yaodiConfidence = yaodiAccuracy ? Math.round(score * 0.6 + yaodiAccuracy * 0.4) : score;
      const positionScore = score / 130;
      let positionPct;
      if (positionScore > 0.80 && yaodiConfidence >= 90) {
        positionPct = '30~40%';
      } else if (positionScore > 0.65 && yaodiConfidence >= 85) {
        positionPct = '20~30%';
      } else {
        positionPct = '10~20%';
      }

      // 补充实时行情数据
      let realtime = {};
      try {
        const code = stock.code || stock.stock_code;
        if (code) {
          const resp = await fetch(`/api/stock/${code}`);
          const data = await resp.json();
          const d = data.stock || data;
          realtime = {
            price: d.price ?? d.currentPrice ?? d.close,
            changePercent: d.changePercent ?? d.change_pct ?? d.pctChg,
            change: d.change ?? d.priceChange ?? d.price_change,
            high: d.high,
            low: d.low,
            open: d.open,
            volume: d.volume,
            amount: d.amount,
            turnover: d.turnover ?? d.turnoverRate,
          };
        }
      } catch (e) {
        console.warn(`三层引擎实时行情获取失败 ${stock.code}:`, e.message);
      }

      // ⚠️ 实时行情过滤：补充行情后发现涨停/跌停也需过滤（区分板块）
      const rtChangePct = realtime.changePercent ?? changePct;
      const _rtHL = code.startsWith('300') || code.startsWith('301') || code.startsWith('688') || code.startsWith('689');
      const _rtLP = _rtHL ? 19.5 : 9.5;
      if (Math.abs(rtChangePct) >= _rtLP) continue;

      results.push({
        ...stock,
        yaodiConfidence,
        positionPct,
        ...realtime,
        // rank 保留原始值，无数据时不显示
        rank: stock.rank ?? '',
      });
    }
    return results;
  };

  // 【新增2026-07-08】尧帝V2引擎数据增强：处理L3信号并补充Phase升级信息
  const enhanceYaodiV2 = async (signals) => {
    const results = [];
    for (const sig of signals) {
      // ⚠️ 实时行情过滤：涨停股、科创板(688)、北交所(8xx)、ST股 不应进入选股结果
      const code = sig.code || '';
      const changePct = sig.change_percent ?? 0;
      const name = sig.name || '';
      if (code.startsWith('688')) continue; // 科创板
      if (/^[48]/.test(code)) continue; // 北交所
      if (name.includes('ST') || name.includes('*ST')) continue; // ST股
      const _isHL = code.startsWith('300') || code.startsWith('301') || code.startsWith('688') || code.startsWith('689');
      const _lp = _isHL ? 19.5 : 9.5;
      if (Math.abs(changePct) >= _lp) continue; // 涨停/跌停股

      // L2得分转百分制（尧帝V2使用小数）
      const l2Score = sig.l2_score ? Math.round(sig.l2_score * 100) : 70;
      const confidence = sig.confidence || l2Score;
      
      // 仓位建议（基于凯利比例）
      const kellyPct = sig.kelly_pct || 0;
      let positionPct;
      if (kellyPct > 0.25 || confidence >= 90) {
        positionPct = '30~40%';
      } else if (kellyPct > 0.15 || confidence >= 85) {
        positionPct = '20~30%';
      } else if (kellyPct > 0.08 || confidence >= 75) {
        positionPct = '10~20%';
      } else {
        positionPct = '5~10%';
      }

      // 补充实时行情数据
      let realtime = {};
      try {
        const resp = await fetch(`/api/stock/${code}`);
        const data = await resp.json();
        const d = data.stock || data;
        realtime = {
          price: d.price ?? d.currentPrice ?? d.close,
          changePercent: d.changePercent ?? d.change_pct ?? d.pctChg,
          change: d.change ?? d.priceChange ?? d.price_change,
          high: d.high,
          low: d.low,
          open: d.open,
          volume: d.volume,
          amount: d.amount,
          turnover: d.turnover ?? d.turnoverRate,
        };
      } catch (e) {
        console.warn(`尧帝V2实时行情获取失败 ${code}:`, e.message);
      }

      // 实时行情过滤：补充行情后发现涨停/跌停也需过滤
      const rtChangePct = realtime.changePercent ?? changePct;
      const _rtHL = code.startsWith('300') || code.startsWith('301') || code.startsWith('688') || code.startsWith('689');
      const _rtLP = _rtHL ? 19.5 : 9.5;
      if (Math.abs(rtChangePct) >= _rtLP) continue;

      results.push({
        ...sig,
        code,
        name,
        price: realtime.price ?? sig.price ?? 0,
        changePercent: rtChangePct,
        change: realtime.change ?? 0,
        high: realtime.high ?? sig.price ?? 0,
        low: realtime.low ?? sig.price ?? 0,
        open: realtime.open ?? sig.price ?? 0,
        volume: realtime.volume ?? 0,
        amount: realtime.amount ?? 0,
        turnover: realtime.turnover ?? 0,
        score: l2Score,
        yaodiConfidence: confidence,
        positionPct,
        // Phase升级信息
        techSignal: sig.tech_signal || 'neutral',
        techScore: sig.tech_score || 50,
        marketRegime: sig.market_regime || 'UNKNOWN',
        sectorStrength: sig.sector_strength || 'neutral',
        kellyPct: (kellyPct * 100).toFixed(1) + '%',
        signalStatus: sig.signal_status || 'buy',
        source: '尧帝V2引擎',
        reason: sig.reason || `尧帝V2 L3信号 | 置信度${confidence}% | 凯利${(kellyPct*100).toFixed(1)}%`,
      });
    }
    return results;
  };

  // 加载尧帝准确率等指标
  useEffect(() => {
    loadFromAPI();
  }, []);
  const [activeTab, setActiveTab] = useState('morning');
  const [selectedStocks, setSelectedStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [morningSelection, setMorningSelection] = useState([]);
  const [eveningSelection, setEveningSelection] = useState([]);
  // ━━━ 三层引擎选股结果（自动从后端加载） ━━━
  const [threeLayerMorning, setThreeLayerMorning] = useState([]);
  const [threeLayerEvening, setThreeLayerEvening] = useState([]);
  const [detailStock, setDetailStock] = useState(null);
  // 市场环境（从选股结果中提取）
  const [marketEnv, setMarketEnv] = useState(null);
  const [showLogicModal, setShowLogicModal] = useState(false);
  const [savedSnapshots, setSavedSnapshots] = useState(null);
  // ━━━ 历史选股弹窗 ━━━
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [toast, setToast] = useState(null); // 弱提醒 { message, type }

  // 加入收藏股并弹窗提示
  const handleAddWithToast = (stock) => {
    addToPool(stock);
    const name = stock?.name || stock?.stock_name || stock?.code || '股票';
    setToast({ message: `✅ ${name} 已加入收藏股`, type: 'success' });
    setTimeout(() => setToast(null), 2000);
  };

  // 弹窗打开时锁定背景滚动
  useBodyScrollLock(showLogicModal || showHistoryModal);

  // 加载已保存的选股快照
  useEffect(() => {
    const loadSnapshots = async () => {
      try {
        const res = await selectionAPI.load();
        const data = await res;
        if (data.success && data.stocks && data.stocks.length > 0) {
          setSavedSnapshots(data.stocks);
        }
      } catch(e) {}
    };
    loadSnapshots();
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // 尧帝选股时间限制：交易日 9:30 前（早盘）和 14:30 后（尾盘）
  // ═══════════════════════════════════════════════════════════════
  const isMorningTime = () => {
    const now = toBeijingTime(new Date());
    const h = now.getHours(), m = now.getMinutes();
    return h < 9 || (h === 9 && m <= 30);
  };

  const isEveningTime = () => {
    const now = toBeijingTime(new Date());
    const h = now.getHours(), m = now.getMinutes();
    return h > 14 || (h === 14 && m >= 30);
  };

  const isWeekday = () => {
    const day = toBeijingTime(new Date()).getDay();
    return day >= 1 && day <= 5; // 周一到周五
  };

  // 智能选股（初始化加载）
  useEffect(() => {
    const loadSelections = async () => {
      setLoading(true);

      // ━━━ 超时保护：30秒兜底，防止任何 await 永远挂起导致 loading 卡死 ━━━
      const TIMEOUT_MS = 30000;
      const timeoutId = setTimeout(() => {
        console.error('⏰ loadSelections 超时（30s），强制结束 loading');
        setLoading(false);
      }, TIMEOUT_MS);

      try {
        // 首次初始化选股数据库
        await initializeSelectionDatabase();

        // ═══════════════════════════════════════════════════════════════
        // 尧帝选股时间限制：交易日 9:30 前（早盘）和 14:30 后（尾盘）
        // ═══════════════════════════════════════════════════════════════
        const isTradingDay = isWeekday();

        if (!isTradingDay) {
          // 非交易日：仅加载今日快照（无则留空，历史记录在"历史选股"弹窗中查看）
          console.log('📅 非交易日，尝试加载今日快照');
          try {
            const today = bjDate();
            // 舜帝引擎
            for (const [type, setter] of [['morning_shundi', setMorningSelection], ['evening_shundi', setEveningSelection]]) {
              const res = await selectionAPI.load(type, today);
              const data = await res;
              if (data.success && data.stocks?.length) {
                setter(data.stocks.slice(0, 3));
              } else {
                setter([]);
              }
            }
            // 三层引擎
            for (const [type, setter] of [['morning_threelayer', setThreeLayerMorning], ['evening_threelayer', setThreeLayerEvening]]) {
              const res = await selectionAPI.load(type, today);
              const data = await res;
              if (data.success && data.stocks?.length) {
                setter(data.stocks.slice(0, 3));
              } else {
                setter([]);
              }
            }
          } catch (e) {
            console.log('📅 非交易日加载快照失败:', e.message);
            setMorningSelection([]);
            setEveningSelection([]);
            setThreeLayerMorning([]);
            setThreeLayerEvening([]);
          }
          setLoading(false);
          return;
        }

        // ━━━ 交易日：加载双引擎选股结果 ━━━
        // 舜帝引擎 — 仍用 performStockSelection 兼容实时行情增强
        // 【关键修复】舜帝引擎也添加时间窗口检查
        {
          const now = toBeijingTime();
          const hours = now.getHours();
          const minutes = now.getMinutes();
          const currentTime = hours * 60 + minutes;
          
          const morningStart = 9 * 60 + 15;  // 9:15
          const morningEnd = 9 * 60 + 30;   // 9:30
          const eveningStart = 14 * 60 + 30; // 14:30
          const eveningEnd = 15 * 60;        // 15:00
          
          const isInMorningWindow = currentTime >= morningStart && currentTime <= morningEnd;
          const isInEveningWindow = currentTime >= eveningStart && currentTime <= eveningEnd;
          const morningWindowPassed = currentTime > morningEnd;
          const eveningWindowPassed = currentTime > eveningEnd;
          
          // 早盘
          const morningResult = await performStockSelection('morning_shundi');
          if (isInMorningWindow || morningWindowPassed) {
            setMorningSelection(morningResult.slice(0, 3));
            if (morningResult[0]?.marketEnvironment) setMarketEnv(morningResult[0].marketEnvironment);
            console.log(`🌅 早盘(舜帝)选股加载完成: ${morningResult.length}只`);
          } else {
            setMorningSelection([]);
            console.log(`🌅 早盘选股时间未到(9:15前)，本次结果为空`);
          }
          
          // 尾盘
          const eveningResult = await performStockSelection('evening_shundi');
          if (isInEveningWindow || eveningWindowPassed) {
            setEveningSelection(eveningResult.slice(0, 3));
            if (eveningResult[0]?.marketEnvironment && !morningSelection.length) setMarketEnv(eveningResult[0].marketEnvironment);
            console.log(`🌙 尾盘(舜帝)选股加载完成: ${eveningResult.length}只`);
          } else {
            setEveningSelection([]);
            console.log(`🌙 尾盘选股时间未到(14:30前)，本次结果为空`);
          }
        }
        // 【已更新2026-07-08】尧帝V2引擎 — 先尝试快照，快照为空则调用 /api/yaodi-v2/l3-signals
        // 【关键修复】添加时间窗口检查，防止早盘快照在尾盘时段显示
        {
          const today = bjDate();
          const now = toBeijingTime();
          const hours = now.getHours();
          const minutes = now.getMinutes();
          const currentTime = hours * 60 + minutes;
          
          // 时间窗口
          const morningStart = 9 * 60 + 15;  // 9:15
          const morningEnd = 9 * 60 + 30;   // 9:30
          const eveningStart = 14 * 60 + 30; // 14:30
          const eveningEnd = 15 * 60;        // 15:00
          
          const isInMorningWindow = currentTime >= morningStart && currentTime <= morningEnd;
          const isInEveningWindow = currentTime >= eveningStart && currentTime <= eveningEnd;
          const morningWindowPassed = currentTime > morningEnd;
          const eveningWindowPassed = currentTime > eveningEnd;
          
          // 尝试加载快照
          const [mRes, eRes] = await Promise.all([
            selectionAPI.load('morning_yaodi_v2', today),
            selectionAPI.load('evening_yaodi_v2', today),
          ]);
          const mData = await mRes, eData = await eRes;
          
          // 早盘：仅在早盘窗口内或窗口已过后使用快照
          if (mData.success && mData.signals?.length && (isInMorningWindow || morningWindowPassed)) {
            setThreeLayerMorning(await enhanceYaodiV2(mData.signals.slice(0, 3)));
            console.log(`🌅 早盘(尧帝V2)选股加载完成(快照): ${mData.signals.length}只`);
          } else if (mData.success && mData.signals?.length && !morningWindowPassed && !isInMorningWindow) {
            // 早盘窗口未到，清空
            setThreeLayerMorning([]);
            console.log(`🌅 早盘选股时间未到(9:15前)，本次结果为空`);
          } else if (!mData.success || !mData.signals?.length) {
            // 快照为空
            if (isInMorningWindow || morningWindowPassed) {
              // 仅在早盘窗口内或窗口已过后调用API
              console.log('📡 尧帝V2快照为空，调用 /api/yaodi-v2/l3-signals...');
              try {
                const resp = await fetch(`${API_BASE}/yaodi-v2/l3-signals?limit=3`);
                const data = await resp.json();
                if (data.success && data.signals?.length) {
                  const enhanced = await enhanceYaodiV2(data.signals.slice(0, 3));
                  setThreeLayerMorning(enhanced);
                  console.log(`🌅 早盘(尧帝V2)选股加载完成(API): ${data.signals.length}只`);
                } else {
                  setThreeLayerMorning([]);
                  console.log('🌅 早盘(尧帝V2)选股为空 - 当前市场格局不适合选股或非交易时段');
                }
              } catch(e) {
                console.error('尧帝V2 API调用失败:', e.message);
                setThreeLayerMorning([]);
              }
            } else {
              // 早盘窗口未到，不调用API
              setThreeLayerMorning([]);
              console.log(`🌅 早盘选股时间未到(9:15前)，快照为空不调用API`);
            }
          }
          
          // 尾盘：仅在尾盘窗口内或窗口已过后使用快照
          if (eData.success && eData.signals?.length && (isInEveningWindow || eveningWindowPassed)) {
            setThreeLayerEvening(await enhanceYaodiV2(eData.signals.slice(0, 3)));
            console.log(`🌙 尾盘(尧帝V2)选股加载完成(快照): ${eData.signals.length}只`);
          } else if (eData.success && eData.signals?.length && !eveningWindowPassed && !isInEveningWindow) {
            // 尾盘窗口未到，清空
            setThreeLayerEvening([]);
            console.log(`🌙 尾盘选股时间未到(14:30前)，本次结果为空`);
          } else if (!eData.success || !eData.signals?.length) {
            // 尾盘快照为空
            if (isInEveningWindow || eveningWindowPassed) {
              // 仅在尾盘窗口内或窗口已过后调用API
              try {
                const resp = await fetch(`${API_BASE}/yaodi-v2/l3-signals?limit=3`);
                const data = await resp.json();
                if (data.success && data.signals?.length) {
                  const enhanced = await enhanceYaodiV2(data.signals.slice(0, 3));
                  setThreeLayerEvening(enhanced);
                  console.log(`🌙 尾盘(尧帝V2)选股加载完成(API): ${data.signals.length}只`);
                } else {
                  setThreeLayerEvening([]);
                  console.log('🌙 尾盘(尧帝V2)选股为空 - 当前市场格局不适合选股或非交易时段');
                }
              } catch(e) {
                console.error('尧帝V2 API调用失败:', e.message);
                setThreeLayerEvening([]);
              }
            } else {
              // 尾盘窗口未到，不调用API
              setThreeLayerEvening([]);
              console.log(`🌙 尾盘选股时间未到(14:30前)，快照为空不调用API`);
            }
          }
        }
        console.log('🧠 双引擎选股加载完成');
      } catch (error) {
        console.error('选股失败:', error);
      } finally {
        setLoading(false);
        clearTimeout(timeoutId);
      }
    };
    loadSelections();

    // 注册实时刷新（每30秒刷新一次，但不重新选股——只更新实时价格）
    // 选股结果当天固定，避免每次刷新结果不同
    console.log('✅ [useEffect] StockSelection useEffect mounted - registering refresh');
    const unregister = registerPageRefresh('stockSelection', async () => {
      console.log('🔄 [realtimeRefresh] 智能选股价格刷新（不重新选股）');
      if (!isWeekday()) {
        console.log('📅 非交易日，跳过实时刷新');
        return;
      }
      try {
        // 舜帝引擎实时行情刷新
        const [morningResult, eveningResult] = await Promise.all([
          performStockSelection('morning_shundi', false),
          performStockSelection('evening_shundi', false),
        ]);
        
        // 时间窗口检查
        const now = toBeijingTime();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const currentTime = hours * 60 + minutes;
        const morningEnd = 9 * 60 + 30;   // 9:30
        const eveningStart = 14 * 60 + 30; // 14:30
        const eveningEnd = 15 * 60;        // 15:00
        const morningWindowPassed = currentTime > morningEnd;
        const isInEveningWindow = currentTime >= eveningStart && currentTime <= eveningEnd;
        const eveningWindowPassed = currentTime > eveningEnd;
        
        if (morningResult.length > 0 && morningWindowPassed) setMorningSelection(morningResult.slice(0, 3));
        if (eveningResult.length > 0 && (isInEveningWindow || eveningWindowPassed)) setEveningSelection(eveningResult.slice(0, 3));
        
        // 三层引擎快照刷新
        const today = bjDate();
        const [mRes, eRes] = await Promise.all([
          selectionAPI.load('morning_threelayer', today),
          selectionAPI.load('evening_threelayer', today),
        ]);
        const mData = await mRes, eData = await eRes;
        if (mData.success && mData.stocks?.length && morningWindowPassed) setThreeLayerMorning(await enhanceThreeLayer(mData.stocks.slice(0, 3)));
        if (eData.success && eData.stocks?.length && (isInEveningWindow || eveningWindowPassed)) setThreeLayerEvening(await enhanceThreeLayer(eData.stocks.slice(0, 3)));
      } catch (e) {
        console.error('🔄 实时刷新失败:', e);
      }
    });

    return () => {
      unregister?.();
    };
  }, []); // 空依赖——初始化只执行一次，实时刷新同时更新早盘+尾盘

  // 刷新选股（严格遵循时间限制）
  // 早盘选股：仅 9:30 之前
  // 尾盘选股：仅 14:30 之后
  const refreshSelection = async () => {
    if (!isWeekday()) {
      alert('📅 非交易日，无法执行尧帝选股');
      return;
    }

    setLoading(true);
    try {
      const now = toBeijingTime();
      const h = now.getHours(), m = now.getMinutes();
      const currentTime = h * 60 + m;
      const morningDeadline = 9 * 60 + 30;
      const eveningStart = 14 * 60 + 30;
      const forceNew = currentTime < morningDeadline || currentTime >= eveningStart;

      // 舜帝引擎刷新
      const shundiType = activeTab === 'morning' ? 'morning_shundi' : 'evening_shundi';
      console.log(`🔄 刷新舜帝引擎 ${shundiType}`);
      const result = await performStockSelection(shundiType, forceNew);
      if (activeTab === 'morning') {
        setMorningSelection(result.slice(0, 3));
      } else {
        setEveningSelection(result.slice(0, 3));
      }

      // 三层引擎快照刷新
      const today = bjDate();
      const tlType = activeTab === 'morning' ? 'morning_threelayer' : 'evening_threelayer';
      const tlRes = await selectionAPI.load(tlType, today);
      const tlData = await tlRes;
      if (tlData.success && tlData.stocks?.length) {
        const enhanced = await enhanceThreeLayer(tlData.stocks.slice(0, 3));
        if (activeTab === 'morning') setThreeLayerMorning(enhanced);
        else setThreeLayerEvening(enhanced);
      }

      setSelectedStocks([]);
      console.log(`✅ 刷新完成`);
    } catch (error) {
      console.error('刷新选股失败:', error);
      alert('刷新失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const toggleStock = (code) => {
    setSelectedStocks(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const handleAddSelectedToPool = () => {
    const currentSelection = activeTab === 'morning' ? morningSelection : eveningSelection;
    selectedStocks.forEach(code => {
      const stock = currentSelection.find(s => s.code === code);
      if (stock) addToPool(stock);
    });
    // 弱提醒：2秒后自动消失
    setToast({ message: `已加入收藏股 ${selectedStocks.length} 只`, type: 'success' });
    setTimeout(() => setToast(null), 2000);
    setSelectedStocks([]);
  };

  const currentSelection = activeTab === 'morning' ? morningSelection : eveningSelection;
  const currentThreeLayer = activeTab === 'morning' ? threeLayerMorning : threeLayerEvening;

  return (
    <div className="ss-page flex-1 flex flex-col overflow-hidden">
      {/* 个股详情弹窗 */}
      {detailStock && (
        <StockDetailModal
          stock={detailStock}
          onClose={() => setDetailStock(null)}
          onAddToPool={handleAddWithToast}
        />
      )}

      {/* 弱提醒 Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in ${
          toast.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-blue-500/90 text-white'
        }`}>
          <CheckCircle className="w-4 h-4" />
          <span className="text-sm">{toast.message}</span>
        </div>
      )}

      {/* 头部 */}
      <div className="p-6 border-b border-[var(--border-light)]">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="page-title">智能选股</h1>
            <p className="page-subtitle">
              尧帝智能体全维度分析 · 智能选股系统
              {savedSnapshots && savedSnapshots.length > 0 && (
                <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                  | 已保存快照 {savedSnapshots.length} 只
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* 市场环境标签 */}
            {marketEnv && marketEnv !== 'unknown' && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                marketEnv === 'bull' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                marketEnv === 'bear' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                'bg-gray-500/10 text-gray-400 border-gray-500/20'
              }`}>
                <span>{marketEnv === 'bull' ? '🐂' : marketEnv === 'bear' ? '🐻' : '📊'}</span>
                <span>{marketEnv === 'bull' ? '牛市' : marketEnv === 'bear' ? '熊市' : '震荡市'}</span>
              </div>
            )}
            <div className="text-sm text-[var(--text-secondary)]">
              尧帝准确率: <span className="text-purple-400 font-semibold">{metrics.accuracy != null ? `${Number(metrics.accuracy).toFixed(1)}%` : '--'}</span>
            </div>
            {/* 尧帝选股时间状态提示 */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${
              !isWeekday() ? 'bg-gray-500/10 text-gray-400 border-gray-500/30' :
              isMorningTime() ? 'bg-green-500/10 text-green-400 border-green-500/30' :
              isEveningTime() ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
              'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
            }`}>
              <span>{!isWeekday() ? '📅' : isMorningTime() ? '🌅' : isEveningTime() ? '🌙' : '⏰'}</span>
              <span>{!isWeekday() ? '非交易日' : isMorningTime() ? '早盘选股时间（9:30前）' : isEveningTime() ? '尾盘选股时间（14:30后）' : '交易时段（9:30-14:30）'}</span>
            </div>
            <button
              onClick={refreshSelection}
              disabled={loading}
              className="btn btn-primary"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? '选股中...' : '刷新选股'}
            </button>
            <button
              onClick={() => setShowHistoryModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg text-sm"
            >
              <Calendar className="w-4 h-4" />
              历史选股
            </button>
            {/* 选股逻辑按钮 */}
            <button
              onClick={() => setShowLogicModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg text-sm"
            >
              <Brain className="w-4 h-4" />
              选股逻辑
            </button>
          </div>
        </div>

        {/* Tab切换 */}
        <div className="flex gap-4 mt-4">
          <button
            onClick={() => { setActiveTab('morning'); setSelectedStocks([]); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'morning'
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:border-[var(--border-color)]'
            }`}
          >
            <Clock className="w-4 h-4 inline mr-2" />
            早盘选股
            <span className="ml-1.5 text-xs opacity-70">今日+未来几日上涨概率最大</span>
          </button>
          <button
            onClick={() => { setActiveTab('evening'); setSelectedStocks([]); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'evening'
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:border-[var(--border-color)]'
            }`}
          >
            <Clock className="w-4 h-4 inline mr-2" />
            尾盘选股
            <span className="ml-1.5 text-xs opacity-70">次日+未来几日上涨概率最大</span>
          </button>
        </div>
      </div>

      {/* 内容区：双引擎上下联布局 */}
      <div className="flex-1 p-6" style={{ overflowY: 'auto' }}>
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
          </div>
        ) : (
          <>
            {/* ━━━━━━ 舜帝选股逻辑 ━━━━━━ */}
            <div className="mb-8">
              {/* 区块标题 + 逻辑概要 */}
              <div className="mb-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center">
                      <Target className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-[var(--text-primary)]">舜帝选股</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-medium">9维评分</span>
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                        {activeTab === 'morning'
                          ? `🌅 早盘 ${currentSelection.length} 只`
                          : currentSelection.length > 0
                            ? `🌆 尾盘 ${currentSelection.length} 只`
                            : `🌆 尾盘 · 14:30 自动启动`}
                      </p>
                    </div>
                  </div>
                  {selectedStocks.length > 0 && (
                    <button
                      onClick={handleAddSelectedToPool}
                      className="px-4 py-2 bg-green-500 hover:bg-green-600 rounded-lg text-[var(--text-primary)] text-sm flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      批量加入收藏股 ({selectedStocks.length})
                    </button>
                  )}
                </div>
                {/* 舜帝选股逻辑简述 */}
                <div className="mt-3 bg-cyan-500/5 border border-cyan-500/15 rounded-xl p-4">
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="space-y-1.5">
                      <div className="text-cyan-300 font-bold text-[11px]">📡 双源候选</div>
                      <div className="text-[var(--text-tertiary)]">尧帝标签信号（高置信度策略分支） + 舜帝全市场量化扫描（6000→400只初筛）</div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-cyan-300 font-bold text-[11px]">⚖️ 5维综合评分</div>
                      <div className="text-[var(--text-tertiary)]">
                        标签25% + 技术25% + 动量25% + 大盘强度15% + 支撑阻力10%
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-cyan-300 font-bold text-[11px]">🛑 大盘择时硬拦截</div>
                      <div className="text-[var(--text-tertiary)]">
                        崩盘(跌&gt;0.5%+普跌)→停止选股 · 弱势→限选2只 · 强势→积极选股
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 选股结果 */}
              {activeTab === 'evening' && !isEveningTime() && currentSelection.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)] gap-4">
                  <div className="text-5xl">🕑</div>
                  <p className="text-lg font-medium text-[var(--text-secondary)]">尾盘选股时间未到</p>
                  <p className="text-sm text-[var(--text-tertiary)]">舜帝将在 <span className="text-amber-400 font-bold">14:30</span> 之后自动启动尾盘选股</p>
                </div>
              ) : currentSelection.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="text-5xl">📭</div>
                  <p className="text-base font-medium text-[var(--text-secondary)]">舜帝选股无达标股票</p>
                  <p className="text-xs text-[var(--text-tertiary)]">舜帝坚持高胜率标准，未找到符合条件的个股</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {currentSelection.map(stock => (
                    <SelectionCard
                      key={stock.code}
                      stock={stock}
                      onAddToPool={handleAddWithToast}
                      selected={selectedStocks.includes(stock.code)}
                      onToggle={toggleStock}
                      isSnapshot={shouldUseSnapshot(activeTab === 'morning' ? 'morning_shundi' : 'evening_shundi')}
                      onDetail={setDetailStock}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ━━━━━━ 尧帝选股逻辑 ━━━━━━ */}
            <div className="pt-6 border-t border-[var(--border-light)]">
              {/* 区块标题 + 逻辑概要 */}
              <div className="mb-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                      <Brain className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-[var(--text-primary)]">尧帝选股</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">L1+L2+L3</span>
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                        {activeTab === 'morning'
                          ? `🌅 早盘 ${currentThreeLayer.length} 只`
                          : `🌆 尾盘 ${currentThreeLayer.length} 只`}
                      </p>
                    </div>
                  </div>
                </div>
                {/* 尧帝选股逻辑简述 */}
                <div className="mt-3 bg-purple-500/5 dark:bg-purple-500/5 border border-purple-500/15 rounded-xl p-4">
                  <div className="grid grid-cols-3 gap-3">
                    {/* L1 */}
                    <div className="bg-blue-500/10 dark:bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-bold bg-blue-500/30 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded">L1 · 70%</span>
                        <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-300">因子投票初筛</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {['💰估值', '📈成长', '⭐质量', '🚀动量', '🛡️波动'].map(f => (
                          <span key={f} className="text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-200 px-1.5 py-0.5 rounded">{f}</span>
                        ))}
                      </div>
                    </div>
                    {/* L2 */}
                    <div className="bg-purple-500/10 dark:bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-bold bg-purple-500/30 text-purple-600 dark:text-purple-300 px-1.5 py-0.5 rounded">L2 · 20%</span>
                        <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-300">AI精细评分</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {['XGBoost集成', 'LSTM时序', '周训练'].map(f => (
                          <span key={f} className="text-[10px] bg-purple-500/10 text-purple-700 dark:text-purple-200 px-1.5 py-0.5 rounded">{f}</span>
                        ))}
                      </div>
                    </div>
                    {/* L3 */}
                    <div className="bg-red-500/10 dark:bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-bold bg-red-500/30 text-red-600 dark:text-red-300 px-1.5 py-0.5 rounded">L3 · 10%</span>
                        <span className="text-[11px] font-semibold text-red-600 dark:text-red-300">风控过滤</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {['ST排除', '688过滤', '涨跌停不追', 'AI下跌过滤'].map(f => (
                          <span key={f} className="text-[10px] bg-red-500/10 text-red-700 dark:text-red-200 px-1.5 py-0.5 rounded">{f}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 选股结果 */}
              {currentThreeLayer.length > 0 ? (
                <div className="grid grid-cols-3 gap-4">
                  {currentThreeLayer.map(stock => (
                    <ThreeLayerStockCard
                      key={stock.code}
                      stock={stock}
                      onAddToPool={handleAddWithToast}
                      onDetail={setDetailStock}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)] gap-3">
                  <div className="text-4xl">📭</div>
                  <p className="text-sm font-medium text-[var(--text-secondary)]">
                    {marketEnv === 'crash'
                      ? '大盘崩盘，尧帝选股已停止'
                      : marketEnv === 'bear'
                      ? '大盘弱势，尧帝选股受限'
                      : activeTab === 'evening' && !isEveningTime()
                      ? '尾盘选股时间未到，14:30后自动启动'
                      : '尧帝选股无达标股票'}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)]">等待市场回暖或下次定时选股</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ━━━ 历史选股记录弹窗 ━━━ */}
      {showHistoryModal && (
        <HistorySelectionModal onClose={() => setShowHistoryModal(false)} onAddToPool={handleAddWithToast} />
      )}

      {/* ━━━ 选股逻辑弹窗 ━━━ */}
      {showLogicModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowLogicModal(false)}>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl w-[800px] max-h-[85vh] flex flex-col shadow-2xl logic-modal-root"
            style={{ height: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            {/* 标题栏 - 固定 */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-cyan-400" />
                <span className="text-lg font-bold text-cyan-400">选股逻辑</span>
              </div>
              <button onClick={() => setShowLogicModal(false)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 内容 - 可滚动 */}
            <div className="px-6 py-5 space-y-6 logic-modal-body" style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>

              {/* ══════ 舜帝选股逻辑 ══════ */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center">
                    <Target className="w-3.5 h-3.5 text-white" />
                  </div>
                  <h3 className="text-sm font-bold text-cyan-400">舜帝选股逻辑</h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-medium">9维评分 + 大盘择时</span>
                </div>

                {/* 双源候选 */}
                <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-xl p-4 space-y-4">
                  <div>
                    <div className="text-xs font-bold text-cyan-300 mb-2">📡 双源候选池</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-cyan-500/10 rounded-lg p-3">
                        <div className="text-[11px] font-semibold text-cyan-200 mb-1">尧帝标签信号</div>
                        <div className="text-[10px] text-[var(--text-tertiary)]">尧帝演化策略分支产生的高置信度买入信号，按confidence降序取前80只</div>
                      </div>
                      <div className="bg-cyan-500/10 rounded-lg p-3">
                        <div className="text-[11px] font-semibold text-cyan-200 mb-1">舜帝全市场量化扫描</div>
                        <div className="text-[10px] text-[var(--text-tertiary)]">从6000只A股中量化筛选：价格2-200元、涨跌-8%~8%、成交量&gt;50万、排除ST/涨跌停/科创板，初筛约400只</div>
                      </div>
                    </div>
                  </div>

                  {/* 5维综合评分 */}
                  <div>
                    <div className="text-xs font-bold text-cyan-300 mb-2">⚖️ 5维综合评分</div>
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { name: '尧帝标签', pct: '25%', icon: '🏷️', desc: '尧帝accuracy映射50-100，扫描默认65' },
                        { name: '技术面', pct: '25%', icon: '📊', desc: '量价配合、价格位置、RSI超买超卖' },
                        { name: '动量', pct: '25%', icon: '🚀', desc: '涨跌幅甜区、趋势延续性、量价背离' },
                        { name: '大盘强度', pct: '15%', icon: '📈', desc: '个股与大盘联动，牛市跟涨/熊市抗跌加分' },
                        { name: '支撑阻力', pct: '10%', icon: '🎯', desc: '近支撑位加分、近阻力位扣分' },
                      ].map(f => (
                        <div key={f.name} className="bg-cyan-500/5 rounded-lg p-2 text-center">
                          <div className="text-lg">{f.icon}</div>
                          <div className="text-[11px] font-bold text-cyan-200">{f.name}</div>
                          <div className="text-[10px] text-cyan-400 font-bold">{f.pct}</div>
                          <div className="text-[9px] text-[var(--text-tertiary)] mt-0.5 leading-tight">{f.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 大盘择时 */}
                  <div>
                    <div className="text-xs font-bold text-cyan-300 mb-2">🛑 大盘择时硬拦截</div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center">
                        <div className="text-base">🚨</div>
                        <div className="text-[11px] font-bold text-red-300">崩盘</div>
                        <div className="text-[9px] text-[var(--text-tertiary)]">上证跌&gt;0.5%+普跌</div>
                        <div className="text-[10px] text-red-400 font-bold mt-1">→ 停止选股</div>
                      </div>
                      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 text-center">
                        <div className="text-base">⚠️</div>
                        <div className="text-[11px] font-bold text-yellow-300">弱势</div>
                        <div className="text-[9px] text-[var(--text-tertiary)]">跌&gt;0.3%或涨少跌多</div>
                        <div className="text-[10px] text-yellow-400 font-bold mt-1">→ 限选2只</div>
                      </div>
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2 text-center">
                        <div className="text-base">📊</div>
                        <div className="text-[11px] font-bold text-green-300">震荡</div>
                        <div className="text-[9px] text-[var(--text-tertiary)]">正常波动</div>
                        <div className="text-[10px] text-green-400 font-bold mt-1">→ 正常选股</div>
                      </div>
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center">
                        <div className="text-base">🐂</div>
                        <div className="text-[11px] font-bold text-red-300">强势</div>
                        <div className="text-[9px] text-[var(--text-tertiary)]">涨&gt;0.5%+普涨</div>
                        <div className="text-[10px] text-red-400 font-bold mt-1">→ 积极选股</div>
                      </div>
                    </div>
                  </div>

                  {/* 前端9维评分补充 */}
                  <div>
                    <div className="text-xs font-bold text-cyan-300 mb-2">🔬 前端9维细化评分（在5维基础上展开）</div>
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      {[
                        { dim: '维度1', name: '涨跌幅甜区', desc: '早盘1-4%/尾盘0.5-2.5%最优' },
                        { dim: '维度2', name: '成交量活跃度', desc: '放量上涨加分，缩量下跌减分' },
                        { dim: '维度3', name: '价格弹性/振幅', desc: '适度振幅=多空充分博弈' },
                        { dim: '维度4', name: '价格流动性区间', desc: '机构+散户双向参与度' },
                        { dim: '维度5', name: '趋势延续性', desc: '熊市追高惩罚，低涨放量加分' },
                        { dim: '维度6', name: '尧帝分支投票', desc: '多策略分支一致性加权' },
                        { dim: '维度7', name: '市场情绪', desc: '板块阶段判断（启动vs见顶）' },
                        { dim: '维度8', name: '夏普比率', desc: '系统选股质量可靠性' },
                        { dim: '维度9', name: '大盘强度联动', desc: '个股与大盘联动性评分' },
                      ].map(d => (
                        <div key={d.dim} className="flex items-start gap-1.5 bg-cyan-500/5 px-2 py-1.5 rounded">
                          <span className="text-cyan-400 font-bold shrink-0">{d.dim}</span>
                          <span className="text-[var(--text-secondary)]">{d.name}</span>
                          <span className="text-[var(--text-tertiary)]">· {d.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 分隔线 */}
              <div className="border-t border-[var(--border-light)]" />

              {/* ══════ 尧帝选股逻辑 ══════ */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                    <Brain className="w-3.5 h-3.5 text-white" />
                  </div>
                  <h3 className="text-sm font-bold text-purple-400">智能选股逻辑</h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">L1+L2+L3 三层架构</span>
                </div>

                <div className="bg-purple-500/5 border border-purple-500/15 rounded-xl p-4 space-y-4">
                  {/* 三层架构 */}
                  <div className="space-y-3">
                    {/* L1 */}
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded">L1 · 70%权重</span>
                        <span className="text-sm font-semibold text-blue-300">因子投票初筛</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mb-2">五大类因子多因子投票，AI动态权重根据市场环境自动切换</p>
                      <div className="grid grid-cols-5 gap-2 text-center">
                        {[
                          { name: '估值', icon: '💰', desc: 'PE/PB/PS/股息率' },
                          { name: '成长', icon: '📈', desc: '营收/利润增长' },
                          { name: '质量', icon: '⭐', desc: 'ROE/毛利率/净利率' },
                          { name: '动量', icon: '🚀', desc: '5/20/60日动量+RSI+MACD' },
                          { name: '波动率', icon: '🛡️', desc: '20日波动率+ATR' },
                        ].map(f => (
                          <div key={f.name} className="bg-blue-500/5 rounded-lg p-2">
                            <div className="text-lg">{f.icon}</div>
                            <div className="text-xs font-bold text-blue-200">{f.name}</div>
                            <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{f.desc}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* L2 */}
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded">L2 · 20%权重</span>
                        <span className="text-sm font-semibold text-purple-300">AI精细评分</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mb-2">XGBoost集成学习在候选范围内二次排序，捕捉因子间非线性交互效应</p>
                      <div className="flex gap-2 text-xs">
                        <span className="bg-purple-500/10 text-purple-300 px-2 py-1 rounded">5棵决策树集成</span>
                        <span className="bg-purple-500/10 text-purple-300 px-2 py-1 rounded">LSTM时序趋势</span>
                        <span className="bg-purple-500/10 text-purple-300 px-2 py-1 rounded">每周自动训练</span>
                      </div>
                    </div>
                    {/* L3 */}
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold bg-red-500/30 text-red-300 px-2 py-0.5 rounded">L3 · 10%权重</span>
                        <span className="text-sm font-semibold text-red-300">规则+AI风控过滤</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mb-2">硬规则排除高风险标的，AI下跌概率预测二次过滤</p>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        {[
                          { rule: 'ST/*ST排除', type: '硬规则' },
                          { rule: '科创板688过滤', type: '硬规则' },
                          { rule: '北交所8xx过滤', type: '硬规则' },
                          { rule: '涨跌停不追', type: '硬规则' },
                          { rule: '流动性<100万排除', type: '硬规则' },
                          { rule: 'AI下跌概率>40%排除', type: 'AI风控' },
                        ].map(r => (
                          <div key={r.rule} className="flex items-center gap-1 bg-red-500/5 px-2 py-1 rounded">
                            <span className={`w-1.5 h-1.5 rounded-full ${r.type === '硬规则' ? 'bg-red-400' : 'bg-amber-400'}`}></span>
                            <span className="text-[var(--text-secondary)]">{r.rule}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 风格轮动 */}
                  <div>
                    <div className="text-xs font-bold text-purple-300 mb-2">🎨 风格轮动策略</div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { env: '牛市', emoji: '🐂', weights: '动量40% · 成长25% · 质量15% · 估值10% · 波动10%', color: 'red' },
                        { env: '震荡', emoji: '📊', weights: '质量25% · 估值25% · 成长20% · 动量15% · 波动15%', color: 'yellow' },
                        { env: '熊市', emoji: '🐻', weights: '波动30% · 估值25% · 质量25% · 动量10% · 成长10%', color: 'green' },
                      ].map(s => (
                        <div key={s.env} className={`bg-${s.color}-500/10 border border-${s.color}-500/20 rounded-xl p-3`}>
                          <div className="text-lg mb-1">{s.emoji} {s.env}</div>
                          <div className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">{s.weights}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 尧帝置信度 */}
                  <div>
                    <div className="text-xs font-bold text-purple-300 mb-2">🧠 尧帝置信度计算</div>
                    <div className="text-xs text-[var(--text-secondary)] space-y-1.5">
                      <div><span className="text-purple-300 font-bold">公式：</span>尧帝置信度 = 三层评分 × 0.6 + 尧帝准确率 × 0.4</div>
                      <div><span className="text-purple-300 font-bold">三层评分：</span>L1评分(70%) + L2评分(30%) 综合加权</div>
                      <div><span className="text-purple-300 font-bold">尧帝准确率：</span>演化策略的历史胜率，来自尧帝大脑全局感知</div>
                      <div><span className="text-purple-300 font-bold">仓位建议：</span>置信度≥85%标准仓(20-30%) · ≥75%轻仓(10-20%) · &lt;75%观察仓(5-10%)</div>
                    </div>
                  </div>

                  {/* 大盘择时 */}
                  <div>
                    <div className="text-xs font-bold text-purple-300 mb-2">🛑 大盘择时硬拦截</div>
                    <div className="text-xs text-[var(--text-secondary)] space-y-1">
                      <div>• <span className="text-red-400 font-bold">崩盘</span>→ 返回空数组，停止选股</div>
                      <div>• <span className="text-yellow-400 font-bold">弱势</span>→ limit减半，限制选股数量</div>
                      <div>• <span className="text-green-400 font-bold">震荡/强势</span>→ 正常选股</div>
                      <div>• <span className="text-[var(--text-tertiary)]">恐惧时减仓</span>（A股短线逻辑，非巴菲特"恐惧时贪婪"）</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 底部 - 固定 */}
            <div className="px-6 py-3 border-t border-[var(--border-color)] flex justify-end" style={{ flexShrink: 0 }}>
              <button onClick={() => setShowLogicModal(false)} className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg text-sm">
                我已了解
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
