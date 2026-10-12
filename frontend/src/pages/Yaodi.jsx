import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { API_BASE } from '../config/api';
import sseClient, { SSE_STATUS, SSE_EVENTS } from '../services/sseClient';
import { formatBJTimeFull } from '../utils/beijingTime';
import {
  Brain, Activity, TrendingUp, Shield, Zap, Layers, Cpu,
  BarChart2, Clock, AlertCircle, Play, Square, RefreshCw,
  ChevronRight, Filter, Target, Gauge, Award, Eye, EyeOff,
  Settings, ArrowRight, Database, CheckCircle, XCircle,
  ChevronUp, ChevronDown, TrendingDown, RefreshCw as SyncIcon,
  Pause, PlayCircle, AlertTriangle, CheckCircle2, XCircle as XCircle2,
  ArrowDownUp, EyeOff as EyeOffIcon, Info, Bell, BellOff,
  SlidersHorizontal, CircleDot, FileSearch, BookOpen, GraduationCap, RotateCw, Save, Sliders, Calculator
} from 'lucide-react';

// ==================== 常量定义 ====================
const POLL_INTERVAL_NORMAL = 30000;   // 正常态 30秒
const POLL_INTERVAL_ALERT  = 5000;    // 变盘态 5秒
const POLL_INTERVAL_CB     = 10000;  // 熔断态 10秒

// 调度模式映射
const SCHEDULER_MODE = {
  NORMAL: 'normal',
  ALERT: 'alert',
  CIRCUIT_BREAK: 'circuit_break',
};

const MODE_CONFIG = {
  [SCHEDULER_MODE.NORMAL]:        { label: '正常态', color: '#3f8600', bg: 'rgba(63,134,0,0.15)',  border: 'rgba(63,134,0,0.4)' },
  [SCHEDULER_MODE.ALERT]:         { label: '变盘态', color: '#d46b08', bg: 'rgba(212,107,8,0.15)',  border: 'rgba(212,107,8,0.4)' },
  [SCHEDULER_MODE.CIRCUIT_BREAK]: { label: '熔断态', color: '#cf1322', bg: 'rgba(207,19,34,0.15)', border: 'rgba(207,19,34,0.4)' },
};

// 五因子定义
const FACTORS = [
  { key: 'value',    label: '价值',    color: '#1677ff' },
  { key: 'size',     label: '市值',    color: '#722ed1' },
  { key: 'momentum', label: '动量',   color: '#d46b08' },
  { key: 'quality',  label: '质量',   color: '#389e0d' },
  { key: 'volatility', label: '波动', color: '#cf1322' },
];

// ==================== 工具函数 ====================

/** 将 snake_case 字段映射为 camelCase（用于兼容后端API） */
function snakeToCamel(obj) {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (!obj || typeof obj !== 'object') return obj;
  const map = {
    l1_total_score: 'l1TotalScore', l2_total_score: 'l2TotalScore',
    value_score: 'valueScore', size_score: 'sizeScore',
    momentum_score: 'momentumScore', quality_score: 'qualityScore', volatility_score: 'volatilityScore',
    composite_score: 'compositeScore', l1_score: 'compositeScore', l2_score: 'l2Score',
    l1_rank: 'l1Rank', l2_rank: 'l2Rank', meta_pred: 'metaScore', metaScore: 'elasticScore',
    sector_code: 'industry',
    win_rate: 'winRate', confidence: 'confidence', direction: 'direction',
    kelly_pct: 'position', stop_loss_pct: 'stopLoss', atr: 'atr',
    signal_status: 'signalStatus', block_reason: 'reason',
    gbdt_score: 'gbdtScore', gbdt_pred: 'gbdtScore',
    histgbdt_score: 'histgbdtScore', histgbdt_pred: 'histgbdtScore',
    catboost_score: 'catboostScore', category_boost: 'catboostScore',
    signal_status: 'signalStatus', signal_action: 'signalAction',
  };
  const result = {};
  for (const k of Object.keys(obj)) result[map[k] ?? k] = snakeToCamel(obj[k]);
  return result;
}


/** 格式化数字，保留 N 位小数 */
const fmt = (v, decimals = 2) => (v == null ? '-' : Number(v).toFixed(decimals));

/** 格式化时间戳为 HH:MM:SS */
const fmtTime = (ts) => {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
};

/** 格式化日期时间 */
const fmtDateTime = (ts) => {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
};

/** 涨跌颜色（A股惯例：涨红跌绿） */
const upDownColor = (v) => {
  if (v == null) return 'var(--text-secondary, #8c8c8c)';
  return Number(v) >= 0 ? '#cf1322' : '#3f8600';
};

/** 涨跌箭头 */
const UpDownArrow = ({ value, showText = true }) => {
  if (value == null) return null;
  const up = Number(value) >= 0;
  return (
    <span style={{ color: upDownColor(value), fontFamily: 'monospace' }}>
      <span style={{ fontSize: 10 }}>{up ? '▲' : '▼'}</span>
      {showText && <span style={{ marginLeft: 2 }}>{fmt(Math.abs(value), 2)}%</span>}
    </span>
  );
};

// ==================== 空状态组件 ====================
const EmptyState = ({ icon: Icon = Info, message = '暂无数据', sub = '' }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '48px 24px', color: 'var(--text-secondary, #8c8c8c)', gap: 12,
  }}>
    <Icon size={36} style={{ opacity: 0.4 }} />
    <div style={{ fontSize: 14 }}>{message}</div>
    {sub && <div style={{ fontSize: 12, opacity: 0.7 }}>{sub}</div>}
  </div>
);

// ==================== 可排序列表头 ====================
const SortableTh = ({ label, field, sortKey, sortDir, onSort, numeric = false }) => (
  <th
    onClick={() => onSort(field)}
    style={{
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      textAlign: numeric ? 'right' : 'left',
      padding: '8px 12px',
      fontSize: 12,
      fontWeight: 600,
      color: sortKey === field ? 'var(--primary, #1677ff)' : 'inherit',
      background: 'var(--bg-secondary, var(--yaodi-bg-card))',
    }}
  >
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {label}
      {sortKey === field
        ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
        : <ArrowDownUp size={10} style={{ opacity: 0.3 }} />}
    </span>
  </th>
);

// ==================== 通用表格组件 ====================
const DataTable = ({ columns, data, sortKey, sortDir, onSort, emptyMessage = '暂无数据', emptySub = '' }) => {
  if (!data || data.length === 0) {
    return <EmptyState message={emptyMessage} sub={emptySub} />;
  }
  return (
    <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--yaodi-separator)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'monospace' }}>
        <thead>
          <tr style={{ background: 'var(--yaodi-bg-card)', borderBottom: '1px solid var(--yaodi-separator)' }}>
            {columns.map(col => (
              <SortableTh
                key={col.key}
                label={col.label}
                field={col.key}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                numeric={col.numeric}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={`${row.code || 'row'}_${idx}`}
              style={{
                borderBottom: '1px solid var(--yaodi-bg-card)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  style={{
                    padding: '8px 12px',
                    textAlign: col.numeric ? 'right' : 'left',
                    color: col.colorFn ? col.colorFn(row[col.key], row) : 'inherit',
                    maxWidth: col.maxWidth || 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ==================== 五因子雷达图 SVG ====================
const FactorRadar = ({ data, size = 220, showLabels = true, compact = false }) => {
  const cx = size / 2, cy = size / 2, r = size * 0.38;
  const n = FACTORS.length;
  const getPoint = (i, radius) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  };
  const labelPt = (i) => getPoint(i, r + (compact ? 14 : 22));

  // 生成多边形顶点
  const pts = FACTORS.map((f, i) => {
    const v = data?.[f.key] ?? 0; // 0~1 范围
    const pr = r * Math.min(Math.max(v, 0), 1);
    const p = getPoint(i, pr);
    return `${p.x},${p.y}`;
  }).join(' ');

  // 背景网格（五边形层）
  const gridRadii = compact ? [0.5, 1.0] : [0.2, 0.4, 0.6, 0.8, 1.0];
  const gridPolygons = gridRadii.map(rf => {
    const pts2 = FACTORS.map((_, i) => {
      const p = getPoint(i, r * rf);
      return `${p.x},${p.y}`;
    }).join(' ');
    return pts2;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', margin: '0 auto' }}>
      {/* 网格 */}
      {gridPolygons.map((pts2, i) => (
        <polygon key={i} points={pts2} fill="none" stroke="var(--yaodi-separator)" strokeWidth="1" />
      ))}
      {/* 轴线 */}
      {FACTORS.map((_, i) => {
        const p = getPoint(i, r);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--yaodi-separator)" strokeWidth="1" />;
      })}
      {/* 数据多边形发光层 */}
      {!compact && <polygon points={pts} fill="rgba(22,119,255,0.15)" stroke="none" strokeWidth="6" strokeLinejoin="round" filter="url(#glow)" />}
      {/* 数据多边形 */}
      <polygon
        points={pts}
        fill="rgba(22,119,255,0.2)"
        stroke={compact ? '#4a9eff' : '#1677ff'}
        strokeWidth={compact ? 1.5 : 2}
        strokeLinejoin="round"
      />
      {/* 数据点 */}
      {FACTORS.map((f, i) => {
        const v = data?.[f.key] ?? 0;
        const pr = r * Math.min(Math.max(v, 0), 1);
        const p = getPoint(i, pr);
        return (
          <circle key={i} cx={p.x} cy={p.y} r={compact ? 3 : 4} fill={f.color} stroke="var(--yaodi-text-secondary, rgba(255,255,255,0.5))" strokeWidth="1.5" />
        );
      })}
      {/* 紧凑模式：中心显示综合分 */}
      {compact && data && (
        <text x={cx} y={cy + 4} textAnchor="middle" fill="var(--yaodi-text-primary, white)" fontSize={Math.max(9, size * 0.08)} fontWeight="700" fontFamily="monospace">
          {fmt(Math.round((FACTORS.reduce((s, f) => s + (data[f.key] ?? 0), 0) / n) * 100))}%
        </text>
      )}
      {/* 标签 */}
      {showLabels && FACTORS.map((f, i) => {
        const lp = labelPt(i);
        const v = data?.[f.key] ?? 0;
        return (
          <text
            key={i}
            x={lp.x}
            y={lp.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={f.color}
            fontSize={compact ? 8 : 11}
            fontWeight="600"
          >
            {f.label}
          </text>
        );
      })}
    </svg>
  );
};

// ==================== 因子分布柱状图 SVG ====================
const FactorBarChart = ({ data }) => {
  const W = 400, H = 180, padL = 40, padR = 16, padT = 16, padB = 36;
  const cw = W - padL - padR, ch = H - padT - padB;
  const n = FACTORS.length;
  const bw = (cw / n) * 0.65, gap = (cw / n) * 0.35;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', maxWidth: 420 }}>
      {/* Y轴网格 */}
      {[0, 0.25, 0.5, 0.75, 1.0].map(pct => {
        const y = padT + ch * (1 - pct);
        return (
          <g key={pct}>
            <line x1={padL} y1={y} x2={padL + cw} y2={y} stroke="var(--yaodi-separator)" strokeWidth="1" />
            <text x={padL - 6} y={y + 4} textAnchor="end" fill="var(--yaodi-text-secondary, rgba(255,255,255,0.4))" fontSize="10">{fmt(pct * 100, 0)}</text>
          </g>
        );
      })}
      {/* X轴基准线 */}
      <line x1={padL} y1={padT + ch} x2={padL + cw} y2={padT + ch} stroke="var(--yaodi-separator)" strokeWidth="1" />
      {/* 柱状图 */}
      {FACTORS.map((f, i) => {
        const v = data?.[f.key] ?? 0;
        const bx = padL + i * (bw + gap) + gap / 2;
        const bh = ch * Math.min(Math.max(v, 0), 1);
        const by = padT + ch - bh;
        return (
          <g key={f.key}>
            <rect x={bx} y={by} width={bw} height={bh} fill={f.color} fillOpacity="0.75" rx="3" />
            <text x={bx + bw / 2} y={padT + ch + 14} textAnchor="middle" fill="var(--yaodi-text-secondary, rgba(255,255,255,0.5))" fontSize="10">{f.label}</text>
            <text x={bx + bw / 2} y={by - 4} textAnchor="middle" fill={f.color} fontSize="10" fontWeight="600">
              {fmt(v * 100, 1)}
            </text>
          </g>
        );
      })}
      <text x={padL - 6} y={padT - 2} textAnchor="end" fill="var(--yaodi-text-secondary, rgba(255,255,255,0.3))" fontSize="10">均值(%)</text>
    </svg>
  );
};

// ==================== 管线漏斗箭头 ====================
const PipelineArrow = ({ label }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0 4px', height: '100%', minHeight: 120 }}>
    <ArrowRight size={20} style={{ color: 'var(--yaodi-separator)' }} />
    {label && <span style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.3))' }}>{label}</span>}
  </div>
);

// ==================== 【P0新增】尧帝三层流程可视化 ====================
const ThreeLayerFlow = ({ l1Count, l2Count, l3Count, avgAccuracy, evolutionVersion, lastUpdate }) => {
  // 漏斗比例
  const maxCount = Math.max(l1Count || 5000, l2Count || 50, l3Count || 10, 1);
  const l1Width = 100;
  const l2Width = Math.max(20, (l2Count / maxCount) * 100);
  const l3Width = Math.max(10, (l3Count / maxCount) * 100);
  
  return (
    <div style={{ 
      background: 'linear-gradient(135deg, rgba(22,119,255,0.08), rgba(114,46,209,0.08))', 
      borderRadius: 12, 
      padding: '16px 20px',
      border: '1px solid rgba(22,119,255,0.2)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Layers size={16} style={{ color: '#1677ff' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1677ff' }}>尧帝V2三层选股流程</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--yaodi-text-secondary)' }}>
          演化版本 v{evolutionVersion || '-'}
        </span>
      </div>
      
      {/* 漏斗可视化 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* L1 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
          <div style={{ 
            width: l1Width, 
            height: 60, 
            background: 'linear-gradient(180deg, rgba(255,215,0,0.3), rgba(255,215,0,0.1))', 
            borderRadius: '8px 8px 40px 40px',
            border: '2px solid rgba(255,215,0,0.5)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            clipPath: 'polygon(0 0, 100% 0, 85% 100%, 15% 100%)'
          }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#ffd700' }}>{l1Count || 0}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,215,0,0.8)' }}>候选</span>
          </div>
          <span style={{ fontSize: 11, color: '#ffd700', marginTop: 6, fontWeight: 600 }}>L1 多维因子共振</span>
          <span style={{ fontSize: 10, color: 'var(--yaodi-text-secondary)' }}>五因子综合评分</span>
        </div>
        
        {/* 箭头1 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <ArrowRight size={20} style={{ color: '#722ed1' }} />
          <span style={{ fontSize: 9, color: 'var(--yaodi-text-secondary)', marginTop: 4 }}>Stacking</span>
        </div>
        
        {/* L2 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
          <div style={{ 
            width: l2Width, 
            height: 50, 
            background: 'linear-gradient(180deg, rgba(114,46,209,0.3), rgba(114,46,209,0.1))', 
            borderRadius: '6px 6px 30px 30px',
            border: '2px solid rgba(114,46,209,0.5)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            transition: 'width 0.5s ease'
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#722ed1' }}>{l2Count || 0}</span>
            <span style={{ fontSize: 10, color: 'rgba(114,46,209,0.8)' }}>精选</span>
          </div>
          <span style={{ fontSize: 11, color: '#722ed1', marginTop: 6, fontWeight: 600 }}>L2 Stacking集成</span>
          <span style={{ fontSize: 10, color: 'var(--yaodi-text-secondary)' }}>三模型融合</span>
        </div>
        
        {/* 箭头2 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <ArrowRight size={20} style={{ color: '#cf1322' }} />
          <span style={{ fontSize: 9, color: 'var(--yaodi-text-secondary)', marginTop: 4 }}>风控</span>
        </div>
        
        {/* L3 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
          <div style={{ 
            width: l3Width, 
            height: 40, 
            background: 'linear-gradient(180deg, rgba(207,19,34,0.3), rgba(207,19,34,0.1))', 
            borderRadius: '4px 4px 20px 20px',
            border: '2px solid rgba(207,19,34,0.5)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            transition: 'width 0.5s ease'
          }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#cf1322' }}>{l3Count || 0}</span>
            <span style={{ fontSize: 10, color: 'rgba(207,19,34,0.8)' }}>信号</span>
          </div>
          <span style={{ fontSize: 11, color: '#cf1322', marginTop: 6, fontWeight: 600 }}>L3 三重风控</span>
          <span style={{ fontSize: 10, color: 'var(--yaodi-text-secondary)' }}>黑天鹅+熔断+仓位</span>
        </div>
      </div>
      
      {/* 底部统计 */}
      <div style={{ 
        display: 'flex', justifyContent: 'space-around', 
        marginTop: 12, paddingTop: 12, 
        borderTop: '1px solid var(--yaodi-separator)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary)' }}>平均准确率</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#3f8600' }}>{avgAccuracy || 0}%</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary)' }}>转化率</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1677ff' }}>
            {l1Count > 0 ? ((l3Count / l1Count) * 100).toFixed(2) : 0}%
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary)' }}>更新时间</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#8c8c8c' }}>
            {lastUpdate ? fmtTime(lastUpdate) : '-'}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== Tab 组件 ====================
const Tabs = ({ tabs, activeTab, onChange }) => (
  <div style={{
    display: 'flex',
    borderBottom: '1px solid var(--yaodi-separator)',
        boxShadow: 'var(--yaodi-shadow-card)',
    gap: 4,
    padding: '0 16px',
    overflowX: 'auto',
  }}>
    {tabs.map(tab => (
      <button
        key={tab.key}
        onClick={() => onChange(tab.key)}
        style={{
          padding: '10px 18px',
          background: 'none',
          border: 'none',
          borderBottom: activeTab === tab.key ? '2px solid #1677ff' : '2px solid transparent',
          color: activeTab === tab.key ? '#1677ff' : 'var(--text-secondary, #8c8c8c)',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'color 0.2s, border-color 0.2s',
        }}
      >
        {tab.icon && <tab.icon size={14} />}
        {tab.label}
        {tab.badge != null && (
          <span style={{
            background: tab.badgeColor || '#1677ff',
            color: '#fff',
            borderRadius: 10,
            fontSize: 11,
            padding: '1px 6px',
            minWidth: 18,
            textAlign: 'center',
          }}>
            {tab.badge}
          </span>
        )}
      </button>
    ))}
  </div>
);

// ==================== 引擎状态卡片 ====================
const StatusCard = ({ title, icon: Icon, children, accent = '#1677ff' }) => (
  <div style={{
    background: 'var(--yaodi-bg-card)',
    border: '1px solid var(--yaodi-separator)',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    flex: 1,
    minWidth: 220,
    maxWidth: 400,
  }} className="yaodi-status-card">
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={15} style={{ color: accent, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--text-secondary, #8c8c8c)', fontWeight: 600 }}>{title}</span>
    </div>
    {children}
  </div>
);

// ==================== 调度模式指示器 ====================
const SchedulerBadge = ({ mode }) => {
  const cfg = MODE_CONFIG[mode] || MODE_CONFIG[SCHEDULER_MODE.NORMAL];
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      color: cfg.color,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: cfg.color,
        animation: mode === SCHEDULER_MODE.CIRCUIT_BREAK ? 'pulse 1.2s infinite' : 'none',
      }} />
      {cfg.label}
    </div>
  );
};

// ==================== 进度条 ====================
const ProgressBar = ({ value, max = 100, color = '#1677ff', label }) => (
  <div style={{ width: '100%' }}>
    {label && (
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>{label}</span>
        <span style={{ color, fontFamily: 'monospace' }}>{fmt(value, 1)}%</span>
      </div>
    )}
    <div style={{ height: 5, background: 'var(--yaodi-separator)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        width: `${Math.min(100, (value / max) * 100)}%`,
        height: '100%',
        background: color,
        borderRadius: 3,
        transition: 'width 0.4s ease',
      }} />
    </div>
  </div>
);

// ==================== L1 候选池表格 ====================
const L1Table = ({ data, sortKey, sortDir, onSort }) => {
  const cols = [
    { key: 'rank', label: '排名', numeric: true, render: v => <span style={{ color: v <= 10 ? '#ffd700' : v <= 30 ? '#1677ff' : 'inherit' }}>{v}</span> },
    { key: 'code', label: '代码', render: v => <span style={{ fontFamily: 'monospace', color: '#1677ff' }}>{v}</span> },
    { key: 'name', label: '名称' },
    { key: 'valueScore',    label: '价值分', numeric: true, render: v => <span style={{ fontFamily: 'monospace', color: '#1677ff' }}>{fmt(v)}</span> },
    { key: 'sizeScore',     label: '市值分', numeric: true, render: v => <span style={{ fontFamily: 'monospace', color: '#722ed1' }}>{fmt(v)}</span> },
    { key: 'momentumScore', label: '动量分', numeric: true, render: (v, r) => <UpDownArrow value={v} /> },
    { key: 'qualityScore',  label: '质量分', numeric: true, render: v => <span style={{ fontFamily: 'monospace', color: '#389e0d' }}>{fmt(v)}</span> },
    { key: 'volatilityScore', label: '波动分', numeric: true, render: v => <span style={{ fontFamily: 'monospace', color: '#cf1322' }}>{fmt(v)}</span> },
    { key: 'compositeScore', label: '综合分', numeric: true, render: v => <span style={{ fontFamily: 'monospace', color: '#ffd700', fontWeight: 700 }}>{fmt(v)}</span> },
    { key: 'industry', label: '板块', render: v => { const m = { SH: '沪市主板', SZ_MAIN: '深市主板', SZ: '深市', GEM: '创业板', SME: '中小板', KCB: '科创板', OTHER: '其他', BJ: '北交所' }; return m[v] || v || '-'; } },
  ];
  return <DataTable columns={cols} data={data} sortKey={sortKey} sortDir={sortDir} onSort={onSort} emptyMessage="L1 候选池暂无数据" />;
};

// ==================== L2 精排表格 ====================
const L2Table = ({ data, sortKey, sortDir, onSort }) => {
  const cols = [
    { key: 'rank', label: '排名', numeric: true, render: v => <span style={{ color: v <= 5 ? '#ffd700' : v <= 20 ? '#1677ff' : 'inherit' }}>{v}</span> },
    { key: 'code', label: '代码', render: v => <span style={{ fontFamily: 'monospace', color: '#1677ff' }}>{v}</span> },
    { key: 'name', label: '名称' },
    { key: 'winRate',    label: '预测胜率', numeric: true, render: v => <span style={{ fontFamily: 'monospace', color: '#3f8600' }}>{v != null ? `${fmt(v * 100, 1)}%` : '-'}</span> },
    { key: 'confidence', label: '置信度',  numeric: true, render: v => <span style={{ fontFamily: 'monospace', color: '#722ed1' }}>{v != null ? `${fmt(v, 1)}%` : '-'}</span> },
    { key: 'direction',  label: '方向',   render: v => (
      <span style={{ color: v === 'long' ? '#cf1322' : v === 'short' ? '#3f8600' : '#8c8c8c', fontWeight: 600 }}>
        {v === 'long' ? '多' : v === 'short' ? '空' : '中立'}
      </span>
    )},
    { key: 'gbdtScore',      label: 'GBDT分',   numeric: true, render: v => <span style={{ fontFamily: 'monospace' }}>{fmt(v)}</span> },
    { key: 'histgbdtScore',  label: 'HistGBDT',  numeric: true, render: v => <span style={{ fontFamily: 'monospace' }}>{fmt(v)}</span> },
    { key: 'catboostScore',  label: 'CatBoost',  numeric: true, render: v => <span style={{ fontFamily: 'monospace' }}>{fmt(v)}</span> },
    { key: 'metaScore',      label: 'ElasticNet', numeric: true, render: v => <span style={{ fontFamily: 'monospace' }}>{fmt(v)}</span> },
  ];
  return <DataTable columns={cols} data={data} sortKey={sortKey} sortDir={sortDir} onSort={onSort} emptyMessage="L2 精排池暂无数据" />;
};

// ==================== L3 最终信号表格 ====================
const L3Table = ({ data, sortKey, sortDir, onSort }) => {
  const cols = [
    { key: 'rank', label: '排名', numeric: true },
    { key: 'code', label: '代码', render: v => <span style={{ fontFamily: 'monospace', color: '#1677ff' }}>{v}</span> },
    { key: 'name', label: '名称' },
    { key: 'signal', label: '信号', render: v => (
      <span style={{
        color: v === 'buy' ? '#cf1322' : v === 'sell' ? '#3f8600' : '#8c8c8c',
        fontWeight: 700,
        textTransform: 'uppercase',
      }}>
        {v === 'buy' ? '买入' : v === 'sell' ? '卖出' : '观望'}
      </span>
    )},
    { key: 'confidence', label: '置信度', numeric: true, render: v => <span style={{ fontFamily: 'monospace' }}>{v != null ? `${fmt(v, 1)}%` : '-'}</span> },
    { key: 'position',   label: '仓位%',  numeric: true, render: v => <span style={{ fontFamily: 'monospace', color: '#1677ff' }}>{fmt(v, 1)}%</span> },
    { key: 'stopLoss',   label: '止损位', numeric: true, render: v => <span style={{ fontFamily: 'monospace', color: '#cf1322' }}>{fmt(v, 2)}</span> },
    { key: 'reason',     label: '决策依据', render: v => <span style={{ fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>{v || '—'}</span> },
  ];
  return <DataTable columns={cols} data={data} sortKey={sortKey} sortDir={sortDir} onSort={onSort} emptyMessage="L3 最终信号暂无数据" />;
};

// ==================== 风控拦截表格 ====================
const RiskLogTable = ({ data }) => {
  const cols = [
    { key: 'code', label: '代码', render: v => <span style={{ fontFamily: 'monospace', color: '#1677ff' }}>{v}</span> },
    { key: 'name', label: '名称' },
    { key: 'severity', label: '级别', render: v => {
      if (!v) return <span style={{ color: '#8c8c8c' }}>—</span>;
      const colors = { RED: '#cf1322', ORANGE: '#d46b08', YELLOW: '#faad14', GREEN: '#389e0d' };
      const labels = { RED: '紧急', ORANGE: '警告', YELLOW: '注意', GREEN: '正常' };
      return <span style={{ color: colors[v] || '#8c8c8c', fontWeight: 600, fontSize: 12 }}>{labels[v] || v}</span>;
    }},
    { key: 'signal', label: '信号类型', render: v => {
      if (!v) return <span style={{ color: '#8c8c8c' }}>—</span>;
      const labels = { stoploss: '止损监控', blackswan: '黑天鹅', barrier: '熔断', position: '仓位风控' };
      return <span style={{ color: '#1677ff', fontWeight: 500, fontSize: 12 }}>{labels[v] || v}</span>;
    }},
    { key: 'reason', label: '详情', render: v => <span style={{ fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))', maxWidth: 200, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v || '—'}</span> },
    { key: 'action', label: '状态', render: v => {
      if (!v || v === 'active') return <span style={{ color: '#faad14' }}>活跃</span>;
      return <span style={{ color: '#389e0d' }}>{v}</span>;
    }},
    { key: 'createdAt', label: '时间', render: v => <span style={{ fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>{v || '—'}</span> },
  ];
  return <DataTable columns={cols} data={data} emptyMessage="暂无风控记录" emptySub="一切正常，风控层未触发预警" />;
};

// ==================== 管线总览 Tab ====================
const PipelineTab = ({ l1Data, l2Data, l3Data, l1Sort, l2Sort, l3Sort, onSortL1, onSortL2, onSortL3, avgAccuracy, evolutionVersion, lastUpdate }) => {
  const [l1Page, setL1Page] = useState(1);
  const [l2Page, setL2Page] = useState(1);
  const [l3Page, setL3Page] = useState(1);
  const PAGE_SIZE = 15;

  const paginate = (arr, page) => arr.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = (arr) => Math.max(1, Math.ceil((arr?.length || 0) / PAGE_SIZE));
  const Paginator = ({ total, page, onPage, onPrev, onNext }) => {
    const [pressed, setPressed] = useState(null); // 'prev' | 'next' | null
    const totalPgs = Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
    const isLoading = (total || 0) === 0; // 数据为空时认为正在加载
    
    const getBtnStyle = (which, disabled) => ({
      ...btnStyle(false, disabled),
      background: disabled ? 'var(--yaodi-bg-card)' : (pressed === which ? 'rgba(22,119,255,0.25)' : 'var(--yaodi-separator)'),
      transform: pressed === which ? 'scale(0.96)' : 'scale(1)',
    });
    
    return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>共 {isLoading ? '...' : (total || 0)} 条</span>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" onClick={() => { console.log('onPrev clicked, page:', page, 'totalPgs:', totalPgs); onPrev && onPrev(); }} disabled={isLoading || page <= 1}
          style={getBtnStyle('prev', isLoading || page <= 1)}
          onMouseDown={() => setPressed('prev')}
          onMouseUp={() => setPressed(null)}
          onMouseLeave={() => setPressed(null)}
        >上页</button>
        <span style={{ padding: '4px 8px', color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>{isLoading ? '-' : page}/{totalPgs}</span>
        <button type="button" onClick={() => { console.log('onNext clicked, page:', page, 'totalPgs:', totalPgs); onNext && onNext(); }} disabled={isLoading || page >= totalPgs}
          style={getBtnStyle('next', isLoading || page >= totalPgs)}
          onMouseDown={() => setPressed('next')}
          onMouseUp={() => setPressed(null)}
          onMouseLeave={() => setPressed(null)}
        >下页</button>
      </div>
    </div>
  );
  };

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 20, minHeight: 0, flex: 1, overflowY: 'auto' }}>
      {/* 【P0新增】三层流程可视化 */}
      <ThreeLayerFlow 
        l1Count={l1Data?.length || 0}
        l2Count={l2Data?.length || 0}
        l3Count={l3Data?.length || 0}
        avgAccuracy={avgAccuracy}
        evolutionVersion={evolutionVersion}
        lastUpdate={lastUpdate}
      />

      {/* 三列管线 — 响应式 grid 布局 */}
      <div className="yaodi-pipeline-grid">
        {/* L1 列 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255,215,0,0.08)', borderRadius: 6, border: '1px solid rgba(255,215,0,0.2)' }}>
            <Cpu size={14} style={{ color: '#ffd700' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#ffd700' }}>L1 候选池</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))', fontFamily: 'monospace' }}>{l1Data?.length || 0} 只</span>
          </div>
          <div style={{ height: 360, overflowY: 'auto', overflowX: 'auto' }}>
            <L1Table data={paginate(l1Data, l1Page)} sortKey={l1Sort.key} sortDir={l1Sort.dir} onSort={onSortL1} />
          </div>
          <Paginator total={l1Data?.length || 0} page={l1Page} onPage={setL1Page} onPrev={() => { console.log('L1 onPrev, l1Page:', l1Page); setL1Page(p => Math.max(1, p - 1)); }} onNext={() => { console.log('L1 onNext, l1Page:', l1Page, 'max:', totalPages(l1Data)); setL1Page(p => Math.min(totalPages(l1Data), p + 1)); }} />
        </div>

        <div className="yaodi-pipeline-arrow"><PipelineArrow label="精排" /></div>

        {/* L2 列 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(114,46,209,0.08)', borderRadius: 6, border: '1px solid rgba(114,46,209,0.2)' }}>
            <Brain size={14} style={{ color: '#722ed1' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#722ed1' }}>L2 精排</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))', fontFamily: 'monospace' }}>{l2Data?.length || 0} 只</span>
          </div>
          <div style={{ height: 360, overflowY: 'auto', overflowX: 'auto' }}>
            <L2Table data={paginate(l2Data, l2Page)} sortKey={l2Sort.key} sortDir={l2Sort.dir} onSort={onSortL2} />
          </div>
          <Paginator total={l2Data?.length || 0} page={l2Page} onPage={setL2Page} onPrev={() => setL2Page(p => Math.max(1, p - 1))} onNext={() => setL2Page(p => Math.min(totalPages(l2Data), p + 1))} />
        </div>

        <div className="yaodi-pipeline-arrow"><PipelineArrow label="风控" /></div>

        {/* L3 列 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(207,19,34,0.08)', borderRadius: 6, border: '1px solid rgba(207,19,34,0.2)' }}>
            <Shield size={14} style={{ color: '#cf1322' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#cf1322' }}>L3 风控信号</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))', fontFamily: 'monospace' }}>{l3Data?.length || 0} 个</span>
          </div>
          <div style={{ height: 360, overflowY: 'auto', overflowX: 'auto' }}>
            <L3Table data={paginate(l3Data, l3Page)} sortKey={l3Sort.key} sortDir={l3Sort.dir} onSort={onSortL3} />
          </div>
          <Paginator total={l3Data?.length || 0} page={l3Page} onPage={setL3Page} onPrev={() => setL3Page(p => Math.max(1, p - 1))} onNext={() => setL3Page(p => Math.min(totalPages(l3Data), p + 1))} />
        </div>
      </div>
    </div>
  );
};

// ==================== 因子分析 Tab ====================
const FactorAnalysisTab = ({ factorStats, l1Data }) => {
  // 从 top300 / l1Data 聚合每因子的 min/max/avg/分布
  const factorDist = useMemo(() => {
    const src = factorStats?.top300 || l1Data || [];
    if (!src.length) return null;
    return FACTORS.map(f => {
      const key = `${f.key}_score`;
      const vals = src.map(s => s[key] ?? s[`${f.key}Score`] ?? 0).filter(v => v > 0);
      const min = vals.length ? Math.min(...vals) : 0;
      const max = vals.length ? Math.max(...vals) : 0;
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const isFixed = min === max;
      // 10 分箱直方图
      const bins = 10;
      const binW = max > min ? (max - min) / bins : 1;
      const histogram = Array(bins).fill(0);
      vals.forEach(v => {
        const idx = max > min ? Math.min(Math.floor((v - min) / binW), bins - 1) : 0;
        histogram[idx]++;
      });
      const maxBin = Math.max(...histogram, 1);
      const sorted = [...vals].sort((a, b) => a - b);
      const p25 = sorted[Math.floor(sorted.length * 0.25)] ?? min;
      const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? max;
      return { ...f, min, max, avg, isFixed, histogram, maxBin, count: vals.length, p25, p75 };
    });
  }, [factorStats, l1Data]);

  // 雷达图数据 (0~1)
  const radarData = useMemo(() => {
    if (!factorDist) return null;
    const d = {};
    factorDist.forEach(f => { d[f.key] = f.avg / 100; });
    return d;
  }, [factorDist]);

  if (!factorDist) {
    return <EmptyState icon={BarChart2} message="因子统计数据暂无" sub="等待 L1 扫描完成后自动加载" />;
  }

  // ---- 子组件: 单因子分布卡片 ----
  const FactorCard = ({ f }) => {
    const spread = f.max - f.min;
    const meanPct = spread > 0 ? (f.avg - f.min) / spread : 0.5;
    return (
      <div style={{
        padding: '14px 16px', borderRadius: 10,
        background: 'var(--yaodi-bg-card)',
        border: `1px solid ${f.color}22`,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {/* 头部: 名称 + 数值 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: f.color }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--yaodi-text-primary, rgba(255,255,255,0.85))' }}>{f.label}</span>
            {f.isFixed && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--yaodi-inset)', color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.35))' }}>固定值</span>
            )}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: f.color }}>
            {fmt(f.avg, 1)}
          </div>
        </div>

        {/* 区间条: min—max 背景 + mean 标记 */}
        <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--yaodi-inset)' }}>
          <div style={{
            position: 'absolute', left: `${(f.min / 100) * 100}%`, right: `${(1 - f.max / 100) * 100}%`,
            height: '100%', borderRadius: 3, background: `${f.color}25`,
          }} />
          <div style={{
            position: 'absolute', left: `${meanPct * 100}%`, top: -3,
            width: 12, height: 12, borderRadius: '50%',
            background: f.color, border: '2px solid var(--yaodi-bg-card)',
            transform: 'translateX(-50%)', boxShadow: `0 0 6px ${f.color}66`,
          }} />
        </div>

        {/* 密度直方图 (迷你柱状图) */}
        {!f.isFixed && f.histogram && (
          <svg width="100%" height={28} viewBox="0 0 200 28" preserveAspectRatio="none">
            {f.histogram.map((count, i) => (
              <rect
                key={i}
                x={(i / f.histogram.length) * 200}
                y={28 - (count / f.maxBin) * 24}
                width={200 / f.histogram.length - 1}
                height={(count / f.maxBin) * 24}
                fill={f.color}
                opacity={0.25 + (count / f.maxBin) * 0.35}
                rx={1}
              />
            ))}
          </svg>
        )}

        {/* 底部 min / P25 / P75 / max */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'monospace', color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.35))' }}>
          <span>{fmt(f.min, 1)}</span>
          <span style={{ color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>P25 {fmt(f.p25, 1)}</span>
          <span style={{ color: f.color, fontWeight: 600 }}>avg {fmt(f.avg, 1)}</span>
          <span style={{ color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>P75 {fmt(f.p75, 1)}</span>
          <span>{fmt(f.max, 1)}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 20 }} className="yaodi-factor-grid">
      {/* 左列: 雷达图 + 候选池统计 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)',
          border: '1px solid var(--yaodi-separator)', padding: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))', letterSpacing: 1 }}>FACTOR RADAR</div>
          <FactorRadar data={radarData} size={230} />
        </div>
        <div style={{
          background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)',
          border: '1px solid var(--yaodi-separator)', padding: '14px 16px',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        }}>
          <MiniStat label="候选池" value={factorDist[0]?.count || 0} icon={Layers} color="#1677ff" />
          <MiniStat label="有效因子" value={factorDist.filter(f => !f.isFixed).length + '/5'} icon={BarChart2} color="#3f8600" />
        </div>
      </div>

      {/* 右列: 五因子分布卡片 */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr', gap: 10,
      }}>
        {factorDist.map(f => <FactorCard key={f.key} f={f} />)}
      </div>
    </div>
  );
};

// ==================== 风控日志 Tab ====================
const RiskLogTab = ({ riskLogs }) => (
  <div style={{ padding: 16 }}>
    <RiskLogTable data={riskLogs || []} />
  </div>
);

// ==================== 学习系统 Tab ====================
const LearningTab = ({ status, onEvaluate, onUpdateRewards, onRetrain }) => {
  if (!status) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>
        <GraduationCap size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
        <div>加载学习系统状态...</div>
      </div>
    );
  }

  const weights = status.factorWeights || {};
  const perf = status.factorPerformance || {};
  const versions = status.modelVersions || [];

  // 因子权重条颜色映射
  const factorColors = {
    value: '#1677ff', quality: '#389e0d', growth: '#d46b08',
    momentum: '#cf1322', size: '#722ed1', volatility: '#eb2f96',
  };
  const factorLabels = {
    value: '价值', quality: '质量', growth: '成长',
    momentum: '动量', size: '市值', volatility: '波动',
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 概览卡片 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
      }}>
        <MiniStat label="累计信号" value={status.totalSignals} icon={Target} color="#13c2c2" />
        <MiniStat label="收益已回填" value={status.totalRewardUpdated} icon={CheckCircle} color="#3f8600" />
        <MiniStat label="有效样本" value={status.sampleCount} icon={Database} color="#1677ff" />
        <MiniStat label="模型版本" value={versions.length} icon={Save} color="#722ed1" />
      </div>

      {/* 因子动态权重 */}
      <div style={{
        background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <SlidersHorizontal size={15} style={{ color: '#13c2c2' }} />
          因子动态权重（增量学习自动调整）
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(weights).map(([key, weight]) => {
            const pct = Math.min(100, ((weight || 0) / 3) * 100); // max 3.0 → 100%
            const ic = perf[key]?.ic;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, width: 36, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))', textAlign: 'right' }}>
                  {factorLabels[key] || key}
                </span>
                <div style={{ flex: 1, height: 18, background: 'var(--yaodi-separator)', borderRadius: 9, overflow: 'hidden' }}>
                  <div style={{
                    width: `${pct}%`, height: '100%', borderRadius: 9,
                    background: `linear-gradient(90deg, ${factorColors[key] || '#666'}, ${factorColors[key] || '#666'}88)`,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
                <span style={{ fontSize: 12, fontFamily: 'monospace', width: 40, color: factorColors[key] || '#999' }}>
                  {weight != null ? Number(weight).toFixed(2) : '--'}
                </span>
                {ic != null && (
                  <span style={{
                    fontSize: 10, fontFamily: 'monospace', width: 60, textAlign: 'right',
                    color: ic > 0.02 ? '#3f8600' : ic < -0.02 ? '#cf1322' : '#8c8c8c',
                  }}>
                    IC: {ic > 0 ? '+' : ''}{ic != null ? Number(ic).toFixed(4) : '--'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {status.lastAdjusted && (
          <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))', marginTop: 8, fontFamily: 'monospace' }}>
            上次调整: {new Date(status.lastAdjusted).toLocaleString('zh-CN')}
          </div>
        )}
      </div>

      {/* 因子有效性评估详情 */}
      {perf && Object.keys(perf).length > 0 && (
        <div style={{
          background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart2 size={15} style={{ color: '#d46b08' }} />
            因子有效性评估
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(Object.keys(perf).length, 3)}, 1fr)`, gap: 10 }}>
            {Object.entries(perf).map(([key, p]) => (
              <div key={key} style={{
                padding: 12, borderRadius: 8, background: 'var(--yaodi-bg-card)',
                border: `1px solid ${p.ic > 0.02 ? 'rgba(63,134,0,0.3)' : p.ic < -0.02 ? 'rgba(207,19,34,0.3)' : 'var(--yaodi-separator)'}`,
              }}>
                <div style={{ fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>{factorLabels[key] || key}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', marginTop: 4,
                  color: p.ic > 0.02 ? '#3f8600' : p.ic < -0.02 ? '#cf1322' : '#8c8c8c' }}>
                  {p.ic > 0 ? '+' : ''}{Number(p.ic * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))', fontFamily: 'monospace', marginTop: 2 }}>
                  样本: {p.count || 0}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 模型版本历史 */}
      {versions.length > 0 && (
        <div style={{
          background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Save size={15} style={{ color: '#722ed1' }} />
            模型版本历史
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {versions.map((v, i) => (
              <div key={v.tag} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px', borderRadius: 6, background: i === 0 ? 'rgba(114,46,209,0.12)' : 'transparent',
                fontSize: 12, fontFamily: 'monospace',
              }}>
                <span style={{ color: i === 0 ? '#722ed1' : 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>
                  {i === 0 ? '● ' : '  '}{v.tag}
                  {i === 0 && <span style={{ marginLeft: 6, fontSize: 10, color: '#722ed1' }}>[当前]</span>}
                </span>
                <span style={{ color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>{new Date(v.timestamp).toLocaleString('zh-CN')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div style={{
        display: 'flex', gap: 12, flexWrap: 'wrap',
        background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 16,
      }}>
        <ActionBtn icon={BarChart2} label="评估因子" color="#13c2c2"
          onClick={onEvaluate} desc="评估因子IC并调整权重" />
        <ActionBtn icon={RotateCw} label="回填收益" color="#1677ff"
          onClick={onUpdateRewards} desc="查询信号N日后收益" />
        <ActionBtn icon={PlayCircle} label="重训模型" color="#d46b08"
          onClick={onRetrain} desc="重置并重新训练L2" />
      </div>

      {/* 学习原理说明 */}
      <div style={{
        fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))', lineHeight: 1.6,
        padding: 12, borderRadius: 8, background: 'rgba(19,194,194,0.05)', border: '1px solid rgba(19,194,194,0.15)',
      }}>
        <BookOpen size={12} style={{ verticalAlign: 'middle', marginRight: 4, color: '#13c2c2' }} />
        <strong style={{ color: '#13c2c2' }}>增量学习闭环</strong>：每次L3产出信号后自动记录 → 定期回填N日收益 → 评估因子IC → 动态调整L1因子权重 → 模型准确率过低时自动重训L2。
        无需人工干预，系统持续进化。
      </div>
    </div>
  );
};

/** 迷你统计卡片 */
const MiniStat = ({ label, value, icon: Icon, color }) => (
  <div style={{
    padding: 14, borderRadius: 10, background: 'var(--yaodi-bg-card)',
    border: '1px solid var(--yaodi-separator)', display: 'flex', flexDirection: 'column', gap: 4,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>
      <Icon size={12} style={{ color }} />
      {label}
    </div>
    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color }}>{value}</div>
  </div>
);

/** 操作按钮 */
const ActionBtn = ({ icon: Icon, label, color, onClick, desc }) => (
  <button onClick={onClick} style={{
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
    borderRadius: 8, border: `1px solid ${color}44`, background: `${color}11`,
    color, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.2s',
  }}>
    <Icon size={15} />
    <div>
      <div>{label}</div>
      <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>{desc}</div>
    </div>
  </button>
);

// ==================== 引擎控制 Tab ====================
const EngineControlTab = ({ params, onParamChange, onTriggerL1, onSetMode, currentMode, isLoading }) => {
  const modes = [
    { value: SCHEDULER_MODE.NORMAL,        label: '正常态', icon: Activity, color: '#3f8600', desc: '30秒轮询，轻量扫描' },
    { value: SCHEDULER_MODE.ALERT,          label: '变盘态', icon: AlertTriangle, color: '#d46b08', desc: '5秒轮询，深度扫描' },
    { value: SCHEDULER_MODE.CIRCUIT_BREAK,  label: '熔断态', icon: Shield, color: '#cf1322', desc: '熔断保护，停止开仓' },
  ];

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 手动触发 */}
      <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={15} style={{ color: '#ffd700' }} />
          手动控制
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onTriggerL1}
            disabled={isLoading}
            style={{
              ...btnStyle(true, isLoading),
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(22,119,255,0.15)',
              border: '1px solid rgba(22,119,255,0.4)',
              color: '#1677ff',
            }}
          >
            {isLoading ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
            {isLoading ? '触发中...' : '手动触发 L1 批处理'}
          </button>
        </div>
      </div>

      {/* 调度模式 */}
      <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Settings size={15} style={{ color: '#722ed1' }} />
          调度模式
          <span style={{ marginLeft: 8, fontSize: 11, color: '#d46b08', background: 'rgba(212,107,8,0.12)', padding: '2px 8px', borderRadius: 6, fontWeight: 400 }}>
            尧帝自适应
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {modes.map(m => (
            <div
              key={m.value}
              style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: currentMode === m.value ? `${m.color}18` : 'var(--yaodi-bg-card)',
                border: `1px solid ${currentMode === m.value ? m.color : 'var(--yaodi-separator)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <m.icon size={15} style={{ color: m.color }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: currentMode === m.value ? m.color : 'var(--yaodi-text-primary, rgba(255,255,255,0.7))' }}>{m.label}</span>
                {currentMode === m.value && <span style={{ fontSize: 10, color: m.color, marginLeft: 4 }}>当前</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>{m.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 参数配置 */}
      <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <SlidersHorizontal size={15} style={{ color: '#389e0d' }} />
          参数配置
          <span style={{ marginLeft: 8, fontSize: 11, color: '#389e0d', background: 'rgba(56,158,13,0.12)', padding: '2px 8px', borderRadius: 6, fontWeight: 400 }}>
            尧帝智能调参
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {[
            { key: 'l1TopN',        label: 'L1 TopN',        suffix: '只',   desc: 'L1候选池容量' },
            { key: 'l2TopN',        label: 'L2 TopN',        suffix: '只',   desc: 'L2精排池容量' },
            { key: 'kellyCap',      label: '凯利上限',         suffix: 'x',   desc: '单笔最大仓位比例' },
            { key: 'industryCap',   label: '行业集中度上限',   suffix: '%',   desc: '单一行业最大权重' },
            { key: 'atrMultiplier', label: 'ATR倍数',          suffix: 'x',   desc: '止损ATR系数' },
            { key: 'minConfidence', label: '最低置信度',        suffix: '',   desc: 'L3信号最低置信要求' },
          ].map(p => (
            <div key={p.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))', fontWeight: 500 }}>{p.label}</label>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 18, color: '#1677ff', fontWeight: 700 }}>
                  {params[p.key] ?? p.min ?? '—'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.3))' }}>{p.suffix}{p.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ==================== 版本管理Tab ====================
const VersionManageTab = () => {
  const [versionHistory, setVersionHistory] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchVersionHistory();
    fetchCurrentVersion();
  }, []);

  const fetchCurrentVersion = async () => {
    try {
      const res = await fetch(`${API_BASE}/yaodi?lightweight=1`);
      const data = await res.json();
      if (data.main?.main_version) {
        setCurrentVersion(data.main.main_version);
      }
    } catch (e) {
      console.error('获取当前版本失败:', e);
    }
  };

  const fetchVersionHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/yaodi/version-history`);
      const data = await res.json();
      if (data.success) {
        setVersionHistory(data.versions || []);
      }
    } catch (e) {
      console.error('获取版本历史失败:', e);
    }
  };

  const handleUpgrade = async () => {
    if (!confirm('确定要升级尧帝到最新版本吗？')) return;
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/yaodi/version-upgrade`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: data.message || '升级成功' });
        fetchVersionHistory();
        fetchCurrentVersion();
      } else {
        setMessage({ type: 'error', text: data.error || '升级失败' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    }
    setIsLoading(false);
  };

  const handleRollback = async (version) => {
    if (!confirm(`确定要回滚到版本 ${version} 吗？`)) return;
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/yaodi/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: data.message || '回滚成功' });
        fetchVersionHistory();
        fetchCurrentVersion();
      } else {
        setMessage({ type: 'error', text: data.error || '回滚失败' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    }
    setIsLoading(false);
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RotateCw size={20} style={{ color: '#13c2c2' }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>版本管理</span>
          <span style={{ fontSize: 12, background: 'rgba(19,194,194,0.15)', color: '#13c2c2', padding: '2px 8px', borderRadius: 6 }}>
            当前 v{currentVersion}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={fetchVersionHistory}
            style={{ ...btnStyle(false, false), display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} /> 刷新
          </button>
          <button
            onClick={handleUpgrade}
            disabled={isLoading}
            style={{ ...btnStyle(true, isLoading), display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <ArrowRight size={14} /> 升级版本
          </button>
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div style={{
          padding: 12,
          borderRadius: 8,
          background: message.type === 'success' ? 'rgba(82,196,26,0.1)' : 'rgba(255,77,79,0.1)',
          border: `1px solid ${message.type === 'success' ? 'rgba(82,196,26,0.3)' : 'rgba(255,77,79,0.3)'}`,
          color: message.type === 'success' ? '#52c41a' : '#ff4d4f',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      {/* 版本历史 */}
      <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--yaodi-separator)', fontWeight: 600, fontSize: 14 }}>
          版本历史
        </div>
        {versionHistory.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.45))' }}>暂无版本历史</div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {versionHistory.map((v, idx) => (
              <div key={idx} style={{
                padding: '12px 16px',
                borderBottom: idx < versionHistory.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: v.version === currentVersion ? 'rgba(19,194,194,0.15)' : 'rgba(255,255,255,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: 12,
                    color: v.version === currentVersion ? '#13c2c2' : 'var(--yaodi-text-primary, rgba(255,255,255,0.65))'
                  }}>
                    v{v.version}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, color: 'var(--yaodi-text-primary, rgba(255,255,255,0.85))' }}>{v.changes || '系统更新'}</div>
                    <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.45))', marginTop: 2 }}>
                      {formatBJTimeFull(v.created_at)}
                    </div>
                  </div>
                </div>
                {v.version !== currentVersion && (
                  <button
                    onClick={() => handleRollback(v.version)}
                    disabled={isLoading}
                    style={{
                      padding: '4px 12px',
                      background: 'transparent',
                      border: '1px solid rgba(255,77,79,0.5)',
                      color: '#ff4d4f',
                      borderRadius: 6,
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      opacity: isLoading ? 0.5 : 1
                    }}
                  >
                    回滚
                  </button>
                )}
                {v.version === currentVersion && (
                  <span style={{ fontSize: 12, color: '#52c41a', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle size={12} /> 当前
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== 运行日志Tab ====================
const LogsTab = () => {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/yaodi/logs?limit=100`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
      }
    } catch (e) {
      console.error('获取日志失败:', e);
    }
    setIsLoading(false);
  };

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  const getLevelColor = (level) => {
    switch (level) {
      case 'error': return '#ff4d4f';
      case 'warn': return '#faad14';
      case 'info': return '#1677ff';
      default: return '#8c8c8c';
    }
  };

  const getLevelBg = (level) => {
    switch (level) {
      case 'error': return 'rgba(255,77,79,0.15)';
      case 'warn': return 'rgba(250,173,20,0.15)';
      case 'info': return 'rgba(22,119,255,0.15)';
      default: return 'rgba(140,140,140,0.15)';
    }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FileSearch size={20} style={{ color: '#722ed1' }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>运行日志</span>
          <span style={{ fontSize: 12, background: 'rgba(114,46,209,0.15)', color: '#722ed1', padding: '2px 8px', borderRadius: 6 }}>
            {logs.length} 条
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--yaodi-text-secondary, rgba(255,255,255,0.15))',
              background: 'var(--yaodi-bg-card)',
              color: 'var(--yaodi-text-primary, rgba(255,255,255,0.85))',
              fontSize: 13
            }}
          >
            <option value="all">全部</option>
            <option value="error">错误</option>
            <option value="warn">警告</option>
            <option value="info">信息</option>
          </select>
          <button
            onClick={fetchLogs}
            disabled={isLoading}
            style={{ ...btnStyle(false, isLoading), display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
            {isLoading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      <div style={{
        background: 'var(--yaodi-bg-card)',
        borderRadius: 12,
        border: '1px solid var(--yaodi-separator)',
        maxHeight: 500,
        overflowY: 'auto'
      }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.45))' }}>加载中...</div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.45))' }}>暂无日志</div>
        ) : (
          filteredLogs.map((log, idx) => (
            <div key={idx} style={{
              padding: '10px 16px',
              borderBottom: idx < filteredLogs.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              fontFamily: 'monospace',
              fontSize: 12
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{
                  color: getLevelColor(log.level),
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  minWidth: 50,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: getLevelBg(log.level),
                  fontSize: 10
                }}>
                  {log.level}
                </span>
                <span style={{ color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.45))' }}>{log.timestamp}</span>
              </div>
              <div style={{ marginTop: 4, color: 'var(--yaodi-text-primary, rgba(255,255,255,0.85))', paddingLeft: 60 }}>{log.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ==================== 动态仓位Tab ====================
const DynamicPositionTab = ({ yaodiData }) => {
  const [params, setParams] = useState({
    accuracy: yaodiData?.main?.accuracy ?? null,
    winRate: yaodiData?.main?.win_rate ?? null,
    macro: 0,
    riskLevel: 'moderate'
  });
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const calcPosition = async () => {
    setIsLoading(true);
    try {
      const query = new URLSearchParams({
        accuracy: params.accuracy,
        winRate: params.winRate,
        macro: params.macro,
        riskLevel: params.riskLevel
      }).toString();
      const res = await fetch('http://localhost:8769/api/risk/dynamic-position?' + query);
      const data = await res.json();
      if (data.success) setResult(data.data);
    } catch (e) {
      console.error('计算动态仓位失败:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { calcPosition(); }, []);

  const riskLevels = [
    { key: 'conservative', label: '保守', color: '#52c41a' },
    { key: 'moderate', label: '均衡', color: '#1890ff' },
    { key: 'aggressive', label: '激进', color: '#ff4d4f' }
  ];

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Shield size={20} style={{ color: '#52c41a' }} />
        <span style={{ fontSize: 16, fontWeight: 600 }}>动态仓位计算器</span>
        <span style={{ fontSize: 11, color: 'var(--yaodi-text-secondary)', background: 'var(--yaodi-inset)', padding: '2px 8px', borderRadius: 4 }}>风控层核心</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 左侧：参数输入 */}
        <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sliders size={16} />
            输入参数
          </div>

          {/* 准确率 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 13, color: 'var(--yaodi-text-secondary)' }}>尧帝准确率 (%)</label>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{params.accuracy}</span>
            </div>
            <input type="range" min="50" max="100" value={params.accuracy} onChange={e => setParams({ ...params, accuracy: parseInt(e.target.value) })} style={{ width: '100%', accentColor: '#1890ff' }} />
          </div>

          {/* 胜率 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 13, color: 'var(--yaodi-text-secondary)' }}>回测胜率 (%)</label>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{params.winRate}</span>
            </div>
            <input type="range" min="50" max="100" value={params.winRate} onChange={e => setParams({ ...params, winRate: parseInt(e.target.value) })} style={{ width: '100%', accentColor: '#52c41a' }} />
          </div>

          {/* 宏观评分 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 13, color: 'var(--yaodi-text-secondary)' }}>宏观评分 (-5 ~ +5)</label>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{params.macro > 0 ? '+' : ''}{params.macro}</span>
            </div>
            <input type="range" min="-5" max="5" value={params.macro} onChange={e => setParams({ ...params, macro: parseInt(e.target.value) })} style={{ width: '100%', accentColor: params.macro >= 0 ? '#52c41a' : '#ff4d4f' }} />
          </div>

          {/* 风险等级 */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, color: 'var(--yaodi-text-secondary)', display: 'block', marginBottom: 8 }}>风险等级</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {riskLevels.map(r => (
                <button key={r.key} onClick={() => setParams({ ...params, riskLevel: r.key })} style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8,
                  border: params.riskLevel === r.key ? '2px solid ' + r.color : '1px solid var(--yaodi-separator)',
                  background: params.riskLevel === r.key ? r.color + '20' : 'var(--yaodi-inset)',
                  color: params.riskLevel === r.key ? r.color : 'var(--yaodi-text-secondary)',
                  fontSize: 13, fontWeight: params.riskLevel === r.key ? 600 : 400, cursor: 'pointer'
                }}>{r.label}</button>
              ))}
            </div>
          </div>

          {/* 计算按钮 */}
          <button onClick={calcPosition} disabled={isLoading} style={{
            width: '100%', padding: '10px 16px', borderRadius: 8, border: 'none',
            background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)', color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
          }}>
            <Calculator size={16} />
            {isLoading ? '计算中...' : '计算建议仓位'}
          </button>
        </div>

        {/* 右侧：计算结果 */}
        <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Target size={16} />
            计算结果
          </div>

          {result ? (
            <>
              {/* 建议仓位 */}
              <div style={{ background: 'linear-gradient(135deg, rgba(82,196,26,0.15) 0%, rgba(82,196,26,0.05) 100%)', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid rgba(82,196,26,0.3)' }}>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', marginBottom: 4 }}>建议仓位</div>
                <div style={{ fontSize: 36, fontWeight: 700, color: '#52c41a' }}>{result.positionPct}<span style={{ fontSize: 18, marginLeft: 2 }}>%</span></div>
                <div style={{ fontSize: 11, color: 'var(--yaodi-text-secondary)', marginTop: 8 }}>{result._formula}</div>
              </div>

              {/* 因子系数 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', marginBottom: 8 }}>因子系数</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { label: '准确率因子', value: result.accuracyFactor, color: result.accuracyFactor > 1 ? '#52c41a' : '#ff4d4f' },
                    { label: '胜率因子', value: result.winRateFactor, color: result.winRateFactor > 1 ? '#52c41a' : '#ff4d4f' },
                    { label: '宏观因子', value: result.macroFactor, color: result.macroFactor > 1 ? '#52c41a' : result.macroFactor < 1 ? '#ff4d4f' : '#8c8c8c' },
                    { label: '波动因子', value: result.volFactor, color: result.volFactor > 1 ? '#ff4d4f' : '#52c41a' }
                  ].map((item, i) => (
                    <div key={i} style={{ background: 'var(--yaodi-inset)', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>{item.label}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: item.color }}>{Number(item.value).toFixed(2)}x</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 原因说明 */}
              <div>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', marginBottom: 8 }}>计算原因</div>
                <div style={{ background: 'var(--yaodi-inset)', borderRadius: 8, padding: 12 }}>
                  {result.reasons?.map((r, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', marginBottom: i < result.reasons.length - 1 ? 4 : 0 }}>• {r}</div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--yaodi-text-secondary)' }}>
              <Target size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
              <div>点击"计算建议仓位"查看结果</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== 压力测试Tab ====================
const StressTestTab = () => {
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const btnStyle = (primary, disabled) => ({
    background: disabled ? 'var(--yaodi-inset)' : primary ? '#1890ff' : 'var(--yaodi-bg-secondary)',
    color: disabled ? 'var(--yaodi-text-secondary)' : primary ? '#fff' : 'var(--yaodi-text-primary)',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1
  });

  const runTest = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('http://localhost:8769/api/risk/stress-test');
      const data = await res.json();
      if (data.success) setResult(data.data);
    } catch (e) {
      console.error('压力测试失败:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AlertTriangle size={20} style={{ color: '#fa8c16' }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>压力测试</span>
          <span style={{ fontSize: 11, color: 'var(--yaodi-text-secondary)', background: 'var(--yaodi-inset)', padding: '2px 8px', borderRadius: 4 }}>风控层核心</span>
        </div>
        <button onClick={runTest} disabled={isLoading} style={{ ...btnStyle(false, isLoading), display: 'flex', alignItems: 'center', gap: 6 }}>
          <Play size={14} />
          {isLoading ? '测试中...' : '运行测试'}
        </button>
      </div>

      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 汇总卡片 */}
          <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={18} style={{ color: '#fa8c16' }} />
              组合压力测试结果
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>总体风险</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: result.portfolio?.overallRisk?.includes('高') ? '#fa8c16' : '#52c41a' }}>{result.portfolio?.overallRisk || '未知'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>最坏损失</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#f5222d' }}>{result.portfolio?.worstCase?.toLocaleString?.() || '-'} 元</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>平均损失</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#fa8c16' }}>{result.portfolio?.avgCase?.toLocaleString?.() || '-'} 元</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>建议操作</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{result.portfolio?.recommendation || '-'}</div>
              </div>
            </div>
          </div>

          {/* 场景卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {(result.scenarios || []).map((s, idx) => (
              <div key={idx} style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{s.label || s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>持续天数: {s.days}天</div>
                  <div>总影响: <span style={{ color: '#f5222d' }}>{Number(s.totalImpact * 100).toFixed(1)}%</span></div>
                  <div>波动放大: ×{s.volMultiplier}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 持仓明细 */}
          {(result.positions || []).length > 0 && (
            <details style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, border: '1px solid var(--yaodi-separator)' }}>
              <summary style={{ padding: 16, cursor: 'pointer', fontWeight: 600 }}>持仓压力明细 ({result.positions.length}只)</summary>
              <div style={{ padding: '0 16px 16px', maxHeight: 300, overflow: 'auto' }}>
                {result.positions.map((p, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--yaodi-separator)' }}>
                    <span style={{ fontWeight: 500 }}>{p.code}</span>
                    <span style={{ color: 'var(--yaodi-text-secondary)' }}>{p.name}</span>
                    <span style={{ fontSize: 12, background: p.riskRating === '危险' ? '#f5222d' : '#fa8c16', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>{p.riskRating}</span>
                    <span style={{ marginLeft: 'auto', color: '#f5222d' }}>最坏: {p.worstCase?.toLocaleString?.()}元</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--yaodi-text-secondary)', background: 'var(--yaodi-bg-card)', borderRadius: 12 }}>
          <AlertTriangle size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <div>点击"运行测试"模拟极端市场场景</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>测试持仓在股灾/熔断/闪崩等场景下的最大回撤</div>
        </div>
      )}
    </div>
  );
};

// ==================== TWAP拆单Tab ====================
const SmartExecuteTab = () => {
  const [params, setParams] = useState({ code: '', direction: 'buy', totalQty: 1000, totalBudget: 50000 });
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const inputStyle = {
    background: 'var(--yaodi-bg-secondary)',
    border: '1px solid var(--yaodi-border)',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--yaodi-text-primary)',
    outline: 'none'
  };

  const btnStyle = (primary, disabled) => ({
    background: disabled ? 'var(--yaodi-inset)' : primary ? '#1890ff' : 'var(--yaodi-bg-secondary)',
    color: disabled ? 'var(--yaodi-text-secondary)' : primary ? '#fff' : 'var(--yaodi-text-primary)',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1
  });

  const execute = async () => {
    if (!params.code) return;
    setIsLoading(true);
    try {
      const res = await fetch('http://localhost:8769/api/shundi/smart-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      const data = await res.json();
      if (data.success) setResult(data.data);
    } catch (e) {
      console.error('拆单失败:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Zap size={20} style={{ color: '#1890ff' }} />
        <span style={{ fontSize: 16, fontWeight: 600 }}>TWAP智能拆单</span>
        <span style={{ fontSize: 11, color: 'var(--yaodi-text-secondary)', background: 'var(--yaodi-inset)', padding: '2px 8px', borderRadius: 4 }}>执行层核心</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 参数输入 */}
        <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sliders size={16} />
            拆单参数
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', display: 'block', marginBottom: 4 }}>股票代码</label>
            <input value={params.code} onChange={e => setParams({ ...params, code: e.target.value })} placeholder="如: 000001" style={{ ...inputStyle, width: '100%' }} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', display: 'block', marginBottom: 4 }}>方向</label>
            <select value={params.direction} onChange={e => setParams({ ...params, direction: e.target.value })} style={{ ...inputStyle, width: '100%' }}>
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', display: 'block', marginBottom: 4 }}>总数量（股）</label>
            <input type="number" value={params.totalQty} onChange={e => setParams({ ...params, totalQty: parseInt(e.target.value) || 0 })} style={{ ...inputStyle, width: '100%' }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', display: 'block', marginBottom: 4 }}>预算金额（元）</label>
            <input type="number" value={params.totalBudget} onChange={e => setParams({ ...params, totalBudget: parseFloat(e.target.value) || 0 })} style={{ ...inputStyle, width: '100%' }} />
          </div>

          <button onClick={execute} disabled={isLoading || !params.code} style={{ ...btnStyle(false, isLoading || !params.code), width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Zap size={14} />
            {isLoading ? '计算中...' : '生成拆单方案'}
          </button>
        </div>

        {/* 结果展示 */}
        <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Target size={16} />
            拆单方案
          </div>

          {result ? (
            <>
              <div style={{ background: 'linear-gradient(135deg, rgba(24,144,255,0.15) 0%, rgba(24,144,255,0.05) 100%)', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid rgba(24,144,255,0.3)' }}>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', marginBottom: 4 }}>拆单策略</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#1890ff' }}>{result.strategy || 'TWAP'}</div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', marginBottom: 8 }}>预估冲击成本</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: result.impactPct > 1 ? '#ff4d4f' : '#52c41a' }}>{Number(result.impactPct || 0).toFixed(3)}%</div>
              </div>

              {result.slices && result.slices.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)', marginBottom: 8 }}>分批明细</div>
                  <div style={{ maxHeight: 200, overflow: 'auto' }}>
                    {result.slices.map((s, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--yaodi-separator)', fontSize: 12 }}>
                        <span style={{ color: 'var(--yaodi-text-secondary)' }}>第{i+1}批</span>
                        <span>{s.qty}股 @ {s.time || `${s.start}-${s.end}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--yaodi-text-secondary)' }}>
              <Zap size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
              <div>输入参数后点击"生成拆单方案"</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== 研报核验Tab ====================
const ResearchVerifyTab = () => {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [matchedName, setMatchedName] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const inputStyle = {
    background: 'var(--yaodi-bg-secondary)',
    border: '1px solid var(--yaodi-border)',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--yaodi-text-primary)',
    outline: 'none'
  };

  const btnStyle = (primary, disabled) => ({
    background: disabled ? 'var(--yaodi-inset)' : primary ? '#1890ff' : 'var(--yaodi-bg-secondary)',
    color: disabled ? 'var(--yaodi-text-secondary)' : primary ? '#fff' : 'var(--yaodi-text-primary)',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1
  });

  // 输入代码时自动匹配股票名称
  const handleCodeChange = async (value) => {
    setCode(value);
    setMatchedName('');
    if (value.length >= 4) {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/stock/${value}`);
        const data = await res.json();
        // API返回结构: {success: true, name: "平安银行", ...} - name在顶层
        if (data.success && data.name) {
          setMatchedName(data.name);
        }
      } catch (e) {
        // 忽略错误，继续输入
      } finally {
        setIsSearching(false);
      }
    }
  };

  const verify = async () => {
    if (!code) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/stock/research-verify?code=${code}&_t=${Date.now()}`);
      const data = await res.json();
      console.log('[研报核验] API原始响应:', JSON.stringify(data).substring(0, 500));
      if (data.success) {
        console.log('[研报核验] data.data:', JSON.stringify(data.data).substring(0, 300));
        console.log('[研报核验] _researchLogic:', data.data._researchLogic ? JSON.stringify(data.data._researchLogic).substring(0, 200) : 'MISSING');
        setResult(data.data);
      }
    } catch (e) {
      console.error('核验失败:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FileSearch size={20} style={{ color: '#13c2c2' }} />
        <span style={{ fontSize: 16, fontWeight: 600 }}>研报级个股核验</span>
        <span style={{ fontSize: 11, color: 'var(--yaodi-text-secondary)', background: 'var(--yaodi-inset)', padding: '2px 8px', borderRadius: 4 }}>逻辑层核心</span>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input value={code} onChange={e => handleCodeChange(e.target.value)} placeholder="输入股票代码 (如: 000001)" style={{ ...inputStyle, width: '100%' }} />
          {matchedName && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--yaodi-bg-card)', border: '1px solid var(--yaodi-separator)', borderRadius: 8, padding: '8px 12px', marginTop: 4, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle size={12} style={{ color: '#52c41a' }} />
              <span style={{ color: 'var(--yaodi-text-primary)', fontWeight: 500 }}>{matchedName}</span>
              <span style={{ color: 'var(--yaodi-text-secondary)', marginLeft: 'auto' }}>{code}</span>
            </div>
          )}
          {isSearching && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--yaodi-bg-card)', border: '1px solid var(--yaodi-separator)', borderRadius: 8, padding: '8px 12px', marginTop: 4, fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>
              匹配中...
            </div>
          )}
        </div>
        <button onClick={verify} disabled={isLoading || !code} style={{ ...btnStyle(false, isLoading || !code), display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileSearch size={14} />
          {isLoading ? '核验中...' : '核验'}
        </button>
      </div>

      {result ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* 基本信息 */}
          <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{result.name || result.code}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>代码:</span> <span style={{ fontSize: 12 }}>{result.code}</span></div>
              <div><span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>现价:</span> <span style={{ fontSize: 12 }}>{result.price}</span></div>
              <div><span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>涨跌:</span> <span style={{ fontSize: 12, color: result.chg > 0 ? '#52c41a' : result.chg < 0 ? '#ff4d4f' : 'inherit' }}>{result.chg}%</span></div>
              <div><span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>成交量:</span> <span style={{ fontSize: 12 }}>{result.volume}</span></div>
              {/* 行业归属 */}
              {result._researchLogic?.matchedChain && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>行业归属:</span>{' '}
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#13c2c2', background: 'rgba(19,194,194,0.1)', padding: '2px 8px', borderRadius: 4, marginLeft: 4 }}>
                    {result._researchLogic.matchedChain}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 研报逻辑核验结果 */}
          <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={16} style={{ color: result._researchLogic?.passed ? '#52c41a' : '#ff4d4f' }} />
              核验结果: {result._researchLogic?.passed ? '通过' : '未通过'}
              {result._researchLogic?.level && (
                <span style={{ marginLeft: 'auto', fontSize: 12, padding: '2px 8px', borderRadius: 6, background: result._researchLogic.level === 'A' ? 'rgba(82,196,26,0.15)' : result._researchLogic.level === 'B' ? 'rgba(250,173,20,0.15)' : 'rgba(255,77,79,0.15)', color: result._researchLogic.level === 'A' ? '#52c41a' : result._researchLogic.level === 'B' ? '#faad14' : '#ff4d4f' }}>
                  {result._researchLogic.level}级
                </span>
              )}
              {result._researchLogic?.score !== undefined && (
                <span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>评分: {result._researchLogic.score}分</span>
              )}
            </div>
            {/* 核验项 */}
            {result._researchLogic?.checks && Array.isArray(result._researchLogic.checks) && result._researchLogic.checks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {result._researchLogic.checks.map((check, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--yaodi-inset)', borderRadius: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary)' }}>{check.item}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: check.pass ? '#52c41a' : '#ff4d4f' }}>{check.pass ? '✓' : '✗'} {check.result}</span>
                  </div>
                ))}
              </div>
            )}
            {/* 核验理由 */}
            {result._researchLogic?.findings && Array.isArray(result._researchLogic.findings) && result._researchLogic.findings.length > 0 && (
              <div style={{ borderTop: '1px solid var(--yaodi-separator)', paddingTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--yaodi-text-secondary)' }}>核验理由</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {result._researchLogic.findings.map((finding, idx) => (
                    <div key={idx} style={{ fontSize: 12, color: finding.startsWith('✅') ? '#52c41a' : finding.startsWith('⚠️') ? '#faad14' : finding.startsWith('❌') ? '#ff4d4f' : 'var(--yaodi-text-primary)', padding: '6px 10px', background: 'var(--yaodi-inset)', borderRadius: 6 }}>
                      {finding}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--yaodi-text-secondary)', background: 'var(--yaodi-bg-card)', borderRadius: 12 }}>
          <FileSearch size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <div>输入股票代码进行研报级核验</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>检查ROE、PE、营收增长等核心指标是否符合投资标准</div>
        </div>
      )}
    </div>
  );
};

// ==================== 尧帝大脑Tab ====================
const BrainStatusTab = ({ brainData, threats, onRefresh, isLoading }) => {
  const modules = brainData?.modules || {};
  const moduleList = Object.entries(modules).map(([key, m]) => ({ key, ...m }));
  const overallScore = brainData?.overallScore || 0;
  const status = brainData?.status || 'unknown';

  const getHealthColor = (health) => {
    if (health >= 80) return '#52c41a';
    if (health >= 50) return '#faad14';
    return '#ff4d4f';
  };

  const getStatusLabel = (s) => {
    if (s === 'online') return { text: '在线', color: '#52c41a' };
    if (s === 'offline') return { text: '离线', color: '#ff4d4f' };
    if (s === 'unknown') return { text: '未知', color: '#8c8c8c' };
    return { text: s, color: '#8c8c8c' };
  };

  const criticalModules = moduleList.filter(m => m.criticalLevel === 'critical');
  const highModules = moduleList.filter(m => m.criticalLevel === 'high');
  const otherModules = moduleList.filter(m => !['critical', 'high'].includes(m.criticalLevel));

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Brain size={20} style={{ color: '#722ed1' }} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>尧帝大脑 - 系统感知中心</span>
          <span style={{ fontSize: 12, background: status === 'operational' ? 'rgba(82,196,26,0.15)' : 'rgba(255,77,79,0.15)', color: status === 'operational' ? '#52c41a' : '#ff4d4f', padding: '2px 8px', borderRadius: 6 }}>
            {status === 'operational' ? '运行正常' : '异常'}
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          style={{ ...btnStyle(false, isLoading), display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
          {isLoading ? '刷新中...' : '刷新感知'}
        </button>
      </div>

      {/* 健康度总览 */}
      <div style={{ background: 'var(--yaodi-bg-card)', borderRadius: 12, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>系统健康度</span>
          <span style={{ fontSize: 28, fontWeight: 700, color: getHealthColor(overallScore) }}>{overallScore}<span style={{ fontSize: 14, marginLeft: 2 }}>分</span></span>
        </div>
        <div style={{ height: 8, background: 'var(--yaodi-separator)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${overallScore}%`, height: '100%', background: getHealthColor(overallScore), borderRadius: 4, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* 威胁警报 */}
      {threats && threats.length > 0 && (
        <div style={{ background: 'rgba(255,77,79,0.08)', borderRadius: 12, border: '1px solid rgba(255,77,79,0.3)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <AlertTriangle size={16} style={{ color: '#ff4d4f' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#ff4d4f' }}>检测到 {threats.length} 个威胁</span>
          </div>
          {threats.slice(0, 5).map((t, i) => {
            const threatLabels = {
              service_down: '服务离线',
              service_degraded: '服务异常',
              accuracy_drop: '准确率下降',
              data_empty: '数据为空',
              datasource_error: '数据源故障',
              memory_leak: '内存泄漏',
              timeout: '响应超时',
            };
            const label = threatLabels[t.type] || t.type;
            return (
              <div key={i} style={{ fontSize: 12, color: 'var(--yaodi-text-secondary, var(--yaodi-text-primary, rgba(255,255,255,0.7)))', marginBottom: 4, paddingLeft: 24 }}>
                • {label}{t.message && t.message !== label ? `：${t.message}` : ''}
              </div>
            );
          })}
        </div>
      )}

      {/* 核心模块（Critical） */}
      {criticalModules.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d4f' }} />
            核心模块
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {criticalModules.map(m => (
              <div key={m.key} style={{ background: 'var(--yaodi-bg-card)', borderRadius: 10, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</span>
                  <span style={{ fontSize: 10, ...getStatusLabel(m.status) }}>{getStatusLabel(m.status).text}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: 'var(--yaodi-separator)', borderRadius: 2 }}>
                    <div style={{ width: `${m.health}%`, height: '100%', background: getHealthColor(m.health), borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: getHealthColor(m.health) }}>{m.health}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 重要模块（High） */}
      {highModules.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#faad14' }} />
            重要模块
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {highModules.map(m => (
              <div key={m.key} style={{ background: 'var(--yaodi-bg-card)', borderRadius: 10, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-separator)', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</span>
                  <span style={{ fontSize: 10, ...getStatusLabel(m.status) }}>{getStatusLabel(m.status).text}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: 'var(--yaodi-separator)', borderRadius: 2 }}>
                    <div style={{ width: `${m.health}%`, height: '100%', background: getHealthColor(m.health), borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: getHealthColor(m.health) }}>{m.health}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 其他模块 */}
      {otherModules.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8c8c8c' }} />
            其他模块
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {otherModules.map(m => (
              <div key={m.key} style={{ background: 'var(--yaodi-bg-card)', borderRadius: 8, boxShadow: 'var(--yaodi-shadow-card)', border: '1px solid var(--yaodi-inset)', padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--yaodi-text-primary, rgba(255,255,255,0.7))' }}>{m.name}</span>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: getHealthColor(m.health) }}>{m.health}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 更新时间 */}
      {brainData?.lastUpdate && (
        <div style={{ fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.3))', textAlign: 'right' }}>
          最后更新: {brainData.lastUpdate}
        </div>
      )}
    </div>
  );
};

// ==================== 按钮样式工厂 ====================
const btnStyle = (primary, disabled) => ({
  padding: primary ? '8px 16px' : '6px 12px',
  borderRadius: 6,
  border: primary ? '1px solid rgba(22,119,255,0.5)' : '1px solid var(--yaodi-inset, rgba(255,255,255,0.12))',
  background: disabled ? 'var(--yaodi-bg-card)' : (primary ? 'rgba(22,119,255,0.1)' : 'var(--yaodi-separator)'),
  color: disabled ? 'var(--yaodi-text-secondary, rgba(255,255,255,0.3))' : (primary ? '#1677ff' : 'var(--yaodi-text-primary, rgba(255,255,255,0.7))'),
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 12,
  fontWeight: 500,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  transition: 'all 0.15s ease',
  fontFamily: 'inherit',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  // 点击反馈：通过 JS onMouseDown/onMouseUp 模拟 active 状态
});

// ==================== 主组件 ====================
const Yaodi = () => {
  // --- 状态 ---
  const [activeTab, setActiveTab] = useState('pipeline');
  const [engineStatus, setEngineStatus] = useState(null);
  const [l1Data, setL1Data] = useState([]);
  const [l2Data, setL2Data] = useState([]);
  const [l3Data, setL3Data] = useState([]);
  const [riskLogs, setRiskLogs] = useState([]);
  const [factorStats, setFactorStats] = useState(null);
  const [learningStatus, setLearningStatus] = useState(null);
  const [brainData, setBrainData] = useState(null);
  const [threats, setThreats] = useState([]);
  const [yaodiData, setYaodiData] = useState(null);
  const [isLoadingBrain, setIsLoadingBrain] = useState(false);

  // 排序状态
  const [l1Sort, setL1Sort] = useState({ key: 'rank', dir: 'asc' });
  const [l2Sort, setL2Sort] = useState({ key: 'rank', dir: 'asc' });
  const [l3Sort, setL3Sort] = useState({ key: 'rank', dir: 'asc' });

  // 控制状态
  const [isTriggering, setIsTriggering] = useState(false);
  const [currentMode, setCurrentMode] = useState(SCHEDULER_MODE.NORMAL);
  const [params, setParams] = useState({
    l1TopN: 300, l2TopN: 50, kellyCap: 0.25, industryCap: 25, atrMultiplier: 2.0, minConfidence: 0.6,
  });

  // 底部状态栏
  const [lastUpdate, setLastUpdate] = useState(null);
  const [l2LastRunTime, setL2LastRunTime] = useState(null);
  const [l2ScanCount, setL2ScanCount] = useState(0);
  const [dataHealth, setDataHealth] = useState('ok'); // ok | warning | error

  const pollTimerRef = useRef(null);

  // --- API 封装 ---
  const apiGet = useCallback(async (path) => {
    try {
      const normalizedPath = path.startsWith('/api') ? path.slice(4) : path;
      const res = await fetch(`${API_BASE}${normalizedPath}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[Yaodi] API ${path} 失败:`, err.message);
      return null;
    }
  }, []);

  const apiPost = useCallback(async (path, body) => {
    try {
      const normalizedPath = path.startsWith('/api') ? path.slice(4) : path;
      const res = await fetch(`${API_BASE}${normalizedPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[Yaodi] API POST ${path} 失败:`, err.message);
      return null;
    }
  }, []);

  // --- 数据拉取 ---
  const fetchAll = useCallback(async () => {
    // 【P2优化】聚合API优先，减少请求次数
    // 大数据(l1/l2/l3/factors)一并拉取
    const [comprehensive, l1Res, l2Res, l3Res, learningRes, statusRes] = await Promise.all([
      apiGet('/api/yaodi/comprehensive'),
      apiGet('/api/yaodi-v2/l1-pool'),
      apiGet('/api/yaodi-v2/l2-pool'),
      apiGet('/api/yaodi-v2/l3-signals'),
      apiGet('/api/yaodi-v2/learning-status'),
      apiGet('/api/yaodi-v2/status'),
    ]);

    if (comprehensive?.success) {
      setYaodiData(comprehensive);
      setEngineStatus({ 
        running: comprehensive.health?.evolution === 'online', 
        schedulerMode: SCHEDULER_MODE.NORMAL, 
        dataHealth: 'ok',
        avgAccuracy: comprehensive.stats?.avgAccuracy || comprehensive.evolution?.accuracy || null,
        evolutionVersion: comprehensive.evolution?.generation || comprehensive.stats?.mainVersion || null,
        l1LastRunTime: statusRes?.success ? statusRes.l1LastRunTime : null,
      });
      if (statusRes?.success) {
        setL2LastRunTime(statusRes.l2LastRunTime || null);
        setL2ScanCount(statusRes.l2ScanCount || 0);
      }
      if (comprehensive.learning) setLearningStatus(comprehensive.learning);
      if (learningRes?.success) setLearningStatus(learningRes);
      if (comprehensive.riskLog?.length) setRiskLogs(snakeToCamel(comprehensive.riskLog));
    }

    if (l1Res?.top300) {
      const raw = snakeToCamel(l1Res.top300);
      const sorted = [...raw].sort((a,b) => (b.compositeScore||0)-(a.compositeScore||0));
      sorted.forEach((item,i)=>{item.rank=i+1;});
      setL1Data(sorted);
    }
    if (l2Res?.top50) {
      const l2Raw = snakeToCamel(l2Res.top50);
      const l2Sorted = [...l2Raw].sort((a,b) => (b.l2Score||0)-(a.l2Score||0));
      l2Sorted.forEach((item,i)=>{item.rank=i+1;});
      setL2Data(l2Sorted);
    }
    if (l3Res?.signals) {
      const l3Raw = snakeToCamel(l3Res.signals);
      const l3Sorted = [...l3Raw].sort((a,b) => (b.confidence||0)-(a.confidence||0));
      l3Sorted.forEach((item,i)=>{item.rank=i+1;});
      setL3Data(l3Sorted);
    }

    setLastUpdate(Date.now());
  }, [apiGet]);

  // --- 按需加载L1/L2/L3池数据 ---
  const fetchPoolData = useCallback(async (poolType) => {
    const endpoint = {
      'l1': '/api/yaodi-v2/l1-pool',
      'l2': '/api/yaodi-v2/l2-pool',
      'l3': '/api/yaodi-v2/l3-signals',
      'factors': '/api/yaodi-v2/factor-stats',
    }[poolType];
    if (!endpoint) return;
    const data = await apiGet(endpoint);
    if (poolType === 'l1' && data) {
      const raw = snakeToCamel(data.top300 || data.data || data.items || data || []);
      const sorted = [...raw].sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
      sorted.forEach((item, i) => { item.rank = i + 1; });
      setL1Data(sorted);
    } else if (poolType === 'l2' && data) {
      const l2Raw = snakeToCamel(data.top50 || data.data || data.items || data || []);
      const l2Sorted = [...l2Raw].sort((a, b) => (b.l2Score || 0) - (a.l2Score || 0));
      l2Sorted.forEach((item, i) => { item.rank = i + 1; });
      setL2Data(l2Sorted);
    } else if (poolType === 'l3' && data) {
      const l3Raw = snakeToCamel(data.signals || data.data || data.items || data || []);
      const l3Sorted = [...l3Raw].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      l3Sorted.forEach((item, i) => { item.rank = i + 1; });
      setL3Data(l3Sorted);
    } else if (poolType === 'factors' && data) {
      setFactorStats(data);
    }
  }, [apiGet]);

  // 【P2新增】Tab切换时按需加载数据（factors Tab需要l1Data）
  useEffect(() => {
    if (activeTab === 'factors' && l1Data.length === 0) {
      fetchPoolData('l1');
    } else if (activeTab === 'factors' && !factorStats) {
      fetchPoolData('factors');
    }
  }, [activeTab, l1Data.length, factorStats, fetchPoolData]);

  // 获取尧帝大脑数据
  const fetchBrain = useCallback(async () => {
    setIsLoadingBrain(true);
    try {
      const [health, threatsData] = await Promise.all([
        apiGet('/api/yaodi/brain/health'),
        apiGet('/api/yaodi/brain/threats'),
      ]);
      if (health?.success) setBrainData(health.health);
      if (threatsData?.success) setThreats(threatsData.threats || []);
    } catch (e) {
      console.error('获取尧帝大脑数据失败:', e);
    }
    setIsLoadingBrain(false);
  }, [apiGet]);

  // --- 轮询策略 ---
  const startPoll = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    const interval = currentMode === SCHEDULER_MODE.ALERT
      ? POLL_INTERVAL_ALERT
      : currentMode === SCHEDULER_MODE.CIRCUIT_BREAK
        ? POLL_INTERVAL_CB
        : POLL_INTERVAL_NORMAL;
    pollTimerRef.current = setInterval(fetchAll, interval);
  }, [currentMode, fetchAll]);

  useEffect(() => {
    fetchAll();
    startPoll();
    // 【P1优化】启动SSE实时推送（使用connectIfNeeded保持全局连接）
    sseClient.connectIfNeeded();
    const unsubSignal = sseClient.subscribe(SSE_EVENTS.YAODI_SIGNAL, (data) => {
      console.log('[SSE] 新尧帝信号:', data);
      // 实时刷新数据
      fetchAll();
    });
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      // 只取消订阅，不断开连接（保持全局SSE连接）
      if (unsubSignal) unsubSignal();
    };
  }, [fetchAll, startPoll]);

  // 获取尧帝大脑数据（切换到brain Tab时刷新）
  useEffect(() => {
    if (activeTab === 'brain') {
      fetchBrain();
    }
  }, [activeTab, fetchBrain]);

  // --- 手动触发 L1 ---
  const handleTriggerL1 = useCallback(async () => {
    setIsTriggering(true);
    await apiPost('/api/yaodi-v2/trigger-l1', {});
    setTimeout(() => setIsTriggering(false), 2000);
    fetchAll();
  }, [apiPost, fetchAll]);

  // --- 切换调度模式 ---
  const handleSetMode = useCallback(async (mode) => {
    const res = await apiPost('/api/yaodi-v2/set-scheduler', { mode });
    if (res !== null) {
      setCurrentMode(mode);
      startPoll(); // 重启轮询
    }
  }, [apiPost, startPoll]);

  // --- 学习系统操作 ---
  const handleLearningEvaluate = useCallback(async () => {
    const res = await apiPost('/api/yaodi-v2/learning/evaluate', {});
    if (res?.success) fetchAll();
  }, [apiPost, fetchAll]);

  const handleLearningUpdateRewards = useCallback(async () => {
    const res = await apiPost('/api/yaodi-v2/learning/update-rewards', {});
    if (res?.success) fetchAll();
  }, [apiPost, fetchAll]);

  const handleLearningRetrain = useCallback(async () => {
    const res = await apiPost('/api/yaodi-v2/learning/retrain', {});
    if (res?.success) fetchAll();
  }, [apiPost, fetchAll]);

  // --- 参数变更（前端仅展示，参数由尧帝智能控制，禁止操作） ---
  const handleParamChange = useCallback(() => {}, []);

  // --- 表格排序 ---
  const handleSort = useCallback((setter, key) => {
    setter(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const sortedL1 = useMemo(() => {
    if (!l1Data?.length) return [];
    return [...l1Data].sort((a, b) => {
      const va = a[l1Sort.key] ?? -Infinity;
      const vb = b[l1Sort.key] ?? -Infinity;
      return l1Sort.dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }, [l1Data, l1Sort]);

  const sortedL2 = useMemo(() => {
    if (!l2Data?.length) return [];
    return [...l2Data].sort((a, b) => {
      const va = a[l2Sort.key] ?? -Infinity;
      const vb = b[l2Sort.key] ?? -Infinity;
      return l2Sort.dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }, [l2Data, l2Sort]);

  const sortedL3 = useMemo(() => {
    if (!l3Data?.length) return [];
    return [...l3Data].sort((a, b) => {
      const va = a[l3Sort.key] ?? -Infinity;
      const vb = b[l3Sort.key] ?? -Infinity;
      return l3Sort.dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }, [l3Data, l3Sort]);

  // --- 聚合因子均值（用于状态卡片） ---
  const avgFactors = useMemo(() => {
    if (!l1Data?.length) return null;
    const result = {};
    FACTORS.forEach(f => {
      const vals = l1Data.map(item => item[`${f.key}Score`] ?? item[`${f.key}_score`] ?? 0);
      result[f.key] = vals.reduce((a, b) => a + b, 0) / vals.length / 100; // 0-100 → 0-1
    });
    return result;
  }, [l1Data]);

  // --- Tab 配置 ---
  const tabs = [
    { key: 'pipeline',  label: '管线总览',  icon: Layers },
    { key: 'factors',   label: '因子分析',  icon: BarChart2, badge: l1Data?.length > 0 ? l1Data.length : null, badgeColor: '#ffd700' },
    { key: 'risklog',   label: '风控日志',  icon: Shield,    badge: riskLogs?.length || null, badgeColor: '#cf1322' },
    { key: 'learning',  label: '学习系统',  icon: GraduationCap, badge: learningStatus?.totalSignals > 0 ? learningStatus.totalSignals : null, badgeColor: '#13c2c2' },
    { key: 'brain',     label: '系统状态',  icon: Brain,    badge: brainData?.overallScore ? `${brainData.overallScore}分` : null, badgeColor: brainData?.overallScore >= 70 ? '#52c41a' : brainData?.overallScore >= 50 ? '#faad14' : '#ff4d4f' },
    { key: 'position',  label: '动态仓位',  icon: Shield },
    { key: 'stress',    label: '压力测试',  icon: AlertTriangle },
    { key: 'twap',      label: 'TWAP拆单',  icon: Zap },
    { key: 'research',  label: '研报核验',  icon: FileSearch },
    { key: 'version',   label: '版本管理',  icon: RotateCw },
    { key: 'logs',      label: '运行日志',  icon: FileSearch },
    { key: 'control',   label: '引擎控制',  icon: Settings },
  ];

  // --- 状态卡片数据计算 ---
  const l1Stats = useMemo(() => {
    if (!l1Data?.length) return null;
    const total = l1Data.length;
    const avgComposite = l1Data.reduce((s, i) => s + (i.l1TotalScore || i.compositeScore || 0), 0) / total;
    return { total, avgComposite, top10: l1Data.slice(0, 10) };
  }, [l1Data]);

  const l2Stats = useMemo(() => {
    if (!l2Data?.length) return null;
    const total = l2Data.length;
    const avgWinRate = l2Data.reduce((s, i) => s + (i.winRate != null ? i.winRate : 0), 0) / total;
    const avgConfidence = l2Data.reduce((s, i) => s + (i.confidence || 0), 0) / total;
    const avgGbdtScore = l2Data.reduce((s, i) => s + (i.gbdtScore || i.gbdt_pred || 0), 0) / total;
    const avgHistScore = l2Data.reduce((s, i) => s + (i.histgbdtScore || i.histgbdt_pred || 0), 0) / total;
    const avgCatScore = l2Data.reduce((s, i) => s + (i.catboostScore || i.category_boost || 0), 0) / total;
    const l1Scores = l2Data.map(i => i.l1Score || i.l1_score || 0);
    const l2Scores = l2Data.map(i => i.l2Score || i.l2_score || 0);
    const scoreMin = Math.min(...l2Scores);
    const scoreMax = Math.max(...l2Scores);
    const l2ScoreRange = `${fmt(scoreMin * 100, 1)}~${fmt(scoreMax * 100, 1)}%`;
    return {
      total,
      avgWinRate,
      avgConfidence,
      avgGbdtScore,
      avgHistScore,
      avgCatScore,
      l2ScoreRange,
    };
  }, [l2Data]);

  const l3Stats = useMemo(() => {
    if (!l3Data?.length) return null;
    const signals = l3Data;
    const passed = signals.length;
    // 拦截数：优先从引擎状态取（更准确），否则回退风控日志长度
    const blocked = engineStatus?.l3BlockedCount ?? (riskLogs?.length || 0);
    // Kelly仓位分布
    // 注意：l3Data 已经过 snakeToCamel 转换，kelly_pct→position, win_rate→winRate, atr→atr
    const kellyVals = signals.map(s => s.position || s.kelly_pct || 0).filter(v => v > 0);
    const avgKelly = kellyVals.length ? kellyVals.reduce((a, b) => a + b, 0) / kellyVals.length : 0;
    // 预期胜率（win_rate → winRate，由后端动态注入，0.5 为未确认真实值时的兜底）
    const winVals = signals.map(s => s.winRate ?? s.win_rate ?? 0).filter(v => v != null && v > 0);
    const avgWinRate = winVals.length ? winVals.reduce((a, b) => a + b, 0) / winVals.length : 0;
    // ATR
    const atrVals = signals.map(s => s.atr || 0).filter(v => v > 0);
    const avgAtr = atrVals.length ? atrVals.reduce((a, b) => a + b, 0) / atrVals.length : 0;
    // Kelly分段统计（用于显示分布）
    const kellyHigh = signals.filter(s => (s.position || s.kelly_pct || 0) > 6).length;
    const kellyMid = signals.filter(s => {
      const k = s.position || s.kelly_pct || 0; return k > 3 && k <= 6;
    }).length;
    const kellyLow = signals.filter(s => (s.position || s.kelly_pct || 0) <= 3).length;
    return { passed, blocked, avgKelly, avgWinRate, avgAtr, kellyHigh, kellyMid, kellyLow };
  }, [l3Data, riskLogs, engineStatus]);

  // ==================== 渲染 ====================
  return (
    <div style={{
      height: '100vh',
      overflow: 'auto',
      background: 'var(--ac-bgDeepest, #07090f)',
      color: 'var(--text-primary, #e6edf3)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 全局 keyframes & 响应式样式 */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        
        /* 尧帝大脑响应式布局 */
        .yaodi-pipeline-grid {
          display: grid;
          grid-template-columns: minmax(280px, 1fr) 36px minmax(260px, 1fr) 36px minmax(240px, 1fr);
          gap: 0;
          align-items: start;
          width: 100%;
          min-width: 0;
        }
        
        @media (max-width: 1400px) {
          .yaodi-pipeline-grid {
            grid-template-columns: minmax(260px, 1fr) 32px minmax(240px, 1fr) 32px minmax(220px, 1fr);
          }
        }
        
        @media (max-width: 1100px) {
          .yaodi-pipeline-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
          .yaodi-pipeline-arrow {
            display: none;
          }
        }
        
        .yaodi-factor-grid {
          display: grid;
          grid-template-columns: 260px 1fr;
          gap: 20px;
          align-items: start;
          min-width: 0;
        }
        
        @media (max-width: 900px) {
          .yaodi-factor-grid {
            grid-template-columns: 1fr;
          }
        }
        
        /* 表格响应式滚动 */
        .yaodi-table-container {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        
        /* 卡片弹性布局 */
        .yaodi-status-cards {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }
        
        .yaodi-status-card {
          flex: 1;
          min-width: 200px;
        }
      `}</style>

      {/* 顶部标题栏 */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--yaodi-separator)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--yaodi-bg-card)',
      }}>
        <Brain size={22} style={{ color: '#722ed1' }} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
            <span style={{ color: '#722ed1' }}>尧帝</span>
            <span style={{ color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))', fontWeight: 400 }}> 2.0 核心大脑</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))', marginTop: 2 }}>
            Yaodi V2 · 三层量化管线 · 实时决策引擎
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <SchedulerBadge mode={currentMode} />
          <button
            onClick={fetchAll}
            style={{ ...btnStyle(false, false), padding: '6px 10px' }}
            title="刷新数据"
          >
            <RefreshCw size={13} style={{ animation: lastUpdate ? 'spin 1s ease' : 'none' }} />
          </button>
        </div>
      </div>

      {/* 状态卡片区域 */}
      <div style={{ padding: '16px 24px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* 调度模式卡片 */}
        <StatusCard title="调度模式" icon={Activity} accent="#3f8600">
          <SchedulerBadge mode={currentMode} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>L1上次运行</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--yaodi-text-primary, rgba(255,255,255,0.7))' }}>
                {engineStatus?.l1LastRunTime ? fmtDateTime(engineStatus.l1LastRunTime) : '-'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>轮询间隔</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#ffd700' }}>
                {(() => {
                  const interval = engineStatus?.schedulerMode?.interval || (currentMode === SCHEDULER_MODE.ALERT ? 30000 : currentMode === SCHEDULER_MODE.CIRCUIT_BREAK ? 10000 : 300000);
                  if (interval >= 60000) return `${Math.round(interval / 60000)}分钟`;
                  return `${interval / 1000}秒`;
                })()}
              </div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--yaodi-text-primary, rgba(255,255,255,0.7))' }}>
                {engineStatus?.schedulerMode?.label || '正常态'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>L2最后刷新</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#1677ff' }}>
                {l2LastRunTime ? fmtDateTime(l2LastRunTime) : '-'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>L2累计次数</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#1677ff' }}>{l2ScanCount}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))' }}>数据健康度</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: dataHealth === 'ok' ? '#3f8600' : dataHealth === 'warning' ? '#d46b08' : '#cf1322' }}>
                {dataHealth === 'ok' ? '正常' : dataHealth === 'warning' ? '警告' : '异常'}
              </div>
            </div>
          </div>
        </StatusCard>

        {/* L1 候选池卡片 — 左：五因子条形图 | 右：雷达图 */}
        <StatusCard title="L1 候选池" icon={Cpu} accent="#ffd700">
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {/* 左侧：股票数 + 综合分 + 五因子条形 */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 顶部：股票数和综合分 */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 30, fontWeight: 900, fontFamily: 'monospace', color: '#ffd700', lineHeight: 1 }}>
                  {l1Stats?.total ?? '-'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.45))' }}>只股票</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.35))' }}>均值综合分</span>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: '#ffd700' }}>
                  {fmt(l1Stats?.avgComposite ?? 0, 1)}
                </span>
              </div>

              {/* 五因子条形 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {FACTORS.map((f, i) => {
                  const rawVal = avgFactors ? avgFactors[f.key] * 100 : 0
                  const pct = Math.min(Math.max(rawVal, 0), 100)
                  const labelWidth = 34
                  return (
                    <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: labelWidth, fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))', textAlign: 'right', flexShrink: 0 }}>
                        {f.label}
                      </div>
                      <div style={{ flex: 1, height: 6, background: 'var(--yaodi-inset)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: f.color,
                          borderRadius: 3,
                          transition: 'width 0.5s ease',
                          opacity: 0.85,
                        }} />
                      </div>
                      <div style={{ width: 34, fontSize: 10, fontFamily: 'monospace', color: f.color, textAlign: 'right', flexShrink: 0 }}>
                        {fmt(rawVal, 1)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 右侧：雷达图 */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <FactorRadar data={avgFactors} size={130} showLabels={false} compact />
              <div style={{ fontSize: 9, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.3))' }}>因子雷达</div>
            </div>
          </div>
        </StatusCard>

        {/* L2 精排卡片 */}
        {/* L2 精排卡片 — L2综合分 + 三模型得分分布 + 置信度 */}
        <StatusCard title="L2 精排" icon={Brain} accent="#722ed1">
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {/* 左侧：核心指标 */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 30, fontWeight: 900, fontFamily: 'monospace', color: '#722ed1', lineHeight: 1 }}>
                  {l2Stats?.total ?? '-'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.45))' }}>只股票</span>
              </div>

              {/* L2 综合分 */}
              <div>
                <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))', marginBottom: 3 }}>L2 综合分</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: '#722ed1' }}>
                  {(l2Stats?.l2ScoreRange ?? '-')}
                </div>
              </div>

              {/* 置信度进度 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
                  <span style={{ color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))' }}>置信度</span>
                  <span style={{ fontFamily: 'monospace', color: '#722ed1' }}>{fmt((l2Stats?.avgConfidence ?? 0) * 100, 1)}%</span>
                </div>
                <div style={{ height: 7, background: 'var(--yaodi-inset, rgba(255,255,255,0.07))', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (l2Stats?.avgConfidence ?? 0) * 100)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #722ed1, #9254ab)',
                    borderRadius: 4,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>

              {/* 平均胜率 */}
              <div style={{ fontSize: 10, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))' }}>
                平均胜率 <span style={{ fontFamily: 'monospace', color: (l2Stats?.avgWinRate ?? 0) > 0 ? '#3f8600' : 'var(--yaodi-text-secondary, rgba(255,255,255,0.25))' }}>
                  {fmt((l2Stats?.avgWinRate ?? 0) * 100, 1)}%
                  {(l2Stats?.avgWinRate ?? 0) === 0 && <span style={{ fontSize: 9 }}>（等待舜帝反馈）</span>}
                </span>
              </div>
            </div>

            {/* 右侧：三模型得分分布 */}
            <div style={{ width: 130, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              <div style={{ fontSize: 9, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.3))', textAlign: 'center', marginBottom: 2 }}>三模型得分分布</div>
              {[
                { label: 'GBDT', color: '#1677ff', scoreKey: 'avgGbdtScore' },
                { label: 'HGBDT', color: '#13c2c2', scoreKey: 'avgHistScore' },
                { label: 'CatBoost', color: '#52c41a', scoreKey: 'avgCatScore' },
              ].map(({ label, color, scoreKey }) => {
                const val = l2Stats?.[scoreKey] ?? 0
                const pct = Math.min(Math.max(val * 100, 0), 100)
                return (
                  <div key={scoreKey} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 36, fontSize: 9, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))', textAlign: 'right', flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1, height: 5, background: 'var(--yaodi-inset)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s ease', opacity: 0.85 }} />
                    </div>
                    <div style={{ width: 30, fontSize: 9, fontFamily: 'monospace', color, textAlign: 'right', flexShrink: 0 }}>{fmt(val, 3)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </StatusCard>

        {/* L3 风控卡片 — Kelly仓位分布 + 信号质量 */}
        <StatusCard title="L3 风控" icon={Shield} accent="#cf1322">
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {/* 左侧：核心指标 */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 30, fontWeight: 900, fontFamily: 'monospace', color: '#cf1322', lineHeight: 1 }}>
                  {l3Stats?.passed ?? 0}
                </span>
                <span style={{ fontSize: 12, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.45))' }}>个买入信号</span>
              </div>

              {/* 两列小指标 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.35))' }}>平均Kelly仓位</div>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: '#cf1322' }}>
                    {fmt(l3Stats?.avgKelly ?? 0, 2)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.35))' }}>平均预期胜率</div>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: '#3f8600' }}>
                    {fmt((l3Stats?.avgWinRate ?? 0) * 100, 1)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.35))' }}>平均ATR</div>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: '#1677ff' }}>
                    {fmt(l3Stats?.avgAtr ?? 0, 3)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.35))' }}>拦截数</div>
                  <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: l3Stats?.blocked > 0 ? '#cf1322' : 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))' }}>
                    {l3Stats?.blocked ?? 0}
                  </div>
                </div>
              </div>
            </div>

            {/* 右侧：Kelly仓位分布 */}
            <div style={{ width: 130, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              <div style={{ fontSize: 9, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.3))', textAlign: 'center', marginBottom: 2 }}>Kelly仓位分布</div>
              {[
                { label: '高仓位 &gt;6%', color: '#cf1322', key: 'kellyHigh' },
                { label: '中仓位 3~6%', color: '#fa8c16', key: 'kellyMid' },
                { label: '低仓位 ≤3%', color: '#3f8600', key: 'kellyLow' },
              ].map(({ label, color, key }) => {
                const cnt = l3Stats?.[key] ?? 0;
                const pct = (cnt / (l3Stats?.passed || 1)) * 100;
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 58, fontSize: 9, color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.4))', textAlign: 'right', flexShrink: 0, lineHeight: 1.2 }}>{label}</div>
                    <div style={{ flex: 1, height: 5, background: 'var(--yaodi-inset)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s ease', opacity: 0.85 }} />
                    </div>
                    <div style={{ width: 20, fontSize: 9, fontFamily: 'monospace', color, textAlign: 'right', flexShrink: 0 }}>{cnt}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </StatusCard>
      </div>

      {/* Tab 导航 */}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab 内容 — minWidth:0 让 flex child 不撑开父容器 */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', animation: 'fadeIn 0.2s ease' }} key={activeTab}>
        {activeTab === 'pipeline' && (
          <div>
            {/* 扫描功能按钮 */}
            <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/yaodi-v2/scan`, { method: 'POST' });
                    const data = await res.json();
                    if (data.success) {
                      alert('扫描完成: ' + (data.message || '成功'));
                    } else {
                      alert('扫描失败: ' + (data.error || '未知错误'));
                    }
                  } catch (e) {
                    alert('扫描失败: ' + e.message);
                  }
                }}
                style={{ padding: '8px 16px', background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Target size={14} /> 手动扫描
              </button>
            </div>
            <PipelineTab
              l1Data={sortedL1} l2Data={sortedL2} l3Data={sortedL3}
              l1Sort={l1Sort} l2Sort={l2Sort} l3Sort={l3Sort}
              onSortL1={k => handleSort(setL1Sort, k)}
              onSortL2={k => handleSort(setL2Sort, k)}
              onSortL3={k => handleSort(setL3Sort, k)}
              avgAccuracy={engineStatus?.avgAccuracy}
              evolutionVersion={engineStatus?.evolutionVersion}
              lastUpdate={lastUpdate}
            />
          </div>
        )}
        {activeTab === 'factors' && <FactorAnalysisTab factorStats={factorStats} l1Data={l1Data} />}
        {activeTab === 'risklog' && <RiskLogTab riskLogs={riskLogs} />}
        {activeTab === 'learning' && (
          <LearningTab
            status={learningStatus}
            onEvaluate={handleLearningEvaluate}
            onUpdateRewards={handleLearningUpdateRewards}
            onRetrain={handleLearningRetrain}
          />
        )}
        {activeTab === 'control' && (
          <EngineControlTab
            params={params}
            onParamChange={handleParamChange}
            onTriggerL1={handleTriggerL1}
            onSetMode={handleSetMode}
            currentMode={currentMode}
            isLoading={isTriggering}
          />
        )}
        {activeTab === 'brain' && (
          <BrainStatusTab
            brainData={brainData}
            threats={threats}
            onRefresh={fetchBrain}
            isLoading={isLoadingBrain}
          />
        )}
        {activeTab === 'position' && <DynamicPositionTab yaodiData={yaodiData} />}
        {activeTab === 'stress' && <StressTestTab />}
        {activeTab === 'twap' && <SmartExecuteTab />}
        {activeTab === 'research' && <ResearchVerifyTab />}
        {activeTab === 'version' && (
          <VersionManageTab />
        )}
        {activeTab === 'logs' && (
          <LogsTab />
        )}
      </div>

      {/* 底部状态栏 */}
      <div style={{
        padding: '8px 24px',
        borderTop: '1px solid var(--yaodi-separator)',
        background: 'var(--yaodi-bg-card)',
        display: 'flex',
        gap: 24,
        fontSize: 11,
        color: 'var(--yaodi-text-secondary, rgba(255,255,255,0.5))',
        fontFamily: 'monospace',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={10} />
          最后更新: {lastUpdate ? fmtTime(lastUpdate) : '-'}
        </span>
        <span>L2: {l2LastRunTime ? fmtTime(l2LastRunTime) : '-'} ({l2ScanCount}次)</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: dataHealth === 'ok' ? '#3f8600' : dataHealth === 'warning' ? '#d46b08' : '#cf1322',
          }} />
          数据源: {dataHealth === 'ok' ? '正常' : dataHealth === 'warning' ? '降级' : '故障'}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {currentMode === SCHEDULER_MODE.ALERT && '⚡ 变盘态 · 高频扫描中'}
          {currentMode === SCHEDULER_MODE.CIRCUIT_BREAK && '🔴 熔断态 · 停止开仓'}
          {currentMode === SCHEDULER_MODE.NORMAL && '🟢 正常态 · 常规扫描'}
        </span>
      </div>
    </div>
  );
};

export default Yaodi;
