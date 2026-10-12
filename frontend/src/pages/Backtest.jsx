/**
 * 回测配置页面 - P2优化
 * 支持策略回测参数配置、历史回测查看、策略对比
 */
import { useState, useEffect } from 'react';
import { API_BASE } from '../config/api';
import { Play, History, BarChart2, TrendingUp, TrendingDown, RefreshCw, Settings, ChevronDown } from 'lucide-react';

// 回测策略类型
const STRATEGIES = [
  { id: 'ma_cross', name: '均线交叉', desc: 'MA5/MA20金叉死叉' },
  { id: 'macd_cross', name: 'MACD交叉', desc: 'MACD金叉死叉信号' },
  { id: 'rsi_reversal', name: 'RSI反转', desc: 'RSI超买超卖反转' },
  { id: 'bollinger', name: '布林带', desc: '突破布林带上下轨' },
  { id: 'yaodi_v2', name: '尧帝V2', desc: '三层选股策略' },
  { id: 'shundi', name: '舜帝执行', desc: '舜帝实盘策略' },
];

// 格式化函数
const fmt = (n, d = 2) => n == null ? '--' : Number(n).toFixed(d);
const fmtPct = (n) => n == null ? '--' : `${Number(n).toFixed(1)}%`;
const fmtMoney = (n) => n == null ? '--' : `¥${Number(n).toFixed(0)}`;

export default function BacktestPage() {
  // 状态
  const [activeTab, setActiveTab] = useState('config'); // config | history | compare
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState(null);
  const [compareData, setCompareData] = useState(null);
  
  // 回测配置
  const [config, setConfig] = useState({
    strategy: 'yaodi_v2',
    startDate: '2025-01-01',
    endDate: '2026-05-07',
    initialCapital: 1000000,
    commission: 0.0003,
    slippage: 0.001,
    stopLoss: 5,
    takeProfit: 8,
    maxPosition: 0.2,
  });
  
  // 回测结果
  const [result, setResult] = useState(null);

  // API调用
  const apiGet = async (path) => {
    try {
      const res = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[Backtest] API失败:', err.message);
      return null;
    }
  };

  // 获取历史回测
  const fetchHistory = async () => {
    setLoading(true);
    const data = await apiGet('/backtest/history');
    if (data?.success) {
      setHistory(data.report);
    }
    setLoading(false);
  };

  // 获取策略对比
  const fetchCompare = async () => {
    setLoading(true);
    const data = await apiGet('/backtest/compare');
    if (data?.success) {
      setCompareData(data.comparison);
    }
    setLoading(false);
  };

  // 运行回测
  const runBacktest = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (data?.success) {
        setResult(data.result);
      } else {
        alert('回测失败: ' + (data?.error || '未知错误'));
      }
    } catch (e) {
      alert('回测异常: ' + e.message);
    }
    setLoading(false);
  };

  // 初始化加载
  useEffect(() => {
    if (activeTab === 'history' && !history) fetchHistory();
    if (activeTab === 'compare' && !compareData) fetchCompare();
  }, [activeTab]);

  // 样式
  const cardStyle = {
    background: 'var(--card-bg, rgba(30,41,59,0.8))',
    borderRadius: 12,
    padding: 16,
    border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
  };

  const inputStyle = {
    background: 'var(--input-bg, rgba(15,23,42,0.6))',
    border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
    borderRadius: 6,
    padding: '8px 12px',
    color: 'var(--text-primary, #fff)',
    fontSize: 13,
  };

  const btnStyle = (primary = false) => ({
    background: primary ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'var(--btn-bg, rgba(255,255,255,0.1))',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  });

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <BarChart2 size={24} style={{ color: '#6366f1' }} />
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>策略回测</h1>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          尧帝智能版 v2.0
        </span>
      </div>

      {/* Tab切换 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'config', label: '配置回测', icon: Settings },
          { key: 'history', label: '历史记录', icon: History },
          { key: 'compare', label: '策略对比', icon: BarChart2 },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              ...btnStyle(activeTab === tab.key),
              background: activeTab === tab.key ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'var(--btn-bg, rgba(255,255,255,0.1))',
            }}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* 配置回测 */}
      {activeTab === 'config' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* 左侧：配置 */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#6366f1' }}>
              回测参数
            </h3>
            
            {/* 策略选择 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                策略类型
              </label>
              <select
                value={config.strategy}
                onChange={e => setConfig({ ...config, strategy: e.target.value })}
                style={{ ...inputStyle, width: '100%' }}
              >
                {STRATEGIES.map(s => (
                  <option key={s.id} value={s.id}>{s.name} - {s.desc}</option>
                ))}
              </select>
            </div>

            {/* 日期范围 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  开始日期
                </label>
                <input
                  type="date"
                  value={config.startDate}
                  onChange={e => setConfig({ ...config, startDate: e.target.value })}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  结束日期
                </label>
                <input
                  type="date"
                  value={config.endDate}
                  onChange={e => setConfig({ ...config, endDate: e.target.value })}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
            </div>

            {/* 资金参数 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  初始资金
                </label>
                <input
                  type="number"
                  value={config.initialCapital}
                  onChange={e => setConfig({ ...config, initialCapital: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  单笔最大仓位
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={config.maxPosition}
                  onChange={e => setConfig({ ...config, maxPosition: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
            </div>

            {/* 风控参数 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  止损比例 (%)
                </label>
                <input
                  type="number"
                  value={config.stopLoss}
                  onChange={e => setConfig({ ...config, stopLoss: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  止盈比例 (%)
                </label>
                <input
                  type="number"
                  value={config.takeProfit}
                  onChange={e => setConfig({ ...config, takeProfit: Number(e.target.value) })}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
            </div>

            {/* 运行按钮 */}
            <button
              onClick={runBacktest}
              disabled={loading}
              style={{ ...btnStyle(true), width: '100%', justifyContent: 'center', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
              {loading ? '回测运行中...' : '开始回测'}
            </button>
          </div>

          {/* 右侧：结果 */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#6366f1' }}>
              回测结果
            </h3>
            
            {result ? (
              <div>
                {/* 汇总指标 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>总收益率</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: (result.totalReturn || 0) >= 0 ? '#10b981' : '#ef4444' }}>
                      {fmtPct((result.totalReturn || 0) * 100)}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>胜率</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#6366f1' }}>
                      {fmtPct(result.winRate)}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>最大回撤</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>
                      {fmtPct(result.maxDrawdown)}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>夏普比率</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>
                      {fmt(result.sharpeRatio)}
                    </div>
                  </div>
                </div>

                {/* 交易统计 */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>交易统计</div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                    <span>总交易: <strong>{result.totalTrades || 0}</strong>笔</span>
                    <span>盈利: <strong style={{ color: '#10b981' }}>{result.winTrades || 0}</strong>笔</span>
                    <span>亏损: <strong style={{ color: '#ef4444' }}>{result.loseTrades || 0}</strong>笔</span>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                <BarChart2 size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
                <div>配置参数后点击"开始回测"</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 历史记录 */}
      {activeTab === 'history' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#6366f1', margin: 0 }}>历史回测记录</h3>
            <button onClick={fetchHistory} style={{ ...btnStyle(), padding: '6px 12px' }}>
              <RefreshCw size={12} /> 刷新
            </button>
          </div>

          {history ? (
            <div>
              {/* 汇总 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>总交易</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{history.summary?.totalTrades || 0}</div>
                </div>
                <div style={{ background: 'rgba(16,185,129,0.1)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>盈利笔数</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981' }}>{history.summary?.winTrades || 0}</div>
                </div>
                <div style={{ background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>胜率</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{history.summary?.winRate || 0}%</div>
                </div>
                <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>总盈亏</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: (history.summary?.totalProfit || 0) >= 0 ? '#10b981' : '#ef4444' }}>
                    {fmtMoney(history.summary?.totalProfit)}
                  </div>
                </div>
              </div>

              {/* 策略统计表 */}
              {history.strategyStats && history.strategyStats.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text-secondary)' }}>策略</th>
                      <th style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--text-secondary)' }}>交易</th>
                      <th style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--text-secondary)' }}>胜率</th>
                      <th style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--text-secondary)' }}>盈亏</th>
                      <th style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--text-secondary)' }}>夏普</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.strategyStats.map((s, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '8px 4px' }}>{s.strategy}</td>
                        <td style={{ textAlign: 'right', padding: '8px 4px' }}>{s.total_trades}</td>
                        <td style={{ textAlign: 'right', padding: '8px 4px', color: s.win_rate >= 50 ? '#10b981' : '#ef4444' }}>
                          {fmtPct(s.win_rate)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '8px 4px', color: s.total_profit >= 0 ? '#10b981' : '#ef4444' }}>
                          {fmtMoney(s.total_profit)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '8px 4px' }}>{fmt(s.sharpe_ratio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
              {loading ? '加载中...' : '暂无历史记录'}
            </div>
          )}
        </div>
      )}

      {/* 策略对比 */}
      {activeTab === 'compare' && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#6366f1' }}>策略对比</h3>
          {compareData ? (
            <div style={{ fontSize: 13 }}>
              <pre style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, overflow: 'auto' }}>
                {JSON.stringify(compareData, null, 2)}
              </pre>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
              {loading ? '加载中...' : '暂无对比数据'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
