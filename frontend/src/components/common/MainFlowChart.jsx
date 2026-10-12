/**
 * 主力资金图表组件
 * 支持两种模式:
 * 1. 日线历史 - 每日主力净流入柱状图
 * 2. 分时走势 - 日内分钟级主力资金累计曲线
 */
import { useState, useEffect, useMemo } from 'react';
import { ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { mainFlowAPI } from '../../services/api';

// 格式化资金数字
function formatFlow(val) {
  if (val == null) return '--';
  const abs = Math.abs(val);
  if (abs >= 1e8) return (val / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (val / 1e4).toFixed(0) + '万';
  return val.toFixed(0);
}

// 迷你柱状图(卡片用)
function MiniFlowBar({ value, size = 40 }) {
  const pct = Math.min(Math.abs(value) / 1e8, 1);
  const h = Math.max(2, pct * size);
  const color = value >= 0 ? '#ef4444' : '#22c55e';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ height: h, width: 6, background: color, borderRadius: 2 }} />
    </div>
  );
}

// 主要图表组件
export default function MainFlowChart({ code, name, compact = false }) {
  const [mode, setMode] = useState('min'); // 'min' = 分时, 'daily' = 日线
  const [dailyData, setDailyData] = useState([]);
  const [minData, setMinData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 加载日线数据
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    mainFlowAPI.getHistory(code, 30).then(res => {
      if (cancelled) return;
      if (res.success && res.data && res.data.length > 0) {
        setDailyData([...res.data].reverse());
      } else { setDailyData([]); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [code]);

  // 加载分时数据
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setLoading(true);
    mainFlowAPI.getMinFlow(code).then(res => {
      if (cancelled) return;
      if (res.success && res.data && res.data.length > 0) {
        setMinData(res.data);
      } else { setMinData([]); }
      setLoading(false);
    }).catch(e => {
      if (!cancelled) { setError(e.message); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [code]);

  const data = mode === 'min' ? minData : dailyData;

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '12px', color: 'var(--text-tertiary)' }}>
      加载中...
    </div>
  );
  if (error && mode === 'min') return (
    <div style={{ textAlign: 'center', padding: '12px 0', fontSize: '12px', color: '#ef4444' }}>
      获取失败
    </div>
  );
  if (!data || data.length === 0) return (
    <div style={{ textAlign: 'center', padding: '12px 0', fontSize: '12px', color: 'var(--text-tertiary)' }}>
      暂无主力数据
    </div>
  );

  // compact模式（卡片内嵌）
  if (compact) {
    const latest = minData.length > 0 ? minData[minData.length - 1] : (dailyData.length > 0 ? dailyData[dailyData.length - 1] : {});
    const netIn = latest.main_inflow || 0;
    const netColor = netIn >= 0 ? '#ef4444' : '#22c55e';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '32px' }}>
          {dailyData.slice(-15).map((d, i) => <MiniFlowBar key={i} value={d.main_inflow} size={20} />)}
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: netColor }}>
            {netIn >= 0 ? '净入' : '净出'}{formatFlow(Math.abs(netIn))}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{dailyData.length}日</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* 模式切换 */}
      <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', borderRadius: '8px', padding: '3px' }}>
        <button
          onClick={() => setMode('min')}
          style={{
            flex: 1, padding: '6px 0', border: 'none', borderRadius: '6px', cursor: 'pointer',
            fontSize: '12px', fontWeight: 600,
            background: mode === 'min' ? 'var(--bg-primary)' : 'transparent',
            color: mode === 'min' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            boxShadow: mode === 'min' ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
            transition: 'all 0.2s'
          }}
        >
          📊 分时走势
        </button>
        <button
          onClick={() => setMode('daily')}
          style={{
            flex: 1, padding: '6px 0', border: 'none', borderRadius: '6px', cursor: 'pointer',
            fontSize: '12px', fontWeight: 600,
            background: mode === 'daily' ? 'var(--bg-primary)' : 'transparent',
            color: mode === 'daily' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            boxShadow: mode === 'daily' ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
            transition: 'all 0.2s'
          }}
        >
          📈 日线历史
        </button>
      </div>

      {mode === 'min' ? <MinFlowChart data={minData} code={code} /> : <DailyFlowChart data={dailyData} />}
    </div>
  );
}

// ========== 分时走势组件 ==========
function MinFlowChart({ data, code }) {
  // 计算每分钟的增量（API返回的是累计值，需要转为每分钟增量）
  const chartData = useMemo(() => {
    if (!data.length) return [];
    return data.map((d, i) => {
      const prevMain = i > 0 ? (data[i - 1].main_inflow || 0) : 0;
      const curMain = d.main_inflow || 0;
      const deltaMain = curMain - prevMain; // 本分钟净流入
      return {
        time: d.datetime ? d.datetime.split(' ')[1] : '', // "09:31"
        datetime: d.datetime,
        mainCum: curMain / 1e8,           // 累计主力净流入(亿)
        deltaMain: deltaMain / 1e8,        // 本分钟主力净流入(亿)
        largeCum: (d.large_inflow || 0) / 1e8,
        superCum: (d.super_large_inflow || 0) / 1e8,
        smallCum: (d.small_inflow || 0) / 1e8,
      };
    });
  }, [data]);

  const latestMain = data.length > 0 ? (data[data.length - 1].main_inflow || 0) : 0;
  const netColor = latestMain >= 0 ? '#ef4444' : '#22c55e';

  // 最大单分钟流入/流出
  const maxDelta = Math.max(...chartData.map(d => Math.abs(d.deltaMain)));
  const yDomain = [-maxDelta * 1.2, maxDelta * 1.2];

  const MinTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{ background: 'rgba(15,15,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
        <div style={{ fontWeight: 600, marginBottom: '6px', color: '#fff' }}>{d.time}</div>
        <div style={{ color: d.mainCum >= 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
          累计主力: {formatFlow(d.mainCum * 1e8)}
        </div>
        <div style={{ color: d.deltaMain >= 0 ? '#ef4444' : '#22c55e', marginTop: '3px' }}>
          本分钟: {d.deltaMain >= 0 ? '+' : ''}{d.deltaMain.toFixed(3)}亿
        </div>
        <div style={{ color: '#a78bfa', marginTop: '3px' }}>
          超大单: {formatFlow(d.superCum * 1e8)}
        </div>
        <div style={{ color: '#f59e0b', marginTop: '3px' }}>
          大单: {formatFlow(d.largeCum * 1e8)}
        </div>
      </div>
    );
  };

  // X轴刻度：每30分钟一个
  const tickInterval = Math.max(1, Math.floor(chartData.length / 8));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* 摘要统计 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
        <div style={{ fontWeight: 700, color: netColor, fontSize: '14px' }}>
          {latestMain >= 0 ? '↑' : '↓'} 主力净流入: {formatFlow(latestMain)}
        </div>
        <div style={{ color: 'var(--text-tertiary)' }}>{data.length}分钟</div>
      </div>

      {/* 累计主力资金走势线 */}
      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '-4px' }}>累计主力资金走势</div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#888' }} interval={tickInterval} />
          <YAxis tick={{ fontSize: 9, fill: '#888' }} tickFormatter={v => v.toFixed(1) + '亿'} width={52} />
          <Tooltip content={<MinTooltip />} />
          <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
          <defs>
            <linearGradient id="mainGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={latestMain >= 0 ? '#ef4444' : '#22c55e'} stopOpacity={0.3} />
              <stop offset="100%" stopColor={latestMain >= 0 ? '#ef4444' : '#22c55e'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="mainCum" stroke={latestMain >= 0 ? '#ef4444' : '#22c55e'} strokeWidth={1.5}
            fill="url(#mainGrad)" dot={false} />
          {/* 超大单叠加线 */}
          <Line type="monotone" dataKey="superCum" stroke="#a78bfa" strokeWidth={1} dot={false} strokeDasharray="3 2" />
          {/* 大单叠加线 */}
          <Line type="monotone" dataKey="largeCum" stroke="#f59e0b" strokeWidth={1} dot={false} strokeDasharray="3 2" />
        </AreaChart>
      </ResponsiveContainer>

      {/* 每分钟主力资金柱状图 */}
      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '-4px' }}>每分钟主力净流入</div>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#888' }} interval={tickInterval} />
          <YAxis tick={{ fontSize: 9, fill: '#888' }} tickFormatter={v => v.toFixed(2)} width={52} domain={yDomain} />
          <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
          <Bar dataKey="deltaMain" maxBarSize={3} radius={[1, 1, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.deltaMain >= 0 ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)'} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>

      {/* 图例 */}
      <div style={{ display: 'flex', gap: '14px', fontSize: '10px', color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 2, background: latestMain >= 0 ? '#ef4444' : '#22c55e', display: 'inline-block' }} /> 主力累计
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 2, background: '#a78bfa', display: 'inline-block' }} /> 超大单
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 2, background: '#f59e0b', display: 'inline-block' }} /> 大单
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(239,68,68,0.6)', display: 'inline-block' }} /> 净入
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(34,197,94,0.6)', display: 'inline-block' }} /> 净出
        </span>
      </div>
    </div>
  );
}

// ========== 日线历史组件 ==========
function DailyFlowChart({ data }) {
  const latest = data[data.length - 1] || {};
  const netIn = latest.main_inflow || 0;
  const totalIn = data.reduce((s, d) => s + Math.max(0, d.main_inflow || 0), 0);
  const totalOut = data.reduce((s, d) => s + Math.abs(Math.min(0, d.main_inflow || 0)), 0);
  const netColor = netIn >= 0 ? '#ef4444' : '#22c55e';

  const chartData = data.map((d, i) => {
    const inflow = (d.main_inflow || 0) / 1e8;
    let ma5 = null;
    if (i >= 4) {
      const sum = data.slice(i - 4, i + 1).reduce((s, x) => s + (x.main_inflow || 0) / 1e8, 0);
      ma5 = sum / 5;
    }
    return { ...d, mainInflow: inflow, ma5 };
  });

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    const isUp = (d.main_inflow || 0) >= 0;
    return (
      <div style={{ background: 'rgba(15,15,20,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
        <div style={{ fontWeight: 600, marginBottom: '4px', color: '#fff' }}>{d.date}</div>
        <div style={{ fontWeight: 700, color: isUp ? '#ef4444' : '#22c55e' }}>
          主力净流入: {formatFlow(d.main_inflow)}
        </div>
        {d.main_ratio != null && <div style={{ color: '#aaa', marginTop: '2px' }}>占比: {Number(d.main_ratio).toFixed(2)}%</div>}
        {d.price > 0 && <div style={{ color: '#aaa', marginTop: '2px' }}>收盘价: {d.price.toFixed(2)}</div>}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* 摘要统计 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
        <div style={{ fontWeight: 700, color: netColor, fontSize: '14px' }}>
          {netIn >= 0 ? '↑' : '↓'} 今日净流入: {formatFlow(netIn)}
        </div>
        <div style={{ color: 'var(--text-tertiary)' }}>近{data.length}日</div>
        <div style={{ color: '#ef4444' }}>净入 {formatFlow(totalIn)}</div>
        <div style={{ color: '#22c55e' }}>净出 {formatFlow(totalOut)}</div>
      </div>
      {/* 图表 */}
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#888' }}
            tickFormatter={v => v.slice(5)} interval={Math.floor(data.length / 5)} />
          <YAxis tick={{ fontSize: 10, fill: '#888' }}
            tickFormatter={v => v.toFixed(1) + '亿'} width={54} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
          <Bar dataKey="mainInflow" name="主力净流入" maxBarSize={18} radius={[2, 2, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.mainInflow >= 0 ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)'} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="ma5" name="5日均" stroke="#f59e0b" strokeWidth={1.5}
            dot={false} strokeDasharray="4 2" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      {/* 图例 */}
      <div style={{ display: 'flex', gap: '14px', fontSize: '10px', color: 'var(--text-tertiary)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(239,68,68,0.5)', display: 'inline-block' }} /> 主力净入
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(34,197,94,0.5)', display: 'inline-block' }} /> 主力净出
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 12, height: 1, background: '#f59e0b', display: 'inline-block' }} /> 5日均线
        </span>
      </div>
    </div>
  );
}
