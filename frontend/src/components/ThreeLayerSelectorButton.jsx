/**
 * 三层混合选股按钮组件
 * 调用后端 /api/three-layer/select API
 */
import { useState } from 'react';
import { apiCall } from '../config/api';
import { Brain, Loader2, Settings2, TrendingUp, Shield, BarChart3, Activity, PieChart } from 'lucide-react';


// 因子雷达图组件
function FactorRadar({ factors, size = 120 }) {
  const { fValue, fGrowth, fQuality, fMomentum, fVolatility } = factors;
  const values = [fValue, fGrowth, fQuality, fMomentum, 100 - fVolatility]; // 波动率反向
  const labels = ['估值', '成长', '质量', '动量', '稳定'];
  const angles = [0, 72, 144, 216, 288].map(a => (a - 90) * Math.PI / 180);
  
  const center = size / 2;
  const radius = size * 0.35;
  
  // 计算多边形点
  const points = values.map((v, i) => {
    const r = (v / 100) * radius;
    return `${center + r * Math.cos(angles[i])},${center + r * Math.sin(angles[i])}`;
  }).join(' ');
  
  // 网格圆
  const grids = [20, 40, 60, 80, 100].map(p => (
    <circle key={p} cx={center} cy={center} r={radius * p / 100} 
            fill="none" stroke="var(--border-color)" strokeWidth="0.5" opacity="0.3"/>
  ));
  
  // 轴线
  const axes = angles.map((a, i) => (
    <line key={i} x1={center} y1={center} 
          x2={center + radius * Math.cos(a)} y2={center + radius * Math.sin(a)}
          stroke="var(--border-color)" strokeWidth="0.5" opacity="0.3"/>
  ));
  
  // 标签
  const labelEls = labels.map((l, i) => {
    const r = radius + 15;
    const x = center + r * Math.cos(angles[i]);
    const y = center + r * Math.sin(angles[i]);
    return (
      <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fontSize="8" fill="var(--text-secondary)">{l}</text>
    );
  });
  
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      {grids}
      {axes}
      <polygon points={points} fill="rgba(59, 130, 246, 0.3)" stroke="#3b82f6" strokeWidth="1.5"/>
      {values.map((v, i) => {
        const r = (v / 100) * radius;
        return <circle key={i} cx={center + r * Math.cos(angles[i])} 
                       cy={center + r * Math.sin(angles[i])} r="2" fill="#3b82f6"/>;
      })}
      {labelEls}
    </svg>
  );
}

// 回测图表组件
function BacktestChart({ data }) {
  if (!data || data.length === 0) return null;
  
  const width = 280;
  const height = 80;
  const padding = 10;
  
  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  
  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((d.value - min) / range) * (height - 2 * padding);
    return `${x},${y}`;
  }).join(' ');
  
  return (
    <svg width={width} height={height} style={{ marginTop: 8 }}>
      {/* 网格线 */}
      <line x1={padding} y1={height/2} x2={width-padding} y2={height/2} 
            stroke="var(--border-color)" strokeDasharray="2,2" opacity="0.3"/>
      {/* 曲线 */}
      <polyline points={points} fill="none" stroke="#10b981" strokeWidth="1.5"/>
      {/* 起点终点标记 */}
      <circle cx={padding} cy={height-padding-((values[0]-min)/range)*(height-2*padding)} r="2" fill="#10b981"/>
      <circle cx={width-padding} cy={height-padding-((values[values.length-1]-min)/range)*(height-2*padding)} r="2" fill="#10b981"/>
    </svg>
  );
}

export default function ThreeLayerSelectorButton({ onSelect }) {
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    limit: 10,
    marketEnv: 'neutral',
    includeKCB: false,
    includeBEJ: false,
    excludeST: true,
  });
  const [result, setResult] = useState(null);

  const handleSelect = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: settings.limit,
        market: settings.marketEnv,
        kcb: settings.includeKCB,
        bej: settings.includeBEJ,
        excludeST: settings.excludeST,
      });
      
      const resp = await apiCall(`/api/three-layer/select?${params}`);
      const data = await resp;
      
      if (data.success) {
        setResult(data);
        onSelect && onSelect(data.stocks, data);
      } else {
        alert('三层选股失败：' + (data.error || '未知错误'));
      }
    } catch (e) {
      alert('三层选股异常：' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      {/* 主按钮 */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-lg text-sm font-medium shadow-lg shadow-blue-500/20 transition-all"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
        {loading ? 'AI选股中...' : '三层AI选股'}
      </button>

      {/* 设置面板 */}
      {showSettings && (
        <div className="absolute right-0 mt-2 w-80 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* 头部 */}
          <div className="px-4 py-3 border-b border-[var(--border-light)] bg-gradient-to-r from-blue-500/10 to-purple-500/10">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-blue-400" />
              <span className="font-semibold text-[var(--text-primary)]">三层混合选股引擎</span>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              L1多因子投票(70%) + L2 XGBoost(20%) + L3风控过滤(10%)
            </p>
          </div>

          {/* 设置选项 */}
          <div className="p-4 space-y-4">
            {/* 选股数量 */}
            <div>
              <label className="text-xs text-[var(--text-secondary)] block mb-1.5">选股数量</label>
              <div className="flex gap-2">
                {[5, 10, 20].map(n => (
                  <button
                    key={n}
                    onClick={() => setSettings(s => ({ ...s, limit: n }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      settings.limit === n 
                        ? 'bg-blue-500 text-white' 
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {n}只
                  </button>
                ))}
              </div>
            </div>

            {/* 市场环境 */}
            <div>
              <label className="text-xs text-[var(--text-secondary)] block mb-1.5">市场环境</label>
              <div className="flex gap-2">
                {[
                  { key: 'bull', label: '🐂 牛市', color: 'red' },
                  { key: 'neutral', label: '📊 震荡', color: 'gray' },
                  { key: 'bear', label: '🐻 熊市', color: 'green' },
                ].map(({ key, label, color }) => (
                  <button
                    key={key}
                    onClick={() => setSettings(s => ({ ...s, marketEnv: key }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      settings.marketEnv === key 
                        ? `bg-${color}-500 text-white` 
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 市场过滤 */}
            <div className="space-y-2">
              <label className="text-xs text-[var(--text-secondary)] block">市场过滤</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.includeKCB}
                  onChange={e => setSettings(s => ({ ...s, includeKCB: e.target.checked }))}
                  className="rounded border-[var(--border-color)] bg-[var(--bg-tertiary)]"
                />
                <span className="text-xs text-[var(--text-secondary)]">包含科创板(688)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.includeBEJ}
                  onChange={e => setSettings(s => ({ ...s, includeBEJ: e.target.checked }))}
                  className="rounded border-[var(--border-color)] bg-[var(--bg-tertiary)]"
                />
                <span className="text-xs text-[var(--text-secondary)]">包含北交所(8xx)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.excludeST}
                  onChange={e => setSettings(s => ({ ...s, excludeST: e.target.checked }))}
                  className="rounded border-[var(--border-color)] bg-[var(--bg-tertiary)]"
                />
                <span className="text-xs text-[var(--text-secondary)]">排除ST股</span>
              </label>
            </div>
          </div>

          {/* 执行按钮 */}
          <div className="p-4 border-t border-[var(--border-light)]">
            <button
              onClick={handleSelect}
              disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              {loading ? 'AI选股中...' : '开始三层选股'}
            </button>
          </div>

          {/* 结果摘要 */}
          {result && (
            <div className="px-4 py-3 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)]">
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="text-[var(--text-secondary)]">选股结果</span>
                <span className="text-green-400 font-medium">{result.finalCount}只通过</span>
              </div>
              
              {/* 三层流程可视化 */}
              <div className="flex items-center gap-2 text-xs mb-3">
                <div className="flex-1 bg-blue-500/20 rounded p-1.5 text-center">
                  <div className="text-blue-400 font-medium">L1</div>
                  <div className="text-[var(--text-secondary)]">{result.layer1Count}只</div>
                </div>
                <span className="text-[var(--text-tertiary)]">→</span>
                <div className="flex-1 bg-purple-500/20 rounded p-1.5 text-center">
                  <div className="text-purple-400 font-medium">L2</div>
                  <div className="text-[var(--text-secondary)]">{result.layer2Count}只</div>
                </div>
                <span className="text-[var(--text-tertiary)]">→</span>
                <div className="flex-1 bg-green-500/20 rounded p-1.5 text-center">
                  <div className="text-green-400 font-medium">L3</div>
                  <div className="text-[var(--text-secondary)]">{result.finalCount}只</div>
                </div>
              </div>
              
              {/* 当前权重 */}
              {result.weights && (
                <div className="text-xs text-[var(--text-tertiary)] mb-3">
                  <span className="text-[var(--text-secondary)]">风格权重:</span>{' '}
                  估<span className="text-blue-400">{result.weights.fValue?.toFixed(0)}</span>
                  {' '}成长<span className="text-purple-400">{result.weights.fGrowth?.toFixed(0)}</span>
                  {' '}质量<span className="text-green-400">{result.weights.fQuality?.toFixed(0)}</span>
                  {' '}动量<span className="text-orange-400">{result.weights.fMomentum?.toFixed(0)}</span>
                </div>
              )}
              
              {/* 选股列表带雷达图 */}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {result.stocks?.slice(0, 5).map((s) => (
                  <div key={s.code} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-secondary)]">
                    <FactorRadar factors={s.factors} size={60} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-[var(--text-primary)]">{s.name}</span>
                        <span className="text-[10px] text-[var(--text-tertiary)]">{s.code}</span>
                        <span className="text-[10px] px-1 rounded bg-green-500/20 text-green-400">{s.score}分</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                        L1:{s.layer1Score} L2:{s.layer2Score} ¥{s.price != null ? Number(s.price).toFixed(2) : '--'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
