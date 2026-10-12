import { useState, useEffect, useRef, useCallback } from 'react';
import { poolAPI, yaodiAPI, indicatorAPI, historyAPI } from '../config/api';
import { fetchStockDetail, searchStocks } from '../utils/api';
import { useMarketStore } from '../store/store';
import { fetchStockRealTime } from '../utils/stockRealTime';
import { analyzeStockPool, predictWithYaodi } from '../services/yaodiAnalysis';
import { registerPageRefresh, unregisterPageRefresh } from '../services/realtimeRefresh';
import { calculateKellyFromSignal } from '../utils/kelly';
import { isMarketOpen, getPollingInterval, getMarketStatus } from '../utils/marketTime';
import { bjISO } from '../utils/beijingTime';
import IntradayChart from '../components/IntradayChart';
import MainFlowChart from '../components/common/MainFlowChart';

// 全局滚动锁定
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
  Plus, Search, Trash2, Brain, X, TrendingUp, TrendingDown,
  RefreshCw, ShieldAlert, BarChart2, Calendar, Zap, PieChart,
  Activity, Target, AlertTriangle, TrendingUpIcon, CheckSquare,
  Bell, Sparkles, Calculator, ChevronDown, ChevronUp, TrendingUp as TrendUp
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell
} from 'recharts';

const COLOR = {
  green:  { bg: 'bg-green-500/10',  border: 'border-green-500/30',  text: 'text-green-400',  btn: 'bg-green-500' },
  blue:   { bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   text: 'text-blue-400',   btn: 'bg-blue-500' },
  yellow: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', btn: 'bg-orange-500' },
  red:    { bg: 'bg-red-500/10',    border: 'border-red-500/30',    text: 'text-red-400',    btn: 'bg-red-500' },
};

// ─── 黑天鹅预警弹窗（只弹一次，关闭后不再出现）────────────────────────────────
function BlackSwanAlertModal({ bsEvent, onClose }) {
  useBodyScrollLock(!!bsEvent);
  if (!bsEvent) return null;
  const severityColors = {
    severe: { bg: 'bg-red-500/15', border: 'border-red-400/40', text: 'text-red-400', icon: '🔴' },
    moderate: { bg: 'bg-orange-500/15', border: 'border-orange-400/40', text: 'text-orange-400', icon: '🟠' },
    mild: { bg: 'bg-yellow-500/15', border: 'border-yellow-400/40', text: 'text-yellow-400', icon: '🟡' },
  };
  const c = severityColors[bsEvent.severity] || severityColors.mild;
  return (
    <div className="fixed inset-0 bg-black/70 z-[100] overflow-hidden" style={{ display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div className={`${c.bg} ${c.border} border-2 rounded-2xl w-[440px] p-6 shadow-2xl backdrop-blur-sm`} style={{ height:'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">{c.icon}</span>
          <div>
            <div className={`text-sm font-bold ${c.text} uppercase tracking-wider`}>黑天鹅预警</div>
            <div className="text-lg font-bold text-white mt-0.5">{bsEvent.title || '异常波动告警'}</div>
          </div>
        </div>
        <div className="space-y-3 mb-5">
          <div className="bg-black/20 rounded-xl p-4">
            <div className="text-sm text-white/80 leading-relaxed">{bsEvent.message}</div>
          </div>
          <div className="flex items-center gap-4 text-xs text-white/60">
            <span>⚠️ 严重程度: <span className={`font-bold ${c.text}`}>{bsEvent.score}/100</span></span>
            <span>·</span>
            <span>{bsEvent.type === 'news' ? '📰 新闻触发' : '📊 价格异动'}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 text-sm font-medium transition-colors">
            我已知悉
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 添加股票弹窗 ─────────────────────────────────────────────────────────────
function AddStockModal({ isOpen, onClose, onAdd }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const initialLoadDone = useRef(false);
  const [results, setResults] = useState([]);
  const [selectedStock, setSelectedStock] = useState(null);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    if (!query || query.trim().length === 0) { setResults([]); setSelectedStock(null); return; }
    const timer = setTimeout(async () => {
      if (!initialLoadDone.current) setLoading(true);
      setError(null);
      try {
        const searchResults = await searchStocks(query, 10);
        setResults(searchResults);
        setSelectedStock(searchResults.length === 1 ? searchResults[0] : null);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); initialLoadDone.current = true; }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  
  const handleSelectStock = async (stock) => {
    if (!initialLoadDone.current) setLoading(true);
    try {
      const code = stock.code.replace(/^(sh|sz|bj)/, '') || stock.code;
      const detailed = await fetchStockDetail(code).catch(() => null);
      setSelectedStock(detailed ? { ...stock, ...detailed, code: stock.code } : stock);
      setResults([]);
    } catch {
      setSelectedStock(stock);
      setResults([]);
    } finally { setLoading(false); }
  };
  
  const handleAddStock = () => {
    if (!selectedStock) return;
    onAdd(selectedStock);
    onClose();
    setQuery(''); setResults([]); setSelectedStock(null);
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/70 z-50 overflow-hidden" style={{ display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl w-[500px]" style={{ height:'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[var(--border-light)] flex justify-between items-center shrink-0">
          <h3 className="text-lg font-semibold">添加股票</h3>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 flex-1" style={{ overflowY: 'auto' }}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-tertiary)]" />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="输入股票代码或名称，如 600026 或 贵州茅台"
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg pl-10 pr-4 py-3 text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:border-blue-500 focus:outline-none"
              autoFocus />
          </div>
          {results.length > 0 && !selectedStock && (
            <div className="mt-3 bg-[var(--bg-secondary)] rounded-lg" style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {results.map(stock => (
                <div key={stock.code} className="p-3 hover:bg-[var(--bg-tertiary)] cursor-pointer border-b border-[var(--border-color)] last:border-b-0"
                  onClick={() => handleSelectStock(stock)}>
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-medium">{stock.name}</div>
                      <div className="text-sm text-[var(--text-tertiary)]">{stock.code}</div>
                    </div>
                    <div className="text-right">
                      <div className={(stock.changePercent || 0) >= 0 ? 'text-red-400' : 'text-green-400'}>
                        {stock.price != null ? Number(stock.price).toFixed(2) : '--'}
                      </div>
                      <div className={`text-xs ${(stock.changePercent || 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {(stock.changePercent != null ? Number(stock.changePercent).toFixed(2) : '0')}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {loading && <div className="mt-4 text-center text-[var(--text-secondary)]">查询中...</div>}
          {error && <div className="mt-4 text-center text-red-400">{error}</div>}
          {selectedStock && (
            <div className="mt-4 bg-[var(--bg-secondary)] rounded-lg p-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-semibold text-lg">{selectedStock.name}</h4>
                  <span className="text-sm text-[var(--text-tertiary)]">{selectedStock.code}</span>
                </div>
                <span className={`text-2xl font-bold ${(selectedStock.change || 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {selectedStock.price != null ? Number(selectedStock.price).toFixed(2) : '--'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-[var(--bg-primary)] rounded p-2">
                  <span className="text-xs text-[var(--text-tertiary)] block">涨跌幅</span>
                  <span className={(selectedStock.changePercent || 0) >= 0 ? 'text-red-400' : 'text-green-400'}>
                    {(selectedStock.changePercent != null ? Number(selectedStock.changePercent).toFixed(2) : '0')}%
                  </span>
                </div>
                <div className="bg-[var(--bg-primary)] rounded p-2">
                  <span className="text-xs text-[var(--text-tertiary)] block">最高</span>
                  <span className="text-red-400">{selectedStock.high != null ? Number(selectedStock.high).toFixed(2) : '--'}</span>
                </div>
                <div className="bg-[var(--bg-primary)] rounded p-2">
                  <span className="text-xs text-[var(--text-tertiary)] block">最低</span>
                  <span className="text-green-400">{selectedStock.low != null ? Number(selectedStock.low).toFixed(2) : '--'}</span>
                </div>
              </div>
              <button onClick={handleAddStock} className="w-full py-3 bg-blue-500 hover:bg-blue-600 rounded-lg text-[var(--text-primary)] font-medium">
                添加到收藏股
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── K线图表组件（使用 Recharts）───────────────────────────────────────────────
function KlineChart({ klines }) {
  if (!klines || klines.length === 0) return null;
  
  // 计算均线
  const ma5 = klines.map((k, i) => {
    const slice = klines.slice(Math.max(0, i - 4), i + 1);
    const avg = slice.reduce((s, x) => s + (x.close || 0), 0) / slice.length;
    return { ...k, ma5: avg };
  });
  const ma10 = ma5.map((k, i) => {
    const slice = ma5.slice(Math.max(0, i - 9), i + 1);
    return { ...k, ma10: slice.reduce((s, x) => s + (x.close || 0), 0) / slice.length };
  });
  const ma20 = ma10.map((k, i) => {
    const slice = ma10.slice(Math.max(0, i - 19), i + 1);
    return { ...k, ma20: slice.reduce((s, x) => s + (x.close || 0), 0) / slice.length };
  });
  
  // 颜色设置
  const upColor = '#ef4444';
  const downColor = '#22c55e';
  
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    const isUp = d.close >= d.open;
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-xs shadow-2xl">
        <div className="text-gray-400 mb-1.5">{d.date}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <span className="text-gray-500">开盘</span><span className={isUp ? 'text-red-400' : 'text-green-400'}>{d.open != null ? Number(d.open).toFixed(2) : '--'}</span>
          <span className="text-gray-500">最高</span><span className="text-red-400">{d.high != null ? Number(d.high).toFixed(2) : '--'}</span>
          <span className="text-gray-500">最低</span><span className="text-green-400">{d.low != null ? Number(d.low).toFixed(2) : '--'}</span>
          <span className="text-gray-500">收盘</span><span className={isUp ? 'text-red-400' : 'text-green-400'}>{d.close != null ? Number(d.close).toFixed(2) : '--'}</span>
          <span className="text-gray-500">MA5</span><span className="text-yellow-400">{d.ma5 != null ? Number(d.ma5).toFixed(2) : '--'}</span>
          <span className="text-gray-500">MA10</span><span className="text-orange-400">{d.ma10 != null ? Number(d.ma10).toFixed(2) : '--'}</span>
          <span className="text-gray-500">MA20</span><span className="text-purple-400">{d.ma20 != null ? Number(d.ma20).toFixed(2) : '--'}</span>
        </div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={ma20} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} tickLine={false}
          interval={Math.floor(ma20.length / 6)} />
        <YAxis domain={['auto', 'auto']} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
          tickLine={false} axisLine={false} width={60}
          tickFormatter={v => v != null ? Number(v).toFixed(2) : '--'} />
        <Tooltip content={<CustomTooltip />} />
        {/* K线蜡烛体 */}
        <Bar dataKey="close" barSize={8} shape={(props) => {
          const { x, y, width, height, payload } = props;
          if (!payload) return null;
          const isUp = payload.close >= payload.open;
          const color = isUp ? upColor : downColor;
          const bodyTop = Math.min(y, y + height);
          const bodyHeight = Math.abs(height) || 2;
          return (
            <g>
              {/* 上影线 */}
              <line x1={x + width/2} y1={y} x2={x + width/2} y2={bodyTop} stroke={color} strokeWidth={1} />
              {/* 下影线 */}
              <line x1={x + width/2} y1={y + height} x2={x + width/2} y2={bodyTop + bodyHeight} stroke={color} strokeWidth={1} />
              {/* 实体 */}
              <rect x={x} y={bodyTop} width={width} height={bodyHeight} fill={isUp ? 'transparent' : color}
                stroke={color} strokeWidth={1} />
            </g>
          );
        }} />
        {/* 均线 */}
        <Line type="monotone" dataKey="ma5" stroke="#eab308" dot={false} strokeWidth={1.5} name="MA5" />
        <Line type="monotone" dataKey="ma10" stroke="#f97316" dot={false} strokeWidth={1.5} name="MA10" />
        <Line type="monotone" dataKey="ma20" stroke="#a855f7" dot={false} strokeWidth={1.5} name="MA20" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── 尧帝分析弹窗（完整版）─────────────────────────────────────────────────────
function StockAnalysisModal({ stock, isOpen, onClose }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isOpen || !stock) return;
    setLoading(true); setResult(null);
    analyzeStockPool(stock).then(r => { setResult(r); setLoading(false); });
  }, [isOpen, stock]);

  if (!isOpen || !stock) return null;
  const c = result ? (COLOR[result.suggestionColor] || COLOR.blue) : COLOR.blue;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-hidden" style={{ display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl w-[640px] shadow-2xl" style={{ height:'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="sticky top-0 bg-[var(--bg-primary)] border-b border-[var(--border-light)] px-6 py-4 flex justify-between items-center z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <Brain className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold">尧帝智能分析</h3>
              <span className="text-sm text-[var(--text-tertiary)]">
                {stock.name}（{stock.code}）· 现价 {stock.price != null ? Number(stock.price).toFixed(2) : '--'}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] flex items-center justify-center">
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 flex-1" style={{ overflowY: 'auto' }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-purple-500/20 flex items-center justify-center animate-pulse">
                  <Brain className="w-10 h-10 text-purple-400" />
                </div>
                <div className="absolute inset-0 rounded-full border-2 border-purple-400/30 animate-ping"></div>
              </div>
              <div className="text-center">
                <p className="text-purple-400 font-medium mb-1">尧帝正在分析</p>
                <div className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]"><span className="animate-pulse">●</span><span>调用多策略回测</span></div>
                <div className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] mt-1"><span className="animate-pulse delay-100">●</span><span>三合一技术分析中</span></div>
              </div>
            </div>
          ) : result && (
            <>
              {/* 模拟数据提示 */}
              {!result._realAnalysis && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                  <span className="text-xs text-yellow-400">⚡</span>
                  <span className="text-xs text-yellow-400">部分数据基于规则推算，仅供参考</span>
                </div>
              )}

              {/* 尧帝状态 */}
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(114,46,209,0.08), rgba(22,119,255,0.06))', border: '1px solid rgba(114,46,209,0.15)' }}>
                <Zap className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-[11px] text-purple-400 font-bold">尧帝 V{result.yaodi.mainVersion || 2}.0</span>
                <div className="w-px h-3.5 bg-purple-500/20" />
                <span className="text-[11px] text-[var(--text-secondary)]">准确率 <span className="text-purple-300 font-bold">{result.yaodi.accuracy != null ? Number(result.yaodi.accuracy).toFixed(1) + '%' : '--'}</span></span>
                <span className="text-[11px] text-[var(--text-secondary)]">胜率 <span className="text-blue-300 font-bold">{result.yaodi.winRate != null ? Number(result.yaodi.winRate).toFixed(1) + '%' : '--'}</span></span>
                <span className="text-[11px] text-[var(--text-secondary)]">置信度 <span className="text-green-300 font-bold">{result.yaodi.confidence || '--'}%</span></span>
                <span className="text-[11px] text-[var(--text-secondary)]">夏普 <span className="text-blue-300 font-bold">{Number(result.yaodi.sharpeRatio || 0).toFixed(2)}</span></span>
              </div>

              {/* 进化统计 */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '演化次数', value: (result.yaodi.evolutionCount || 0).toLocaleString(), color: 'purple' },
                  { label: '活跃分支', value: result.yaodi.branchCount || 0, color: 'blue' },
                  { label: '回测策略', value: result.votingBranches || 0, color: 'amber' },
                  { label: '平均收益', value: `${Number(result.yaodi.avgReturn || 0).toFixed(2)}%`, color: 'green' },
                ].map(item => (
                  <div key={item.label} className={`bg-${item.color}-500/5 border border-${item.color}-500/10 rounded-lg px-3 py-2 text-center`}>
                    <div className={`text-[10px] text-${item.color}-400`}>{item.label}</div>
                    <div className={`text-sm font-bold text-${item.color}-300`}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* 技术分析摘要 */}
              {result.techSummaries?.length > 0 && (
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3">
                  <div className="text-xs font-semibold text-amber-400 mb-2">技术分析摘要</div>
                  <div className="space-y-1.5">
                    {result.techSummaries.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span>{t.icon}</span>
                        <span className="text-[var(--text-tertiary)]">{t.name}</span>
                        <span className={t.bullish ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'}>{t.conclusion}</span>
                        {!t.realData && <span className="text-[10px] text-yellow-400/60">(估算)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 核心建议 */}
              <div className={`${c.bg} ${c.border} border rounded-2xl p-5`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-purple-400" />
                    <span className="font-bold text-purple-400">尧帝操作建议</span>
                  </div>
                  <span className={`px-6 py-2.5 rounded-xl font-black text-lg text-[var(--text-primary)] shadow-lg ${c.btn}`}>{result.suggestion}</span>
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{result.suggestionReason}</p>
              </div>

              {/* 买入区间 */}
              <div className="bg-blue-500/8 border border-blue-500/15 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold text-blue-400">建议买入区间</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-center">
                    <div className="text-xs text-[var(--text-tertiary)] mb-1">低位</div>
                    <div className="text-xl font-bold text-blue-300">{result.buyLow}</div>
                  </div>
                  <div className="flex-1 mx-4 flex items-center gap-1">
                    <div className="flex-1 h-0.5 bg-blue-500/30 rounded" />
                    <div className="text-xs text-blue-400">介入区间</div>
                    <div className="flex-1 h-0.5 bg-blue-500/30 rounded" />
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-[var(--text-tertiary)] mb-1">高位</div>
                    <div className="text-xl font-bold text-blue-300">{result.buyHigh}</div>
                  </div>
                </div>
              </div>

              {/* 止盈止损 + 盈亏比 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.03))', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <div className="flex items-center gap-1.5 mb-2"><TrendingUp className="w-3.5 h-3.5 text-red-400" /><span className="text-xs font-semibold text-red-400">止盈目标</span></div>
                  <div className="text-2xl font-black text-red-300">{result.takeProfitPrice}</div>
                  <div className="text-xs text-red-400/60 mt-0.5">+{result.profitPct}%</div>
                </div>
                <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.03))', border: '1px solid rgba(34,197,94,0.15)' }}>
                  <div className="flex items-center gap-1.5 mb-2"><ShieldAlert className="w-3.5 h-3.5 text-green-400" /><span className="text-xs font-semibold text-green-400">止损位</span></div>
                  <div className="text-2xl font-black text-green-300">{result.stopLossPrice}</div>
                  <div className="text-xs text-green-400/60 mt-0.5">-{result.lossPct}%</div>
                </div>
                <div className="rounded-2xl p-4 flex flex-col items-center justify-center" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-[var(--text-tertiary)] mb-1">盈亏比</div>
                  <div className={`text-2xl font-black ${parseFloat(result.rr) >= 2 ? 'text-green-400' : 'text-yellow-400'}`}>{result.rr}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">: 1</div>
                </div>
              </div>

              {/* 持仓周期 */}
              <div className="bg-amber-500/8 border border-amber-500/15 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-semibold text-amber-400">建议持仓周期</span>
                </div>
                <div className="text-xl font-black text-amber-300 mb-1">{result.holdingPeriod}</div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{result.holdingDesc}</p>
              </div>

              {/* 三合一信号（如果有） */}
              {result.trinitySignal && (
                <div className="bg-cyan-500/8 border border-cyan-500/15 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-xs font-semibold text-cyan-400">三合一分析信号</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-lg font-bold ${result.trinitySignal.signal === 'buy' || result.trinitySignal.signal === '买入' ? 'text-red-400' : result.trinitySignal.signal === 'sell' || result.trinitySignal.signal === '卖出' ? 'text-green-400' : 'text-yellow-400'}`}>
                      {result.trinitySignal.signal || '--'}
                    </span>
                    <span className="text-xs text-cyan-400">置信度 {result.trinitySignal.confidence || 50}%</span>
                  </div>
                </div>
              )}

              <p className="text-xs text-[var(--text-tertiary)] text-center">分析时间：{result.analysisTime}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 主页面 ────────────────────────────────────────────────────────────────────
export default function StockPool() {
  const stockPool = useMarketStore((s) => s.stockPool);
  const addToPool = useMarketStore((s) => s.addToPool);
  const removeFromPool = useMarketStore((s) => s.removeFromPool);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [selectedStock, setSelectedStock] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [yaodiStatus, setYaodiStatus] = useState(null);

  // 黑天鹅相关状态
  const [bsAlertQueue, setBsAlertQueue] = useState([]); // 待弹窗队列
  const [bsDismissed, setBsDismissed] = useState(() => {
    // 从 localStorage 恢复已关闭记录，避免刷新后重复弹窗
    try {
      const saved = localStorage.getItem('bs_dismissed_pool_ids');
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set();
  });
  const [currentBsAlert, setCurrentBsAlert] = useState(null);

  // K线弹窗
  const [klineTarget, setKlineTarget] = useState(null);
  const [klineData, setKlineData] = useState(null);
  const [klineLoading, setKlineLoading] = useState(false);

  // 单股预测/指标弹窗
  const [predictTarget, setPredictTarget] = useState(null);
  const [predictData, setPredictData] = useState(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [indicatorTarget, setIndicatorTarget] = useState(null);
  const [indicatorData, setIndicatorData] = useState(null);
  const [indicatorLoading, setIndicatorLoading] = useState(false);

  // 凯利仓位弹窗
  const [kellyTarget, setKellyTarget] = useState(null);
  const [kellyData, setKellyData] = useState(null);
  // 分时图弹窗
  const [intradayTarget, setIntradayTarget] = useState(null);
  // 主力资金弹窗
  const [mainFlowTarget, setMainFlowTarget] = useState(null);

  // 弹窗打开时锁定背景滚动
  useBodyScrollLock(!!(klineTarget || predictTarget || indicatorTarget || kellyTarget || mainFlowTarget));

  // 批量分析结果（个性化评分）
  const [poolAnalysis, setPoolAnalysis] = useState(null);

  // 批量操作状态
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState(new Set());

  // 止损预警状态
  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(false);

  // 智能推荐状态
  const [recommendations, setRecommendations] = useState([]);
  const [showRecommend, setShowRecommend] = useState(false);
  const [recommendLoading, setRecommendLoading] = useState(false);

  // 凯利仓位计算结果缓存
  const [kellyCache, setKellyCache] = useState({}); // {code: kellyResult}

  // 主力资金今日数据缓存 (code -> mainFlowRow)
  const [todayMainFlow, setTodayMainFlow] = useState({}); // {code: {main_inflow, ...}}
  const todayMainFlowRef = useRef({}); // 同步到ref供render使用

  // 获取今日主力资金数据（批量）
  const fetchTodayMainFlow = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8769/api/main-flow/today', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.flows) {
          const map = {};
          for (const f of data.flows) map[f.code] = f;
          setTodayMainFlow(map);
          todayMainFlowRef.current = map;
        }
      }
    } catch { /* ignore */ }
  }, []);

  // 获取单只股票今日主力资金（实时抓取）
  const fetchSingleMainFlow = useCallback(async (code) => {
    try {
      const res = await fetch(`http://localhost:8769/api/main-flow/today/${code}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.flows && data.flows.length > 0) {
          const newFlow = data.flows[0];
          // 合并到现有数据
          const newMap = { ...todayMainFlowRef.current, [code]: newFlow };
          todayMainFlowRef.current = newMap;
          setTodayMainFlow(newMap);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // 初始化时获取主力资金数据
  useEffect(() => {
    fetchTodayMainFlow();
    // 每5分钟刷新
    const iv = setInterval(fetchTodayMainFlow, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchTodayMainFlow]);

  // 补全缺失的主力资金数据（针对收藏夹中未在40只批量采集范围内的股票）
  useEffect(() => {
    if (!stockPool?.length) return;
    // 延迟500ms，等初始批量fetch完成后再补采
    const timer = setTimeout(() => {
      for (const stock of stockPool) {
        if (!todayMainFlowRef.current?.[stock.code]) {
          fetchSingleMainFlow(stock.code);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [stockPool, fetchSingleMainFlow]);

  // 获取批量尧帝评分
  const fetchPoolAnalysis = useCallback(async () => {
    try {
      // 每次从 localStorage 读取最新 dismissed 列表，避免闭包捕获旧值
      const saved = localStorage.getItem('bs_dismissed_pool_ids');
      const dismissedSet = new Set(saved ? JSON.parse(saved) : []);
      const res = await poolAPI.analyze();
      const data = res;
      if (data.success) setPoolAnalysis(data);

      // 黑天鹅预警检测：找出新的未关闭事件
      if (data.analyzed) {
        const newBS = data.analyzed
          .filter(s => s.black_swan?.active && !dismissedSet.has(s.code + ':' + (s.black_swan.title || '')))
          .map(s => ({ ...s.black_swan, code: s.code, name: s.name }));
        if (newBS.length > 0) {
          setBsAlertQueue(prev => [...prev, ...newBS]);
        }
      }
    } catch { /* ignore */ }
  }, []); // 不依赖 bsDismissed，避免闭包陷阱

  // 弹窗黑天鹅弹窗（队列机制，确保只弹一次）
  useEffect(() => {
    if (bsAlertQueue.length > 0 && !currentBsAlert) {
      const next = bsAlertQueue[0];
      setCurrentBsAlert(next);
      setBsAlertQueue(q => q.slice(1));
    }
  }, [bsAlertQueue, currentBsAlert]);

  // 关闭黑天鹅弹窗
  const handleDismissBsAlert = () => {
    if (currentBsAlert) {
      const dismissKey = currentBsAlert.code + ':' + (currentBsAlert.title || '');
      setBsDismissed(prev => {
        const next = new Set([...prev, dismissKey]);
        localStorage.setItem('bs_dismissed_pool_ids', JSON.stringify([...next]));
        return next;
      });
      // 通知后端标记已处理
      poolAPI.dismissBlackSwan(currentBsAlert.id || dismissKey).catch(() => {});
    }
    setCurrentBsAlert(null);
  };

  // 获取尧帝状态
  const fetchYaodiStatus = useCallback(async () => {
    try {
      const res = await yaodiAPI.getSummary();
      const data = res;
      setYaodiStatus({
        sentiment: data.main?.market_sentiment || 0,
        accuracy: data.main?.accuracy || 0,
        version: data.main?.main_version || 1,
        branchCount: data.summary?.active_branches ?? data.summary?.total_branches ?? 0,
      });
    } catch { /* ignore */ }
  }, []);

  // 批量操作函数
  const toggleSelectAll = () => {
    const currentPool = useMarketStore.getState().stockPool;
    if (selectedCodes.size === currentPool.length) {
      setSelectedCodes(new Set()); // 全不选
    } else {
      setSelectedCodes(new Set(currentPool.map(s => s.code))); // 全选
    }
  };

  const toggleSelect = (code) => {
    const newSet = new Set(selectedCodes);
    if (newSet.has(code)) {
      newSet.delete(code);
    } else {
      newSet.add(code);
    }
    setSelectedCodes(newSet);
  };

  const batchRemove = async () => {
    if (selectedCodes.size === 0) return;
    const codes = [...selectedCodes];
    try {
      for (const code of codes) {
        await poolAPI.remove(code);
      }
      // 更新本地状态
      const currentPool = useMarketStore.getState().stockPool;
      useMarketStore.setState({
        stockPool: currentPool.filter(s => !selectedCodes.has(s.code))
      });
      setSelectedCodes(new Set());
      setMultiSelectMode(false);
      const toast = (await import('../utils/toast.js')).default;
      toast.success(`已移除 ${codes.length} 只股票`);
    } catch (err) {
      console.error('批量移除失败:', err);
    }
  };

  // 获取止损预警
  const fetchAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const res = await fetch('http://localhost:8769/api/monitor/alerts');
      const data = await res.json();
      if (data.success && data.alerts) {
        // 只显示收藏股相关的预警
        const poolCodes = new Set(stockPool.map(s => s.code));
        const relevantAlerts = data.alerts.filter(a => poolCodes.has(a.code));
        setAlerts(relevantAlerts);
      }
    } catch (err) {
      console.error('获取预警失败:', err);
    } finally {
      setAlertsLoading(false);
    }
  }, [stockPool]);

  // 获取智能推荐（使用 yaodi-v2/l2-pool，L2评分top股票）
  const fetchRecommendations = useCallback(async (limit = 5) => {
    setRecommendLoading(true);
    try {
      // 方案：从 L2 池取高评分股票（尧帝真实数据）
      const res = await fetch(`/api/yaodi-v2/l2-pool?limit=${limit}`);
      const data = await res.json();
      if (data.success && (data.top50 || data.stocks)) {
        const poolCodes = new Set(stockPool.map(s => s.code)); // 排除已有自选
        const recs = (data.top50 || data.stocks)
          .filter(s => !poolCodes.has(s.code))
          .slice(0, limit)
          .map(s => ({
            code: s.code,
            name: s.name || s.code,
            level: 'L2',
            confidence: s.confidence != null ? Math.round((s.confidence * 100)) : null,
            l2_score: s.l2_score ? (s.l2_score * 100).toFixed(1) : null,
            kellyPct: null,
            reason: '尧帝L2精选',
          }));
        setRecommendations(recs);
      }
    } catch (err) {
      console.error('获取推荐失败:', err);
    } finally {
      setRecommendLoading(false);
    }
  }, [stockPool]);

  // 计算凯利仓位
  const calculateKellyForStock = useCallback((stock, signal) => {
    if (!signal || !stock.price) return null;
    const capitalConfig = JSON.parse(localStorage.getItem('capitalConfig') || '{}');
    const availableCapital = capitalConfig.availableCapital || 100000;
    return calculateKellyFromSignal(signal, availableCapital, stock.price);
  }, []);

  // 刷新收藏股实时行情（使用 /api/pool/realtime，交易时段自动同步获取主力资金实时百分比）
  const refreshPrices = useCallback(async (silent = false) => {
    const currentPool = useMarketStore.getState().stockPool;
    if (currentPool.length === 0) return;
    if (!silent) setRefreshing(true);
    try {
      const res = await poolAPI.getRealtime();
      const data = res;
      if (data.success && data.stocks && data.stocks.length > 0) {
        const updated = currentPool.map(s => {
          const rt = data.stocks.find(u => u.code === s.code);
          return rt ? {
            ...s,
            price: rt.price || s.price,
            changePercent: rt.change_percent ?? rt.changePercent ?? s.changePercent,
            change: rt.change ?? s.change,
            high: rt.high ?? s.high,
            low: rt.low ?? s.low,
            volume: rt.volume ?? s.volume,
            preClose: rt.pre_close ?? s.preClose,
            realtime_update: rt.update_time ?? s.realtime_update,
            // 【新增 2026-05-11】主力资金实时数据
            todayMainFlow: rt.todayMainFlow,
            mainStrength: rt.mainStrength,   // 主力强度（%）
            strengthClass: rt.strengthClass,  // 分类（抢筹/建仓/洗盘/出货）
          } : s;
        });
        useMarketStore.setState((state) => ({
          stockPool: state.stockPool.map(s => updated.find(u => u.code === s.code) || s)
        }));
        setLastUpdate(bjISO());
      }
      // 同时更新批量分析（非 silent 模式时顺带更新一次）
      if (!silent) fetchPoolAnalysis();
      if (!silent) {
        try {
          const toast = (await import('../utils/toast.js')).default;
          toast.success(`行情已更新 · ${currentPool.length}只股票`);
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('刷新失败:', err);
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [fetchPoolAnalysis]);

  // 页面加载 - 动态轮询
  useEffect(() => {
    refreshPrices(true);
    fetchYaodiStatus();
    fetchPoolAnalysis();
    
    // 动态轮询：根据市场状态调整间隔
    let timer;
    const setupTimer = () => {
      const interval = getPollingInterval();
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        refreshPrices(true);
        fetchYaodiStatus();
      }, interval);
    };
    
    setupTimer();
    
    // 每分钟检查一次是否需要调整轮询间隔
    const intervalChecker = setInterval(setupTimer, 60000);
    
    return () => {
      if (timer) clearInterval(timer);
      clearInterval(intervalChecker);
    };
  }, [refreshPrices, fetchYaodiStatus, fetchPoolAnalysis]);

  // 获取止损预警（每30秒刷新一次）
  useEffect(() => {
    if (stockPool.length === 0) return;
    fetchAlerts();
    const timer = setInterval(fetchAlerts, 30000);
    return () => clearInterval(timer);
  }, [fetchAlerts, stockPool.length]);

  // 获取智能推荐（页面加载时获取一次）
  useEffect(() => {
    fetchRecommendations(5);
  }, [fetchRecommendations]);

  // 获取 K 线数据
  const fetchKline = async (code, name) => {
    setKlineTarget({ code, name });
    setKlineLoading(true);
    try {
      const res = await fetch(`/api/stock/history/${code}?days=60`);
      const data = await res.json();
      setKlineData(data.success ? (data.klines || []) : []);
    } catch(e) { console.error('K线失败:', e); }
    setKlineLoading(false);
  };

  // 获取单股预测 - 改用尧帝AI驱动
  const fetchPredict = async (code, name) => {
    setPredictTarget({ code, name });
    setPredictLoading(true);
    try {
      // 从当前股票列表中找到完整stock对象
      const stock = stockPool.find(s => s.code === code) || { code, name, price: 0, changePercent: 0 };
      const result = await predictWithYaodi(stock);

      setPredictData({
        direction: result.direction,
        directionText: result.directionText,
        confidence: result.confidence,
        targetPrice: result.targetPrice,
        stopLoss: result.stopLoss,
        expectedReturn: result.expectedReturn,
        riskLevel: result.riskLevel,
        backtestWinRate: result.backtestWinRate,
        signals: result.signals,
        yaodi: result.yaodi,
        holdingPeriod: result.holdingPeriod,
        reason: result.reason,
        _source: 'yaodi_ai', // 标记数据来源为尧帝AI
      });
    } catch (e) {
      console.error('尧帝AI预测失败:', e);
      setPredictData(null);
    }
    setPredictLoading(false);
  };

  // 获取技术指标（使用 /holding/dayt 端点，已包含RSI/MACD/MA指标）
  const fetchIndicator = async (code, name) => {
    setIndicatorTarget({ code, name }); setIndicatorLoading(true);
    // 同时获取主力资金数据
    fetchSingleMainFlow(code);
    try {
      const res = await fetch(`/api/holding/dayt?code=${code}`);
      const data = await res.json();
      if (data.success && data.indicators) {
        const raw = data.indicators;
        const macdStr = raw.macd || '';
        const macdMatch = macdStr.match(/-?[\d.]+/);
        const macdVal = macdMatch ? parseFloat(macdMatch[0]) : 0;
        const macdSignal = macdStr.includes('金叉') ? '多头' : macdStr.includes('死叉') ? '空头' : '震荡';
        const rsiVal = parseFloat(raw.rsi || 50);
        const kdjRaw = raw.kdj || {};
        const kVal = parseFloat(kdjRaw.k || 50);
        const dVal = parseFloat(kdjRaw.d || 50);
        const jVal = parseFloat(kdjRaw.j || 50);
        const rsvVal = kVal; // 用K值作为RSV近似

        setIndicatorData({
          rsi: { value: rsiVal, status: rsiVal > 70 ? '超买' : rsiVal < 30 ? '超卖' : '中性' },
          macd: { macd: macdVal, dif: macdVal, dea: macdVal * 0.8, signal: macdSignal },
          kdj: { k: kVal, d: dVal, j: jVal, status: kVal > 80 ? '超买' : kVal < 20 ? '超卖' : '正常' },
          boll: { 
            upper: parseFloat(raw.boll?.upper || 0), 
            middle: parseFloat(raw.boll?.middle || 0), 
            lower: parseFloat(raw.boll?.lower || 0) 
          },
          ma: {
            ma5: parseFloat(raw.ma5 || 0),
            ma10: parseFloat(raw.ma10 || 0),
            ma20: parseFloat(raw.ma20 || 0),
            ma30: parseFloat(raw.ma30 || 0),
            maStrength: raw.maStrength || '震荡',
          },
        });
      } else {
        setIndicatorData(null);
      }
    } catch(e) { setIndicatorData(null); }
    setIndicatorLoading(false);
  };

  const handleAddStock = async (stock) => { addToPool(stock); setShowAddModal(false); await refreshPrices(); await fetchSingleMainFlow(stock.code); };
  const handleAnalyze = (stock) => { setSelectedStock(stock); setShowAnalysisModal(true); };
  
  // 移动股票到第一排序
  const handleMoveToTop = async (code) => {
    try {
      await poolAPI.moveToTop(code);
      // 刷新列表
      const list = await poolAPI.getList();
      useMarketStore.setState({ stockPool: list.stocks || [] });
      const toast = (await import('../utils/toast.js')).default;
      toast.success('已置顶');
    } catch (err) {
      console.error('置顶失败:', err);
    }
  };

  // 显示凯利仓位详情
  const showKellyModal = (stock) => {
    const analysis = getPoolScore(stock.code);
    const kelly = calculateKellyForStock(stock, analysis?.signal);
    if (kelly) {
      setKellyTarget(stock);
      setKellyData(kelly);
    }
  };

  // 辅助：获取某只股票的分析评分
  const getPoolScore = (code) => {
    return poolAnalysis?.analyzed?.find(a => a.code === code);
  };

  // 辅助：获取某只股票的黑天鹅状态
  const getBlackSwan = (code) => {
    return poolAnalysis?.analyzed?.find(a => a.code === code)?.black_swan;
  };

  // 评分颜色
  const scoreColor = (score) => {
    if (score >= 80) return 'text-red-500';   // 高评分 → 红色（买入/持有）
    if (score >= 50) return 'text-orange-500';  // 中评分 → 橙色（观望）
    return 'text-green-500';  // 低评分 → 绿色（卖出）
  };

  return (
    <div className="sp-page flex-1 flex flex-col overflow-hidden">
      {/* 黑天鹅预警弹窗 */}
      {currentBsAlert && (
        <BlackSwanAlertModal bsEvent={currentBsAlert} onClose={handleDismissBsAlert} />
      )}

      {/* 头部 */}
      <div className="page-header">
        <div>
          <h1 className="page-title">收藏股</h1>
          <p className="page-subtitle">
            自选股票管理
            {lastUpdate && <span className="ml-2 text-xs text-[var(--text-tertiary)]">· 更新于 {lastUpdate}</span>}
            <span className="ml-2 text-xs px-2 py-0.5 rounded" style={{
              background: isMarketOpen() ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
              color: isMarketOpen() ? '#22c55e' : '#eab308'
            }}>
              {getMarketStatus()}
            </span>
            {poolAnalysis?.summary && (
              <span className="ml-2 text-xs text-purple-400">
                · 强烈推荐 {poolAnalysis.summary.recommend_count} 只
                {poolAnalysis.summary.black_swan_count > 0 && (
                  <span className="text-red-400 ml-1">· {poolAnalysis.summary.black_swan_count} 只预警中</span>
                )}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {yaodiStatus?.accuracy != null && (
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
              <span className="text-xs text-purple-400 font-medium">V{yaodiStatus.version || 1}</span>
              <span className="text-xs text-[var(--text-tertiary)]">准确率 <span className="text-purple-300 font-bold">{yaodiStatus.accuracy != null ? Number(yaodiStatus.accuracy).toFixed(1) : '--'}%</span></span>
              <span className="text-xs text-[var(--text-tertiary)]">情绪
                <span className={`ml-1 font-bold ${(yaodiStatus.sentiment || 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {(yaodiStatus.sentiment != null ? Number(yaodiStatus.sentiment).toFixed(2) : '0.00')}
                </span>
              </span>
              <span className="text-xs text-[var(--text-tertiary)]">分支 <span className="text-blue-300 font-bold">{yaodiStatus.branchCount || 0}</span></span>
            </div>
          )}
          <button onClick={() => refreshPrices(false)} disabled={refreshing} className="btn btn-secondary">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新行情
          </button>
          {stockPool.length > 0 && (
            <button 
              onClick={() => {
                setMultiSelectMode(!multiSelectMode);
                if (multiSelectMode) setSelectedCodes(new Set());
              }} 
              className={`btn ${multiSelectMode ? 'btn-primary' : 'btn-secondary'}`}
            >
              <CheckSquare className="w-4 h-4" />
              {multiSelectMode ? '取消多选' : '批量操作'}
            </button>
          )}
          {multiSelectMode && selectedCodes.size > 0 && (
            <button onClick={batchRemove} className="btn btn-secondary text-red-400 hover:bg-red-500/15">
              <Trash2 className="w-4 h-4" />
              移除 ({selectedCodes.size})
            </button>
          )}
          {multiSelectMode && stockPool.length > 0 && (
            <button onClick={toggleSelectAll} className="btn btn-secondary text-xs">
              {selectedCodes.size === stockPool.length ? '全不选' : '全选'}
            </button>
          )}
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus className="w-4 h-4" />添加股票
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 p-6" style={{ overflowY: 'auto' }}>
        {/* 止损预警面板 */}
        {alerts.length > 0 && showAlerts && (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-red-500/10">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-red-400">止损预警</span>
                <span className="text-xs text-[var(--text-tertiary)]">({alerts.length}条)</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={fetchAlerts}
                  className="text-xs text-[var(--text-tertiary)] hover:text-red-400 transition-colors"
                  disabled={alertsLoading}
                >
                  {alertsLoading ? '刷新中...' : '刷新'}
                </button>
                <button 
                  onClick={() => setShowAlerts(false)}
                  className="text-xs text-[var(--text-tertiary)] hover:text-red-400"
                >
                  隐藏
                </button>
              </div>
            </div>
            <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
              {alerts.map((alert, idx) => {
                const typeConfig = {
                  '止损': { bg: 'bg-green-500/20 text-green-400 border-green-500/20', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
                  '止盈': { bg: 'bg-red-500/20 text-red-400 border-red-500/20', icon: <TrendingUp className="w-3.5 h-3.5" /> },
                  '高波动': { bg: 'bg-orange-500/20 text-orange-400 border-orange-500/20', icon: <Activity className="w-3.5 h-3.5" /> },
                  '连跌': { bg: 'bg-red-500/30 text-red-300 border-red-500/30', icon: <TrendingDown className="w-3.5 h-3.5" /> },
                  'stop_loss': { bg: 'bg-green-500/20 text-green-400 border-green-500/20', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
                  'take_profit': { bg: 'bg-red-500/20 text-red-400 border-red-500/20', icon: <TrendingUp className="w-3.5 h-3.5" /> },
                };
                const cfg = typeConfig[alert.type] || typeConfig['止损'];
                const urgencyLevel = { '触发': 0, '紧急': 1, '达成': 2, '警告': 3, '接近': 4, '关注': 5 };
                const isHighUrgency = (urgencyLevel[alert.urgency] ?? 9) <= 2;
                return (
                <div 
                  key={idx}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isHighUrgency ? cfg.bg : 'bg-[var(--bg-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${cfg.bg}`}>
                      {alert.type === 'stop_loss' ? '止损' : alert.type === 'take_profit' ? '止盈' : alert.type}
                    </span>
                    <span className="font-medium text-sm">{alert.name}</span>
                    <span className="text-xs text-[var(--text-tertiary)]">{alert.code}</span>
                    {alert.desc && (
                      <span className="text-xs text-[var(--text-tertiary)]">{alert.desc}</span>
                    )}
                    {alert.profitPct != null && (
                      <span className={`text-xs font-medium ${parseFloat(alert.profitPct) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {parseFloat(alert.profitPct) >= 0 ? '+' : ''}{alert.profitPct}%
                      </span>
                    )}
                    {alert.pct_from_buy != null && (
                      <span className={`text-xs font-medium ${alert.pct_from_buy >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {alert.pct_from_buy >= 0 ? '+' : ''}{(alert.pct_from_buy != null ? Number(alert.pct_from_buy).toFixed(2) : '0.00')}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[var(--text-tertiary)]">
                    {alert.alertTime && (
                      <span className="text-[var(--text-tertiary)]">{alert.alertTime}</span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded ${isHighUrgency ? 'bg-red-500/20 text-red-400' : 'text-[var(--text-tertiary)]'}`}>
                      {alert.urgency}
                    </span>
                    <span>现价 ¥{(alert.current_price ?? alert.currentPrice) != null ? Number(alert.current_price ?? alert.currentPrice).toFixed(2) : '--'}</span>
                    {alert.atrStop && (
                      <span className="text-green-400">止损 ¥{parseFloat(alert.atrStop).toFixed(2)}</span>
                    )}
                    {alert.atr_stop_loss && (
                      <span className="text-green-400">止损 ¥{parseFloat(alert.atr_stop_loss).toFixed(2)}</span>
                    )}
                    {alert.atrTake && (
                      <span className="text-red-400">止盈 ¥{parseFloat(alert.atrTake).toFixed(2)}</span>
                    )}
                    {alert.atr_take_profit && (
                      <span className="text-red-400">止盈 ¥{parseFloat(alert.atr_take_profit).toFixed(2)}</span>
                    )}
                    {alert.distPct != null && (
                      <span>距止损 {alert.distPct}%</span>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 智能推荐面板 */}
        {recommendations.length > 0 && (
          <div className="mb-4 rounded-xl border border-purple-500/20 bg-purple-500/5 overflow-hidden">
            <div 
              className="flex items-center justify-between px-4 py-3 border-b border-purple-500/10 cursor-pointer"
              onClick={() => setShowRecommend(!showRecommend)}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-purple-400">尧帝智能推荐</span>
                <span className="text-xs text-[var(--text-tertiary)]">({recommendations.length}只)</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); fetchRecommendations(5); }}
                  className="text-xs text-[var(--text-tertiary)] hover:text-purple-400 transition-colors"
                  disabled={recommendLoading}
                >
                  {recommendLoading ? '刷新中...' : '刷新'}
                </button>
                {showRecommend ? <ChevronUp className="w-4 h-4 text-[var(--text-tertiary)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-tertiary)]" />}
              </div>
            </div>
            {showRecommend && (
              <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                {recommendations.map((rec, idx) => (
                  <div 
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] hover:bg-purple-500/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                        <span className="text-xs font-bold text-purple-400">{idx + 1}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{rec.name}</span>
                          <span className="text-xs text-[var(--text-tertiary)]">{rec.code}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            rec.level === 'L3' ? 'bg-red-500/20 text-red-400' :
                            rec.level === 'L2' ? 'bg-orange-500/20 text-orange-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {rec.level}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-tertiary)]">
                          <span className="text-purple-400">{rec.reason}</span>
                          {rec.confidence && (
                            <span>置信度 {rec.confidence != null ? Number(rec.confidence).toFixed(0) : '--'}%</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {rec.kellyPct != null && (
                        <div className="text-right">
                          <div className="text-xs text-[var(--text-tertiary)]">凯利仓位</div>
                          <div className="text-sm font-medium text-purple-400">{rec.kellyPct != null ? Number(rec.kellyPct).toFixed(1) : '--'}%</div>
                        </div>
                      )}
                      {rec.target_price && (
                        <div className="text-right">
                          <div className="text-xs text-[var(--text-tertiary)]">目标价</div>
                          <div className="text-sm font-medium text-red-400">¥{rec.target_price != null ? Number(rec.target_price).toFixed(2) : '--'}</div>
                        </div>
                      )}
                      <button
                        onClick={async () => { await addToPool({ code: rec.code, name: rec.name }); refreshPrices(); }}
                        className="px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-400 text-xs hover:bg-purple-500/30 transition-colors"
                      >
                        加入自选
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {stockPool.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-[var(--text-tertiary)]">
            <TrendingUp className="w-12 h-12 mb-4 opacity-50" />
            <p>收藏股为空</p>
            <p className="text-sm mt-2">点击右上角添加股票</p>
          </div>
        ) : (
          <div className="space-y-3">
            {stockPool.map(stock => {
              const analysis = getPoolScore(stock.code);
              const bs = getBlackSwan(stock.code);
              const isUp = (stock.changePercent || 0) >= 0;
              const isSelected = selectedCodes.has(stock.code);
              return (
                <div key={stock.code}
                  className={`bg-[var(--bg-secondary)] border rounded-2xl p-4 hover:border-purple-500/30 transition-all cursor-pointer group
                    ${bs?.active ? 'border-red-400/30' : multiSelectMode && isSelected ? 'border-purple-500/50' : 'border-[var(--border-color)]'}`}
                  onClick={() => multiSelectMode ? toggleSelect(stock.code) : handleAnalyze(stock)}>

                  <div className="flex items-center gap-4">
                    {/* 多选模式复选框 */}
                    {multiSelectMode && (
                      <div className="shrink-0">
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          onChange={() => toggleSelect(stock.code)}
                          className="w-5 h-5 rounded cursor-pointer accent-purple-500"
                          onClick={e => e.stopPropagation()}
                        />
                      </div>
                    )}
                    {/* 黑天鹅告警标识 */}
                    {bs?.active && (
                      <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-red-500/15 border border-red-500/30">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                      </div>
                    )}

                    {/* 股票标识 */}
                    {!bs?.active && (
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                          background: isUp ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                          border: isUp ? '1px solid rgba(239,68,68,0.15)' : '1px solid rgba(34,197,94,0.15)'
                        }}>
                        <TrendingUp className={`w-5 h-5 ${isUp ? 'text-red-400' : 'text-green-400 rotate-180'}`} />
                      </div>
                    )}

                    {/* 股票信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-base truncate">{stock.name}</h4>
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>{stock.code}</span>
                        {analysis && (
                          <span className={`text-xs px-2 py-0.5 rounded-lg font-semibold ${analysis.scores.final >= 80 ? 'bg-red-500/15 text-red-500' : analysis.scores.final >= 50 ? 'bg-orange-500/15 text-orange-400' : analysis.scores.final < 50 ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-400'}`}>
                            {analysis.scores.final}分
                          </span>
                        )}
                        {bs?.active && (
                          <span className="text-xs px-2 py-0.5 rounded-lg font-semibold bg-red-500/15 text-red-400 animate-pulse">
                            {bs.title}
                          </span>
                        )}
                        {/* 凯利仓位标签 */}
                        {(() => {
                          const kelly = calculateKellyForStock(stock, analysis?.signal);
                          if (kelly && kelly.adjustedFraction > 0) {
                            return (
                              <span 
                                className="text-xs px-2 py-0.5 rounded-lg font-semibold bg-purple-500/15 text-purple-400 flex items-center gap-1"
                                title={`凯利公式建议仓位: ${kelly.kellyFraction != null ? Number(kelly.kellyFraction).toFixed(1) : '--'}% (半凯利调整后: ${kelly.adjustedFraction != null ? Number(kelly.adjustedFraction).toFixed(1) : '--'}%)`}
                              >
                                <Calculator className="w-3 h-3" />
                                仓位 {kelly.adjustedFraction != null ? Number(kelly.adjustedFraction).toFixed(0) : '--'}%
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm">
                        <span style={{ color: 'var(--text-secondary)' }}>
                          现价 <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{stock.price != null ? Number(stock.price).toFixed(2) : '--'}</span>
                        </span>
                        <span className={`font-semibold ${isUp ? 'text-red-400' : 'text-green-400'}`}>
                          {isUp ? '+' : ''}{(stock.changePercent != null ? Number(stock.changePercent).toFixed(2) : '0')}%
                        </span>
                        {analysis && (
                          <span className="text-xs text-[var(--text-tertiary)]">
                            尧帝 · {analysis.recommendation} · {analysis.best_strategy?.name || '--'}
                          </span>
                        )}
                        {analysis?.best_strategy && (
                          <span className="text-xs text-purple-400/70">
                            Lv.{analysis.best_strategy.level}
                          </span>
                        )}
                        {/* 凯利仓位股数提示 */}
                        {(() => {
                          const kelly = calculateKellyForStock(stock, analysis?.signal);
                          if (kelly && kelly.shares > 0) {
                            return (
                              <span className="text-xs text-purple-400/70" title={kelly.riskWarning?.join('\n')}>
                                建议 {kelly.shares}股 · ¥{kelly.positionValue?.toLocaleString()}
                              </span>
                            );
                          }
                          return null;
                        })()}
                        {/* 主力强度标签（新版 2026-05-11：抢筹/建仓/洗盘/出货） */}
                        {(() => {
                          // 优先使用 /api/pool/realtime 的实时数据
                          const storeStrength = stock.strengthClass;
                          const storePct = stock.mainStrength;
                          // 降级：使用 /api/main-flow/today 的历史数据
                          const hist = todayMainFlowRef.current?.[stock.code];
                          const histStrength = hist?.strengthClass;
                          const histPct = hist ? Math.abs(Number(hist.main_ratio)) : null;
                          const histVal = hist?.main_inflow || 0;
                          const histSign = histVal >= 0 ? '+' : '';
                          const histAbsVal = Math.abs(histVal);
                          const histLabel = histAbsVal >= 1e8 ? `${histSign}${(histVal/1e8).toFixed(2)}亿`
                            : histAbsVal >= 1e4 ? `${histSign}${(histVal/1e4).toFixed(0)}万`
                            : `${histSign}${histAbsVal.toFixed(0)}`;
                          const showClass = storeStrength || histStrength;
                          const showPct = storePct ?? histPct;
                          if (!showClass) return null;
                          // 颜色映射：建仓=红 / 洗盘=橙 / 抢筹=红 / 出货=绿
                          const clsColor = showClass === '抢筹' ? 'text-red-400'
                            : showClass === '建仓' ? 'text-red-400'
                            : showClass === '洗盘' ? 'text-orange-400'
                            : showClass === '出货' ? 'text-green-400'
                            : 'text-yellow-400';
                          const bgColor = showClass === '抢筹' ? 'bg-red-500/15'
                            : showClass === '建仓' ? 'bg-red-500/15'
                            : showClass === '洗盘' ? 'bg-orange-500/15'
                            : showClass === '出货' ? 'bg-green-500/15'
                            : 'bg-yellow-500/15';
                          return (
                            <span className={`text-xs px-2 py-0.5 rounded-lg font-semibold ${showClass === '出货' ? 'bg-green-500/15 text-green-400' : showClass === '洗盘' ? 'bg-orange-500/15 text-orange-400' : showClass === '建仓' || showClass === '抢筹' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>
                              💰主力 {histLabel} <span className="opacity-75">({storePct != null ? `${storePct}%` : `${histPct != null ? histPct.toFixed(1) + '%' : ''}`})</span>
                              {' '}<span className={`${clsColor} font-bold`}>[{showClass}]</span>
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 opacity-70 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleMoveToTop(stock.code)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-medium transition-colors"
                        title="上移到第一排序">
                        <Zap className="w-3.5 h-3.5" />置顶
                      </button>
                      <button onClick={() => handleAnalyze(stock)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-xl text-xs font-medium transition-colors">
                        <Brain className="w-3.5 h-3.5" />尧帝分析
                      </button>
                      <button onClick={() => fetchPredict(stock.code, stock.name)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-xs font-medium transition-colors">
                        <Target className="w-3.5 h-3.5" />预测
                      </button>
                      <button onClick={() => fetchIndicator(stock.code, stock.name)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-medium transition-colors">
                        <Activity className="w-3.5 h-3.5" />指标
                      </button>
                      <button onClick={() => fetchKline(stock.code, stock.name)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-medium transition-colors">
                        <BarChart2 className="w-3.5 h-3.5" />K线
                      </button>
                      <button onClick={() => setIntradayTarget({ code: stock.code, name: stock.name })}
                        className="flex items-center gap-1.5 px-3 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl text-xs font-medium transition-colors">
                        <Activity className="w-3.5 h-3.5" />分时
                      </button>
                      <button onClick={() => setMainFlowTarget({ code: stock.code, name: stock.name })}
                        className="flex items-center gap-1.5 px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-medium transition-colors"
                        title="主力资金">
                        💰主力
                      </button>
                      {(() => {
                        const analysis = getPoolScore(stock.code);
                        const kelly = calculateKellyForStock(stock, analysis?.signal);
                        if (kelly && kelly.adjustedFraction > 0) {
                          return (
                            <button onClick={() => showKellyModal(stock)}
                              className="flex items-center gap-1.5 px-3 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-xl text-xs font-medium transition-colors"
                              title="查看凯利仓位详情">
                              <Calculator className="w-3.5 h-3.5" />仓位
                            </button>
                          );
                        }
                        return null;
                      })()}
                      <button onClick={() => removeFromPool(stock.code)}
                        className="p-2 rounded-xl hover:bg-red-500/15 text-[var(--text-tertiary)] hover:text-red-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* 黑天鹅预警详情条（折叠显示） */}
                  {bs?.active && (
                    <div className="mt-3 ml-0 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400/80">
                      ⚠️ {bs.title} · 严重程度 {bs.score}/100 · {bs.severity === 'severe' ? '建议立即关注' : bs.severity === 'moderate' ? '建议谨慎操作' : '建议关注'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* K线图弹窗（Recharts 实现） */}
      {klineTarget && (
        <div className="fixed inset-0 z-50 overflow-hidden backdrop-blur-sm" style={{ background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => { setKlineTarget(null); setKlineData(null); }}>
          <div className="rounded-2xl w-[880px] max-w-[95vw]" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', height:'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
              <div>
                <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{klineTarget.name} K线图</div>
                <div className="text-xs text-[var(--text-tertiary)]">{klineTarget.code} · 日K · 近60日（含MA5/MA10/MA20均线）</div>
              </div>
              <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-yellow-400 inline-block"></span>MA5</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-orange-400 inline-block"></span>MA10</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-purple-400 inline-block"></span>MA20</span>
              </div>
              <button onClick={() => { setKlineTarget(null); setKlineData(null); }}
                className="p-2 rounded-lg hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-tertiary)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 flex-1" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
              {klineLoading ? (
                <div className="flex items-center justify-center py-20"><div className="loading-spinner" /></div>
              ) : klineData && klineData.length > 0 ? (
                <KlineChart klines={klineData} />
              ) : (
                <div className="text-center py-20" style={{ color: 'var(--text-tertiary)' }}>暂无K线数据</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 单股预测弹窗 - 尧帝AI驱动 */}
      {predictTarget && (
        <div className="fixed inset-0 z-50 overflow-hidden backdrop-blur-sm" style={{ background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => { setPredictTarget(null); setPredictData(null); }}>
          <div className="rounded-2xl w-[440px] max-w-[95vw]" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', height:'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.15))' }}>
                  <Brain className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{predictTarget.name}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{predictTarget.code} · 尧帝AI预测</div>
                </div>
              </div>
              <button onClick={() => { setPredictTarget(null); setPredictData(null); }}
                className="p-2 rounded-lg hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-tertiary)' }}>
                <X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 flex-1" style={{ overflowY: 'auto' }}>
              {predictLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center animate-pulse">
                    <Brain className="w-8 h-8 text-purple-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-purple-400 font-medium">尧帝正在预测</p>
                    <div className="text-xs text-[var(--text-tertiary)] mt-1">综合回测胜率与技术指标分析中</div>
                  </div>
                </div>
              ) : predictData ? (
                <div>
                  {/* 尧帝状态条 */}
                  {predictData.yaodi && (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-lg mb-4" style={{ background: 'linear-gradient(135deg, rgba(114,46,209,0.08), rgba(22,119,255,0.06))', border: '1px solid rgba(114,46,209,0.15)' }}>
                      <Zap className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-[11px] text-purple-400 font-bold">尧帝 V{predictData.yaodi.mainVersion || 2}</span>
                      <div className="w-px h-3.5 bg-purple-500/20" />
                      <span className="text-[11px] text-[var(--text-secondary)]">准确率 <span className="text-purple-300 font-bold">{predictData.yaodi.accuracy != null ? Number(predictData.yaodi.accuracy).toFixed(1) + '%' : '--'}</span></span>
                      <span className="text-[11px] text-[var(--text-secondary)]">胜率 <span className="text-blue-300 font-bold">{predictData.yaodi.winRate != null ? Number(predictData.yaodi.winRate).toFixed(1) + '%' : '--'}</span></span>
                      <span className="text-[11px] text-[var(--text-secondary)]">进化 <span className="text-purple-300 font-bold">{predictData.yaodi.evolutionCount?.toLocaleString() || '--'}</span></span>
                    </div>
                  )}

                  {/* 方向判断 */}
                  <div className="flex items-center justify-center gap-4 mb-5 py-4 rounded-xl" style={{ background: predictData.direction === 'up' ? 'rgba(52,199,89,0.08)' : predictData.direction === 'down' ? 'rgba(255,59,48,0.08)' : 'rgba(142,142,147,0.08)' }}>
                    <div className="text-5xl">{predictData.direction === 'up' ? '📈' : predictData.direction === 'down' ? '📉' : '➡️'}</div>
                    <div>
                      <div className="text-2xl font-bold" style={{ color: predictData.direction === 'up' ? 'var(--accent-red)' : predictData.direction === 'down' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                        {predictData.directionText || (predictData.direction === 'up' ? '看涨' : predictData.direction === 'down' ? '看跌' : '震荡')}
                      </div>
                      <div className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
                        置信度 <span className="font-bold text-purple-400">{predictData.confidence != null ? Number(predictData.confidence).toFixed(0) : '--'}%</span>
                        <span className="mx-2">·</span>
                        回测胜率 <span className="font-bold text-blue-400">{predictData.backtestWinRate != null ? Number(predictData.backtestWinRate).toFixed(0) : '--'}%</span>
                      </div>
                    </div>
                  </div>

                  {/* 关键数据 */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { label: '目标价', value: predictData.targetPrice != null ? `¥${Number(predictData.targetPrice).toFixed(2)}` : '--', color: 'var(--accent-red)' },
                      { label: '止损价', value: predictData.stopLoss != null ? `¥${Number(predictData.stopLoss).toFixed(2)}` : '--', color: 'var(--accent-green)' },
                      { label: '预期收益', value: predictData.expectedReturn != null ? `${Number(predictData.expectedReturn).toFixed(1)}%` : '--', color: Number(predictData.expectedReturn) >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' },
                      { label: '风险等级', value: predictData.riskLevel || '中', color: predictData.riskLevel === '高' ? 'var(--accent-red)' : predictData.riskLevel === '低' ? 'var(--accent-green)' : 'var(--accent-orange)' },
                    ].map((item, i) => (
                      <div key={i} className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{item.label}</div>
                        <div className="text-base font-bold mt-1" style={{ color: item.color }}>{item.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* 信号来源 */}
                  {predictData.signals?.length > 0 && (
                    <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                      <div className="text-xs font-semibold text-amber-400 mb-2">📊 信号来源</div>
                      <div className="flex flex-wrap gap-2">
                        {predictData.signals.map((s, i) => (
                          <span key={i} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{s}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 分析建议 */}
                  {predictData.reason && (
                    <div className="p-3 rounded-lg text-sm" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                      💡 {predictData.reason}
                      {predictData.holdingPeriod && (
                        <span className="ml-2 text-purple-400 font-medium">建议持仓: {predictData.holdingPeriod}</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-10" style={{ color: 'var(--text-tertiary)' }}>暂无预测数据</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 技术指标弹窗 */}
      {indicatorTarget && (
        <div className="fixed inset-0 z-50 overflow-hidden backdrop-blur-sm" style={{ background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => { setIndicatorTarget(null); setIndicatorData(null); }}>
          <div className="rounded-2xl w-[450px] max-w-[95vw]" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', height:'88vh', overflow:'hidden', display:'flex', flexDirection:'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
              <div>
                <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{indicatorTarget.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{indicatorTarget.code} · 技术指标</div>
              </div>
              <button onClick={() => { setIndicatorTarget(null); setIndicatorData(null); }}
                className="p-2 rounded-lg hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-tertiary)' }}>
                <X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 flex-1" style={{ overflowY: 'auto' }}>
              {indicatorLoading ? <div className="flex items-center justify-center py-10"><div className="loading-spinner" /></div>
              : indicatorData ? (
                <div className="grid grid-cols-2 gap-3">
                  {indicatorData.rsi && (
                    <div className="rounded-xl p-4" style={{ background: 'var(--bg-secondary)' }}>
                      <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>RSI 相对强弱</div>
                      <div className="text-2xl font-bold"
                        style={{ color: indicatorData.rsi.value > 70 ? 'var(--accent-red)' : indicatorData.rsi.value < 30 ? 'var(--accent-green)' : 'var(--text-primary)' }}>
                        {indicatorData.rsi.value != null ? Number(indicatorData.rsi.value).toFixed(1) : '--'}
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{indicatorData.rsi.status}</div>
                    </div>
                  )}
                  {indicatorData.macd && (
                    <div className="rounded-xl p-4" style={{ background: 'var(--bg-secondary)' }}>
                      <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>MACD</div>
                      <div className="text-lg font-bold"
                        style={{ color: indicatorData.macd.macd > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                        {indicatorData.macd.macd != null ? Number(indicatorData.macd.macd).toFixed(2) : '--'}
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>DIF {indicatorData.macd.dif != null ? Number(indicatorData.macd.dif).toFixed(2) : '--'} · DEA {indicatorData.macd.dea != null ? Number(indicatorData.macd.dea).toFixed(2) : '--'}</div>
                      <div className="text-xs" style={{ color: indicatorData.macd.trend === '多头' ? 'var(--accent-red)' : 'var(--accent-green)' }}>{indicatorData.macd.trend}</div>
                    </div>
                  )}
                  {indicatorData.kdj && (
                    <div className="rounded-xl p-4" style={{ background: 'var(--bg-secondary)' }}>
                      <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>KDJ 随机指标</div>
                      <div className="flex gap-3 text-sm font-bold">
                        <span style={{ color: 'var(--accent-blue)' }}>K {indicatorData.kdj.k != null ? Number(indicatorData.kdj.k).toFixed(1) : '--'}</span>
                        <span style={{ color: 'var(--accent-green)' }}>D {indicatorData.kdj.d != null ? Number(indicatorData.kdj.d).toFixed(1) : '--'}</span>
                        <span style={{ color: 'var(--accent-red)' }}>J {indicatorData.kdj.j != null ? Number(indicatorData.kdj.j).toFixed(1) : '--'}</span>
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{indicatorData.kdj.status}</div>
                    </div>
                  )}
                  {indicatorData.boll && (
                    <div className="rounded-xl p-4" style={{ background: 'var(--bg-secondary)' }}>
                      <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>BOLL 布林带</div>
                      <div className="text-xs space-y-1">
                        <div>上轨: <span style={{ color: 'var(--accent-red)' }}>{indicatorData.boll.upper != null ? Number(indicatorData.boll.upper).toFixed(2) : '--'}</span></div>
                        <div>中轨: <span style={{ color: 'var(--text-primary)' }}>{indicatorData.boll.middle != null ? Number(indicatorData.boll.middle).toFixed(2) : '--'}</span></div>
                        <div>下轨: <span style={{ color: 'var(--accent-green)' }}>{indicatorData.boll.lower != null ? Number(indicatorData.boll.lower).toFixed(2) : '--'}</span></div>
                      </div>
                    </div>
                  )}
                  {indicatorData.ma && (
                    <div className="col-span-2 rounded-xl p-4" style={{ background: 'var(--bg-secondary)' }}>
                      <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>均线系统 <span className={indicatorData.ma.maStrength === '多头' ? 'text-red-400' : indicatorData.ma.maStrength === '空头' ? 'text-green-400' : 'text-yellow-400'}>({indicatorData.ma.maStrength})</span></div>
                      <div className="flex flex-wrap gap-3 text-xs">
                        {indicatorData.ma.ma5 && <span>MA5 <span className="font-bold">{indicatorData.ma.ma5 != null ? Number(indicatorData.ma.ma5).toFixed(2) : '--'}</span></span>}
                        {indicatorData.ma.ma10 && <span>MA10 <span className="font-bold">{indicatorData.ma.ma10 != null ? Number(indicatorData.ma.ma10).toFixed(2) : '--'}</span></span>}
                        {indicatorData.ma.ma20 && <span>MA20 <span className="font-bold">{indicatorData.ma.ma20 != null ? Number(indicatorData.ma.ma20).toFixed(2) : '--'}</span></span>}
                        {indicatorData.ma.ma30 && <span>MA30 <span className="font-bold">{indicatorData.ma.ma30 != null ? Number(indicatorData.ma.ma30).toFixed(2) : '--'}</span></span>}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-10" style={{ color: 'var(--text-tertiary)' }}>暂无指标数据</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 分时图弹窗 */}
      {intradayTarget && (
        <IntradayChart code={intradayTarget.code} name={intradayTarget.name} onClose={() => setIntradayTarget(null)} />
      )}

      {/* 主力资金弹窗 */}
      {mainFlowTarget && (
        <div className="fixed inset-0 z-50 overflow-hidden backdrop-blur-sm" style={{ background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setMainFlowTarget(null)}>
          <div className="rounded-2xl w-[560px] max-w-[95vw]" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', maxHeight:'82vh', overflow:'hidden', display:'flex', flexDirection:'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-3">
                <span style={{ fontSize:'20px' }}>💰</span>
                <div>
                  <div className="font-bold text-base" style={{ color:'var(--text-primary)' }}>{mainFlowTarget.name}</div>
                  <div className="text-xs" style={{ color:'var(--text-tertiary)' }}>{mainFlowTarget.code}</div>
                </div>
              </div>
              <button onClick={() => setMainFlowTarget(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--bg-tertiary)]" style={{ color:'var(--text-secondary)' }}>
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <MainFlowChart code={mainFlowTarget.code} name={mainFlowTarget.name} />
            </div>
          </div>
        </div>
      )}

      {/* 凯利仓位详情弹窗 */}
      {kellyTarget && kellyData && (
        <div className="fixed inset-0 z-50 overflow-hidden backdrop-blur-sm" style={{ background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => { setKellyTarget(null); setKellyData(null); }}>
          <div className="rounded-2xl w-[420px] max-w-[95vw]" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', maxHeight:'85vh', overflow:'hidden', display:'flex', flexDirection:'column' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.15))' }}>
                  <Calculator className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{kellyTarget.name}</div>
                  <div className="text-xs text-[var(--text-tertiary)]">{kellyTarget.code} · 凯利公式仓位计算</div>
                </div>
              </div>
              <button onClick={() => { setKellyTarget(null); setKellyData(null); }}
                className="p-2 rounded-lg hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-tertiary)' }}>
                <X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 flex-1" style={{ overflowY: 'auto' }}>
              {/* 仓位建议主显示 */}
              <div className="flex items-center justify-center gap-4 mb-5 py-5 rounded-xl" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.15)' }}>
                <div className="text-center">
                  <div className="text-4xl font-bold text-purple-400">{kellyData.adjustedFraction}%</div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-1">建议仓位比例</div>
                </div>
                <div className="w-px h-12 bg-purple-500/20" />
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-300">{kellyData.shares}股</div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-1">建议买入数量</div>
                </div>
              </div>

              {/* 详细数据 */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="text-xs text-[var(--text-tertiary)]">原始凯利比例</div>
                  <div className="text-lg font-bold text-purple-400">{kellyData.kellyFraction}%</div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-1">未调整前</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="text-xs text-[var(--text-tertiary)]">半凯利调整后</div>
                  <div className="text-lg font-bold text-purple-400">{kellyData.adjustedFraction}%</div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-1">风险折半</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="text-xs text-[var(--text-tertiary)]">仓位金额</div>
                  <div className="text-lg font-bold text-purple-400">¥{kellyData.positionValue?.toLocaleString()}</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="text-xs text-[var(--text-tertiary)]">盈亏比</div>
                  <div className="text-lg font-bold text-purple-400">{kellyData.details?.winLossRatio}</div>
                </div>
              </div>

              {/* 公式说明 */}
              <div className="mb-4 p-3 rounded-lg text-xs" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                <div className="font-medium mb-2 text-purple-400">📐 凯利公式</div>
                <div className="font-mono bg-[var(--bg-tertiary)] p-2 rounded mb-2">
                  f* = (bp - q) / b
                </div>
                <div className="space-y-1 text-[var(--text-tertiary)]">
                  <div>b = 盈亏比 ({kellyData.details?.winLossRatio})</div>
                  <div>p = 胜率 (来自尧帝信号)</div>
                  <div>q = 1 - p (败率)</div>
                  <div>期望值 = {kellyData.details?.expectedValue}</div>
                </div>
              </div>

              {/* 风险提示 */}
              {kellyData.riskWarning && kellyData.riskWarning.length > 0 && (
                <div className="p-3 rounded-lg" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.15)' }}>
                  <div className="text-xs font-medium text-amber-400 mb-2">⚠️ 风险提示</div>
                  <div className="space-y-1">
                    {kellyData.riskWarning.map((warning, i) => (
                      <div key={i} className="text-xs text-amber-400/80">{warning}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* 策略说明 */}
              <div className="mt-4 p-3 rounded-lg text-xs" style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
                <div className="font-medium mb-1 text-[var(--text-secondary)]">💡 策略说明</div>
                <div>采用半凯利策略（Half-Kelly），将原始凯利比例减半以降低风险。同时设置最大仓位上限25%，确保单只股票不会过度集中。</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗 */}
      <AddStockModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onAdd={handleAddStock} />
      <StockAnalysisModal stock={selectedStock} isOpen={showAnalysisModal} onClose={() => setShowAnalysisModal(false)} />
    </div>
  );
}
