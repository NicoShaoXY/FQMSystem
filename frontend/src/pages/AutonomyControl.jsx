import { toBeijingTime, bjDate, bjISO, formatBJTime, formatBJTimeFull } from '../utils/beijingTime';
import React, { useState, useEffect, useCallback } from 'react';
import { themeColors } from '../theme';
// 【修复】统一API_BASE来源，避免多处硬编码
import { API_BASE as CONFIG_API_BASE } from '../config/api';

// ═══════════════════════════════════════════════════════════════════════════
// 尧帝自主控制中心 · Mission Control UI
// Design: Deep Space Command · 军事级指挥控制台
// ═══════════════════════════════════════════════════════════════════════════

// 收益颜色：正→红，负→绿，零→橙
const getProfitColor = (v) =>
  v > 0 ? 'var(--ac-red)' : v < 0 ? 'var(--ac-green)' : 'var(--ac-orange)';
// 收益符号：正→+，负→-，零→无
const getProfitSign = (v) => v > 0 ? '+' : v < 0 ? '-' : '';

// 【修复】从config/api导入基础URL，添加子路径
const API_BASE = CONFIG_API_BASE + '/autonomy';
const SHUNDI_API = CONFIG_API_BASE + '/shundi';


// ─── 主题配色（CSS Variables 映射）──────────────────────────────
// themeC 跟随 App.jsx 切换自动更新

// ─── SVG 图标库（内联，无外部依赖）─────────────────────────────
const Icon = {
  shield: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  zap: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  cpu: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <rect x="9" y="9" width="6" height="6"/>
      <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
      <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
      <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
      <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
    </svg>
  ),
  activity: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  code: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  ),
  checkCircle: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  ),
  alertTriangle: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  play: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="10 8 16 12 10 16 10 8" fill={color} stroke="none"/>
    </svg>
  ),
  pause: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>
    </svg>
  ),
  user: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  trendingUp: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  activitySquare: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  clock: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  search: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  refresh: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  ),
  x: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  arrowRight: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  chevronLeft: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  chevronRight: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  wallet: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>
    </svg>
  ),
  barChart: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="16"/>
    </svg>
  ),
  target: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  layers: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
    </svg>
  ),
  hash: (color = 'currentColor', size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
      <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
    </svg>
  ),
};

// ─── BUG 优先级配置 ─────────────────────────────────────────────
const SEVERITY_CONFIG = {
  P0_CRITICAL: { label: 'P0 致命', color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  glow: 'rgba(239,68,68,0.2)',  badge: '💥', textColor: '#fff' },
  P1_HIGH:     { label: 'P1 高危', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', glow: 'rgba(245,158,11,0.2)',  badge: '🔴', textColor: '#fff' },
  P2_MEDIUM:   { label: 'P2 中危', color: '#eab308', bg: 'rgba(234,179,8,0.1)',   glow: 'rgba(234,179,8,0.15)',  badge: '🟡', textColor: '#fff' },
  P3_LOW:      { label: 'P3 低危', color: '#22c55e', bg: 'rgba(34,197,94,0.15)',  glow: 'rgba(34,197,94,0.2)',   badge: '🟢', textColor: '#fff' },
  FEATURE:     { label: '功能',    color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)',  glow: 'rgba(14,165,233,0.15)', badge: '🆕', textColor: '#fff' },
  REFACTOR:    { label: '重构',    color: '#a855f7', bg: 'rgba(168,85,247,0.1)',  glow: 'rgba(168,85,247,0.15)', badge: '🔧', textColor: '#fff' },
  UNKNOWN:     { label: '其他',   color: '#94a3b8', bg: 'rgba(71,85,105,0.15)',  glow: 'rgba(71,85,105,0.1)',   badge: '📝', textColor: '#fff' },
};

const ACTION_LABELS = {
  code_modification: { label: '代码修改', color: '#a855f7' },
  trade_decision:    { label: '交易决策', color: '#22c55e' },
  risk_control:      { label: '风险控制', color: '#ef4444' },
  capital_adjust:    { label: '资金调整', color: '#0ea5e9' },
  system_alert:      { label: '系统告警', color: '#f59e0b' },
  evolution:         { label: '自我演化', color: '#a855f7' },
};

function getActionLabel(action) {
  const info = ACTION_LABELS[action];
  if (!info) return { label: action, color: 'var(--ac-textMuted)' };
  return info;
}
function formatTime(isoString) {
  return formatBJTime(isoString);
}

function getSeverityInfo(severity) {
  return SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.UNKNOWN;
}

function fmtMoney(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ─── 通用卡片样式生成器 ──────────────────────────────────────────
function cardStyle({ glow = 'none', border = 'var(--ac-border)' } = {}) {
  return {
    background: 'var(--ac-bgCard)',
    border: `1px solid ${border}`,
    borderRadius: 12,
    boxShadow: glow !== 'none' ? `0 0 20px ${glow}, 0 4px 16px rgba(0,0,0,0.4)` : '0 4px 16px rgba(0,0,0,0.3)',
    transition: 'all 0.2s ease',
  };
}

// ─── 状态指示灯 ──────────────────────────────────────────────────
function StatusDot({ color = 'var(--ac-green)', pulse = false, size = 8 }) {
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      borderRadius: '50%',
      background: color,
      boxShadow: `0 0 ${pulse ? 8 : 4}px ${color}`,
      animation: pulse ? 'pulse 2s infinite' : 'none',
    }} />
  );
}

// ─── 进度条 ─────────────────────────────────────────────────────
function MiniBar({ value = 0, max = 100, color = 'var(--ac-cyan)', height = 4 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ width: '100%', height, background: 'var(--ac-bgDeep)', borderRadius: height }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: color,
        borderRadius: height,
        boxShadow: `0 0 6px ${color}`,
        transition: 'width 0.6s ease',
      }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 代码修改历史弹窗
// ═══════════════════════════════════════════════════════════════════════════
function CodeHistoryModal({ isOpen, onClose }) {
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filterSev, setFilterSev] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => { if (isOpen) fetchData(); }, [isOpen]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/code-history?limit=200`);
      const data = await res.json();
      if (data.success) { setHistory(data.history || []); setSummary(data.summary || null); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (!isOpen) return null;

  const filtered = history.filter(h => {
    if (filterSev !== 'ALL' && h.severity !== filterSev) return false;
    if (filterType !== 'ALL' && h.type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(h.description || '').toLowerCase().includes(q) &&
          !(h.file || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{...S.modal, maxWidth: 860}}>

        {/* 标题栏 */}
        <div style={S.modalHeader}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{color:'var(--ac-cyan)'}}>{Icon.code('var(--ac-cyan)', 20)}</span>
            <span style={{fontSize:16,fontWeight:700,color:'var(--ac-textPrimary)'}}>代码修改历史</span>
            {summary && (
              <span style={{...S.badge, background:'var(--ac-cyanSubtle)', color:'var(--ac-cyan)'}}>
                {summary.total} 条
              </span>
            )}
          </div>
          <button style={S.closeBtn} onClick={onClose}>{Icon.x('var(--ac-textMuted)', 18)}</button>
        </div>

        {/* 摘要条 */}
        {summary && (
          <div style={{display:'flex',gap:8,padding:'10px 20px',borderBottom:`1px solid var(--ac-border)`,flexWrap:'wrap',alignItems:'center',background:'var(--ac-bgDeep)'}}>
            <span style={{color:'var(--ac-textMuted)',fontSize:12}}>今日 {summary.today} 条：</span>
            {Object.entries(SEVERITY_CONFIG).map(([k, cfg]) => {
              const n = summary[k] || 0;
              if (!n || k === 'UNKNOWN') return null;
              return (
                <span key={k} style={{...S.badge, background:cfg.bg, color:cfg.color, border:`1px solid ${cfg.color}`}}>
                  {cfg.badge} {n}
                </span>
              );
            })}
          </div>
        )}

        {/* 过滤栏 */}
        <div style={{padding:'12px 20px',borderBottom:`1px solid var(--ac-border)`,background:'var(--ac-bgCard)',display:'flex',flexDirection:'column',gap:10}}>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{color:'var(--ac-textMuted)',fontSize:12,minWidth:40}}>{Icon.search('var(--ac-textMuted)',14)}</span>
            <input style={S.searchInput} placeholder="搜索文件名或描述…" value={search} onChange={e=>setSearch(e.target.value)} />
            <button style={{...S.btnGhost, marginLeft:'auto'}} onClick={fetchData}>{Icon.refresh('var(--ac-textSecondary)',14)} 刷新</button>
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <span style={{color:'var(--ac-textMuted)',fontSize:12}}>级别：</span>
            {['ALL', ...Object.keys(SEVERITY_CONFIG).filter(k=>k!=='UNKNOWN')].map(s => (
              <button key={s} style={{
                ...S.badge, cursor:'pointer',
                background: filterSev===s ? (s==='ALL'?'var(--ac-bgActive)':'var(--ac-cyanSubtle)') : 'transparent',
                color: filterSev===s ? (s==='ALL'?'var(--ac-textPrimary)':'var(--ac-cyan)') : 'var(--ac-textMuted)',
                border: `1px solid ${filterSev===s?(s==='ALL'?'var(--ac-border)':'var(--ac-cyan)'):'var(--ac-border)'}`,
              }} onClick={()=>setFilterSev(s)}>
                {s==='ALL'?'全部':SEVERITY_CONFIG[s].label}
              </button>
            ))}
          </div>
        </div>

        {/* 列表 */}
        <div style={{flex:1,overflowY:'auto',padding:'8px 12px'}}>
          {loading ? (
            <div style={{textAlign:'center',padding:40,color:'var(--ac-textMuted)'}}>加载中…</div>
          ) : filtered.length === 0 ? (
            <div style={{textAlign:'center',padding:40,color:'var(--ac-textMuted)'}}>暂无记录</div>
          ) : filtered.map((item, i) => {
            const sev = getSeverityInfo(item.severity);
            return (
              <div key={i} style={{...S.listItem, borderLeft:`3px solid ${sev.color}`}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                  <span style={{...S.badge, background:sev.bg, color:sev.color, border:`1px solid ${sev.color}`, fontSize:11}}>
                    {sev.badge} {sev.label}
                  </span>
                  <span style={{color:'var(--ac-textMuted)',fontSize:11}}>{item.type || 'CODE_CHANGE'}</span>
                  <span style={{marginLeft:'auto',color:'var(--ac-textFaint)',fontSize:11,fontFamily:'monospace'}}>{formatTime(item.timestamp)}</span>
                </div>
                {item.description && <div style={{color:'var(--ac-textSecondary)',fontSize:13,marginBottom:4,lineHeight:1.5}}>{item.description}</div>}
                {item.file && <div style={{color:'var(--ac-textMuted)',fontSize:11,fontFamily:'monospace'}}>📄 {item.file}</div>}
                <div style={{display:'flex',gap:6,marginTop:6,flexWrap:'wrap'}}>
                  <span style={{...S.badge, background:item.status==='FIXED'?'var(--ac-greenSubtle)':'transparent', color:item.status==='FIXED'?'var(--ac-green)':'var(--ac-textMuted)', border:`1px solid ${item.status==='FIXED'?'var(--ac-green)':'var(--ac-border)'}`, fontSize:11}}>
                    {item.status==='FIXED'?'✅':'⏳'} {item.status==='FIXED'?'已修复':'待处理'}
                  </span>
                  {item.autoFixed && (
                    <span style={{...S.badge, background:'rgba(168,85,247,0.1)', color:'var(--ac-purple)', border:`1px solid var(--ac-purple)`, fontSize:11}}>
                      🤖 自主修复
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部 */}
        <div style={{padding:'12px 20px',borderTop:`1px solid var(--ac-border)`,display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--ac-bgDeep)'}}>
          <span style={{color:'var(--ac-textMuted)',fontSize:12}}>共 {filtered.length} 条</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 舜帝交易记录弹窗
// ═══════════════════════════════════════════════════════════════════════════
function TradeHistoryModal({ isOpen, onClose, shundiVersion }) {
  const [trades, setTrades] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const TYPE_OPTIONS = [
    { value: 'ALL', label: '全部' },
    { value: '舜帝买入', label: '舜帝买入' },
    { value: '舜帝加仓', label: '舜帝加仓' },
    { value: '智能选股新仓', label: '智能选股' },
    { value: '加仓', label: '人工加仓' },
    { value: 'ATR止盈', label: 'ATR止盈' },
    { value: 'ATR止损', label: 'ATR止损' },
    { value: 'sell', label: '人工卖出' },
  ];

  const TYPE_COLORS = {
    '舜帝买入':     { color: 'var(--ac-green)', bg: 'var(--ac-greenSubtle)' },
    '舜帝加仓':     { color: 'var(--ac-purple)', bg: 'rgba(168,85,247,0.1)' },
    '智能选股新仓': { color: 'var(--ac-cyan)', bg: 'var(--ac-cyanSubtle)' },
    '加仓':        { color: '#e879f9', bg: 'rgba(232,121,249,0.1)' },
    'ATR止盈':     { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
    'ATR止损':     { color: 'var(--ac-amber)', bg: 'var(--ac-amberGlow)' },
    'sell':        { color: 'var(--ac-red)', bg: 'var(--ac-redSubtle)' },
    'buy':         { color: 'var(--ac-green)', bg: 'var(--ac-greenSubtle)' },
  };

  useEffect(() => { if (isOpen) fetchTrades(1); }, [isOpen]);

  const fetchTrades = async (p) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, pageSize });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (typeFilter !== 'ALL') params.set('type', typeFilter);
      const res = await fetch(`${SHUNDI_API}/trades?${params}`);
      const data = await res.json();
      if (data.success) {
        setTrades(data.trades || []);
        setTotal(data.pagination?.total || 0);
        setTotalPages(data.pagination?.totalPages || 1);
        setPage(p);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (!isOpen) return null;

  const pageNums = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
    if (totalPages <= 7) return i + 1;
    if (page <= 4) return i + 1;
    if (page >= totalPages - 3) return totalPages - 6 + i;
    return page - 3 + i;
  });

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{...S.modal, maxWidth: 900}}>

        {/* 标题栏 */}
        <div style={S.modalHeader}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{color:'var(--ac-cyan)'}}>{Icon.layers('var(--ac-cyan)', 20)}</span>
            <span style={{fontSize:16,fontWeight:700,color:'var(--ac-textPrimary)'}}>舜帝交易记录</span>
            {shundiVersion && (
              <span style={{...S.badge, background:'var(--ac-cyanSubtle)', color:'var(--ac-cyan)', border:`1px solid var(--ac-cyan)`}}>
                V{shundiVersion}
              </span>
            )}
          </div>
          <button style={S.closeBtn} onClick={onClose}>{Icon.x('var(--ac-textMuted)', 18)}</button>
        </div>

        {/* 筛选栏 */}
        <div style={{padding:'12px 20px',borderBottom:`1px solid var(--ac-border)`,display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',background:'var(--ac-bgDeep)'}}>
          <span style={{color:'var(--ac-textMuted)',fontSize:12}}>时间：</span>
          <input type="date" value={startDate} onChange={e=>{setStartDate(e.target.value);}} style={S.dateInput} />
          <span style={{color:'var(--ac-textMuted)',fontSize:12}}>—</span>
          <input type="date" value={endDate} onChange={e=>{setEndDate(e.target.value);}} style={S.dateInput} />
          <span style={{color:'var(--ac-textMuted)',fontSize:12,marginLeft:4}}>类型：</span>
          <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={S.select}>
            {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button style={{...S.btn, background:'var(--ac-cyan)', color:'#fff', border:'none'}} onClick={()=>fetchTrades(1)}>筛选</button>
          <button style={{...S.btnGhost}} onClick={()=>{setStartDate('');setEndDate('');setTypeFilter('ALL');fetchTrades(1);}}>重置</button>
          <span style={{marginLeft:'auto',color:'var(--ac-textMuted)',fontSize:12}}>{total} 条记录</span>
        </div>

        {/* 表格 */}
        <div style={{overflowY:'auto',maxHeight:460,flex:1}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{borderBottom:`1px solid var(--ac-border)`,position:'sticky',top:0,background:'var(--ac-bgDeep)',zIndex:1}}>
                {['时间','标的','类型','方向','价格','数量','金额','盈亏'].map(h => (
                  <th key={h} style={{padding:'10px 8px',color:'var(--ac-textMuted)',textAlign:'center',fontWeight:500,fontSize:11}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'var(--ac-textMuted)'}}>加载中…</td></tr>
              ) : trades.length === 0 ? (
                <tr><td colSpan={8} style={{textAlign:'center',padding:40,color:'var(--ac-textMuted)'}}>暂无交易记录</td></tr>
              ) : trades.map((t, i) => {
                const tc = TYPE_COLORS[t.type] || { color: 'var(--ac-textSecondary)', bg: 'transparent' };
                const pnl = t.pnl || 0;
                const isSell = ['sell','ATR止盈','ATR止损'].includes(t.type);
                return (
                  <tr key={i} style={{borderBottom:`1px solid var(--ac-border)`,transition:'background 0.15s'}}>
                    <td style={{padding:'8px',color:'var(--ac-textMuted)',textAlign:'center',fontFamily:'monospace',fontSize:12}}>{formatTime(t.created_at)}</td>
                    <td style={{padding:'8px',textAlign:'center',fontFamily:'monospace',fontSize:12}}><span style={{color:'var(--ac-textMuted)',fontSize:11,marginRight:6}}>{t.code || '-'}</span><span style={{color:'var(--ac-textPrimary)',fontWeight:600}}>{t.name || ''}</span></td>
                    <td style={{padding:'8px',textAlign:'center'}}>
                      <span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:600,...tc}}>
                        {t.type === 'buy' ? '买入' : t.type === 'sell' ? '卖出' : t.type}
                      </span>
                    </td>
                    <td style={{padding:'8px',textAlign:'center',color:isSell?'var(--ac-red)':'var(--ac-green)',fontSize:12}}>{isSell?'卖出':'买入'}</td>
                    <td style={{padding:'8px',textAlign:'right',color:'var(--ac-textSecondary)',fontFamily:'monospace'}}>{t.price!=null?`¥${Number(t.price).toFixed(2)}`:'—'}</td>
                    <td style={{padding:'8px',textAlign:'right',color:'var(--ac-textSecondary)',fontFamily:'monospace'}}>{t.quantity||'-'}</td>
                    <td style={{padding:'8px',textAlign:'right',color:'var(--ac-textSecondary)',fontFamily:'monospace'}}>{t.amount!=null?`¥${Number(t.amount).toFixed(0)}`:'—'}</td>
                    <td style={{padding:'8px',textAlign:'right',fontFamily:'monospace',fontWeight:600,color:isSell?getProfitColor(pnl):'var(--ac-textMuted)'}}>
                      {isSell?`${getProfitSign(pnl)}¥${Math.abs(pnl).toFixed(2)}`:'—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:6,padding:'14px 20px',borderTop:`1px solid var(--ac-border)`,background:'var(--ac-bgDeep)'}}>
          <button style={{...S.btn, background:'var(--ac-bgHover)', color:'var(--ac-textSecondary)', border:`1px solid var(--ac-border)`,padding:'6px 12px',fontSize:12}} onClick={()=>fetchTrades(page-1)} disabled={page<=1}>
            {Icon.chevronLeft('var(--ac-textSecondary)',14)} 上一页
          </button>
          {pageNums.map(p => (
            <button key={p} style={{...S.btn, padding:'6px 10px',fontSize:12,
              background: p===page ? 'var(--ac-cyan)' : 'var(--ac-bgHover)',
              color: p===page ? '#fff' : 'var(--ac-textSecondary)',
              border: `1px solid ${p===page ? 'var(--ac-cyan)' : 'var(--ac-border)'}`,
            }} onClick={()=>fetchTrades(p)}>{p}</button>
          ))}
          <button style={{...S.btn, background:'var(--ac-bgHover)', color:'var(--ac-textSecondary)', border:`1px solid var(--ac-border)`,padding:'6px 12px',fontSize:12}} onClick={()=>fetchTrades(page+1)} disabled={page>=totalPages}>
            下一页 {Icon.chevronRight('var(--ac-textSecondary)',14)}
          </button>
          <span style={{color:'var(--ac-textMuted)',fontSize:12,marginLeft:8}}>第 {page}/{totalPages} 页</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════════════════
export default function AutonomyControl() {
  const [status, setStatus] = useState(null);
  const [shundi, setShundi] = useState(null);
  const [shundiStats, setShundiStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [codeHistory, setCodeHistory] = useState([]);
  const [showCodeHistory, setShowCodeHistory] = useState(false);
  const [showTrades, setShowTrades] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  // ── 主题跟随 ────────────────────────────────────────────────
  const [C, setC] = useState(themeColors.current);
  useEffect(() => {
    const handler = (e) => setC(e.detail.C);
    window.addEventListener('fqm-theme-change', handler);
    return () => window.removeEventListener('fqm-theme-change', handler);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [sRes, shRes, shStatsRes, hRes, chRes] = await Promise.all([
        fetch(`${API_BASE}/status`),
        fetch(`${SHUNDI_API}/status`),
        fetch(`${SHUNDI_API}/stats`),
        fetch(`${API_BASE}/history?limit=10`),
        fetch(`${API_BASE}/code-history?limit=50`),
      ]);
      const [sData, shData, shStatsData, hData, chData] = await Promise.all([sRes.json(), shRes.json(), shStatsRes.json(), hRes.json(), chRes.json()]);
      if (sData.success) setStatus(sData.status);
      if (shData.success) setShundi(shData.shundi);
      if (shStatsData.success) setShundiStats(shStatsData.stats);
      if (chData.success) setCodeHistory(chData.history || []);
      setLastRefresh(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 5000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  // ─── 操作 ────────────────────────────────────────────────────────
  const op = async (url, method = 'POST', body, confirmMsg, okMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (data.success) { if (okMsg) alert(okMsg); fetchAll(); }
      else alert('操作失败：' + (data.error || '未知错误'));
    } catch (e) { alert('操作失败：' + e.message); }
    finally { setBusy(false); }
  };

  const MODE_INFO = {
    autonomous: { label: '全自主', icon: Icon.zap, color: 'var(--ac-cyan)',    bg: 'var(--ac-cyanSubtle)',  desc: '系统自主决策交易，无需人工确认' },
    semi:       { label: '半自动', icon: Icon.activity, color: 'var(--ac-amber)', bg: 'var(--ac-amberGlow)', desc: '系统生成建议，需人工确认执行' },
    manual:      { label: '手动',   icon: Icon.user,     color: 'var(--ac-green)',  bg: 'var(--ac-greenSubtle)', desc: '完全人工操作，系统仅提供参考' },
  };

  const today = status?.todayCodeSummary || {};
  const stats = shundi?.stats || {};
  // 从 codeHistory 实时计算今日代码修改统计
  const todayMs = toBeijingTime().setHours(0,0,0,0);
  const todayCode = codeHistory.filter(h => new Date(h.timestamp).getTime() >= todayMs);
  const todayCount = todayCode.length;
  // 全量级别分布
  const codeSummary = codeHistory.reduce((acc, h) => { acc[h.severity] = (acc[h.severity] || 0) + 1; return acc; }, {});
  // 列表：优先今日，无今日则展示全量最近5条
  const listSource = todayCode.length > 0 ? todayCode.slice(0, 5) : codeHistory.slice(0, 5);
  const ss    = shundiStats || {};
  const totalAssets   = ss.totalAssets  != null ? ss.totalAssets  : (stats.totalAssets  != null ? stats.totalAssets  : null);
  const totalCapital  = ss.totalCapital != null ? ss.totalCapital : (stats.totalCapital != null ? stats.totalCapital : null);
  const holdingProfit = ss.holdingProfit != null ? ss.holdingProfit : (stats.holdingProfit || 0);
  const closedPnl     = ss.closedPnl     != null ? ss.closedPnl     : (stats.closedPnl     || 0);
  const totalProfit   = ss.totalProfit   != null ? ss.totalProfit   : (stats.totalProfit   || 0);
  const totalReturn   = ss.totalReturn   != null ? ss.totalReturn   : (stats.totalReturn   || 0);
  const winRate       = ss.winRate       != null ? ss.winRate       : (stats.winRate       || 0);
  const tradeCount    = ss.tradeCount    != null ? ss.tradeCount    : (stats.tradeCount    || 0);
  const holdingsCount = ss.holdingsCount != null ? ss.holdingsCount : (shundi?.holdings?.list || []).length;
  const shundiVer     = ss.mainVersion    || shundi?.version || stats.mainVersion || '?';

  if (loading) {
    return (
      <div style={{...S.page, display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{textAlign:'center',color:'var(--ac-textMuted)'}}>
          <div style={{marginBottom:12}}>{Icon.cpu('var(--ac-cyan)', 32)}</div>
          <div>系统连接中…</div>
        </div>
      </div>
    );
  }

  const isEmergency = !!status?.emergencyStop;
  const currentMode = status?.mode || 'manual';

  return (
    <div style={S.page}>
      {/* 全局样式注入 */}
      <style>{`
        
        * { box-sizing: border-box; }
        @keyframes pulse {
          0%,100% { opacity:1; transform:scale(1); }
          50% { opacity:0.6; transform:scale(1.3); }
        }
        @keyframes glow {
          0%,100% { box-shadow: 0 0 8px currentColor; }
          50% { box-shadow: 0 0 20px currentColor; }
        }
        @keyframes slideUp {
          from { opacity:0; transform:translateY(12px); }
          to { opacity:1; transform:translateY(0); }
        }
        .ctrl-section { animation: slideUp 0.4s ease both; }
        .ctrl-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
        .ctrl-btn:active { transform: translateY(0); filter: brightness(0.95); }
      `}</style>

      {/* 弹窗 */}
      <CodeHistoryModal isOpen={showCodeHistory} onClose={()=>setShowCodeHistory(false)} />
      <TradeHistoryModal isOpen={showTrades} onClose={()=>setShowTrades(false)} shundiVersion={shundiVer} />

      {/* ═══ 顶部导航条 ═════════════════════════════════════════════ */}
      <div style={S.topBar}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{color:'var(--ac-cyan)'}}>{Icon.shield('var(--ac-cyan)', 20)}</span>
            <span style={S.topBarTitle}>尧帝自主控制中心</span>
          </div>
          <div style={{height:20,width:1,background:'var(--ac-border)'}} />
          {/* 紧急停止状态 */}
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <StatusDot color={isEmergency ? 'var(--ac-red)' : 'var(--ac-green)'} pulse={isEmergency} />
            <span style={{fontSize:12,color: isEmergency ? 'var(--ac-red)' : 'var(--ac-green)', fontWeight:600}}>
              {isEmergency ? '紧急停止激活' : '系统在线'}
            </span>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:11,color:'var(--ac-textMuted)',fontFamily:'monospace'}}>
            {lastRefresh ? `刷新 ${toBeijingTime(lastRefresh).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}` : ''}
          </span>
          <button style={{...S.iconBtn}} onClick={fetchAll} title="刷新">
            {Icon.refresh('var(--ac-textSecondary)', 15)}
          </button>
        </div>
      </div>

      {/* ═══ 第一行：紧急停止 + 运行模式 ════════════════════════════ */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}} className="ctrl-section">

        {/* 紧急停止 */}
        <div style={{...cardStyle({
          glow: isEmergency ? 'var(--ac-redGlow)' : 'var(--ac-greenGlow)',
          border: isEmergency ? 'var(--ac-red)' : 'var(--ac-border)',
        })}}>
          <div style={{padding:'20px 24px',display:'flex',alignItems:'center',gap:12,borderBottom:`1px solid var(--ac-border)`}}>
            <div style={{
              width:44,height:44,borderRadius:10,
              background: isEmergency ? 'var(--ac-redSubtle)' : 'var(--ac-greenSubtle)',
              border: `1px solid ${isEmergency ? 'var(--ac-red)' : 'var(--ac-green)'}`,
              display:'flex',alignItems:'center',justifyContent:'center',
              boxShadow: `0 0 12px ${isEmergency ? 'var(--ac-redGlow)' : 'var(--ac-greenGlow)'}`,
            }}>
              <span style={{fontSize:22}}>{isEmergency ? '🛑' : '✅'}</span>
            </div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:'var(--ac-textPrimary)'}}>
                {isEmergency ? '紧急停止已激活' : '系统运行正常'}
              </div>
              <div style={{fontSize:12,color:'var(--ac-textMuted)',marginTop:2}}>
                {isEmergency
                  ? `触发时间：${formatTime(status?.emergencyStopTime)}`
                  : '所有自主操作正常运行中'}
              </div>
            </div>
          </div>

          {isEmergency && (
            <div style={{padding:'12px 24px',background:'var(--ac-redSubtle)',borderBottom:`1px solid var(--ac-red)`,marginBottom:0}}>
              <span style={{fontSize:12,color:'var(--ac-red)'}}>
                ⚠️ 停止原因：{status?.emergencyStopReason || '未知'}
              </span>
            </div>
          )}

          <div style={{padding:'16px 24px',display:'flex',gap:10}}>
            <button
              className="ctrl-btn"
              style={{
                flex:1, padding:'12px 16px', borderRadius:8, border:'none',
                fontSize:14, fontWeight:700, cursor: busy?'not-allowed':'pointer',
                background: isEmergency ? 'var(--ac-textMuted)' : 'var(--ac-red)',
                color:'#fff', transition:'all 0.2s',
                boxShadow: isEmergency ? 'none' : `0 4px 12px var(--ac-redGlow)`,
              }}
              onClick={() => op(
                `${API_BASE}/emergency-stop`, 'POST',
                { reason: '用户手动触发' },
                '⚠️ 确定要触发紧急停止吗？\n\n所有自主操作将立即暂停，系统切换为手动模式。',
                '🛑 紧急停止已触发'
              )}
              disabled={isEmergency || busy}
            >
              🛑 紧急停止
            </button>
            {isEmergency && (
              <button
                className="ctrl-btn"
                style={{
                  flex:1, padding:'12px 16px', borderRadius:8, border:`1px solid var(--ac-green)`,
                  fontSize:14, fontWeight:700, cursor: busy?'not-allowed':'pointer',
                  background: 'var(--ac-greenSubtle)', color:'var(--ac-green)',
                  boxShadow: `0 4px 12px var(--ac-greenGlow)`,
                }}
                onClick={() => op(
                  `${API_BASE}/clear-emergency`, 'POST', null,
                  '确定要解除紧急停止状态吗？',
                  '✅ 紧急停止已解除'
                )}
                disabled={busy}
              >
                ✅ 解除停止
              </button>
            )}
          </div>
        </div>

        {/* 运行模式 */}
        <div style={cardStyle()}>
          <div style={{padding:'16px 20px 12px',borderBottom:`1px solid var(--ac-border)`,display:'flex',alignItems:'center',gap:8}}>
            <span style={{color:'var(--ac-cyan)'}}>{Icon.zap('var(--ac-cyan)',16)}</span>
            <span style={{fontSize:13,fontWeight:700,color:'var(--ac-textPrimary)'}}>运行模式</span>
            <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6}}>
              <StatusDot color={MODE_INFO[currentMode]?.color || 'var(--ac-green)'} pulse />
              <span style={{fontSize:12,color:MODE_INFO[currentMode]?.color,fontWeight:600}}>
                {MODE_INFO[currentMode]?.label || currentMode}
              </span>
            </div>
          </div>
          <div style={{padding:'12px',display:'flex',flexDirection:'column',gap:8}}>
            {Object.entries(MODE_INFO).map(([key, info]) => {
              const active = currentMode === key;
              return (
                <button
                  key={key}
                  className="ctrl-btn"
                  style={{
                    display:'flex',alignItems:'center',gap:10,
                    padding:'10px 12px', borderRadius:8,
                    border:`1px solid ${active ? info.color : 'var(--ac-border)'}`,
                    background: active ? info.bg : 'transparent',
                    cursor: busy?'not-allowed':'pointer',
                    transition:'all 0.2s',
                    boxShadow: active ? `0 0 12px ${info.color}33` : 'none',
                  }}
                  onClick={() => op(
                    `${API_BASE}/${key === 'autonomous' ? 'enable' : key}`, 'POST', null,
                    `确定切换到「${info.label}」模式？`,
                  )}
                  disabled={busy}
                >
                  <span style={{color: active ? info.color : 'var(--ac-textMuted)'}}>
                    {key === 'autonomous' ? Icon.zap(active?info.color:'var(--ac-textMuted)', 16) :
                     key === 'semi' ? Icon.activity(active?info.color:'var(--ac-textMuted)', 16) :
                     Icon.user(active?info.color:'var(--ac-textMuted)', 16)}
                  </span>
                  <div style={{flex:1,textAlign:'left'}}>
                    <div style={{fontSize:13,fontWeight:600,color: active ? info.color : 'var(--ac-textSecondary)'}}>{info.label}</div>
                    <div style={{fontSize:11,color:'var(--ac-textMuted)',marginTop:1}}>{info.desc}</div>
                  </div>
                  {active && <StatusDot color={info.color} size={6} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ 第二行：舜帝模拟盘核心数据 ═══════════════════════════════ */}
      <div style={{...cardStyle({ border: `1px solid var(--ac-borderBright)` }), marginBottom:16}} className="ctrl-section">
        {/* 卡片头部 */}
        <div style={{padding:'16px 20px',borderBottom:`1px solid var(--ac-border)`,display:'flex',alignItems:'center',gap:8}}>
          <span style={{color:'var(--ac-cyan)'}}>{Icon.activitySquare('var(--ac-cyan)',16)}</span>
          <span style={{fontSize:13,fontWeight:700,color:'var(--ac-textPrimary)'}}>舜帝模拟盘</span>
          <span style={{...S.badge, background:'var(--ac-cyanSubtle)', color:'var(--ac-cyan)', border:`1px solid var(--ac-cyan)`, fontSize:11}}>
            V{shundiVer}
          </span>
          <div style={{marginLeft:'auto',display:'flex',gap:8}}>
            <button style={{...S.btnGhost, fontSize:11, padding:'4px 10px'}} onClick={()=>setShowTrades(true)}>
              📋 交易记录
            </button>
          </div>
        </div>

        {/* 核心数字区 */}
        <div style={{padding:'16px 20px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
          {/* 总资产 */}
          <div style={{padding:'14px',background:'var(--ac-bgDeep)',borderRadius:10,border:`1px solid var(--ac-border)`,textAlign:'center'}}>
            <div style={{fontSize:11,color:'var(--ac-textMuted)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>总资产</div>
            <div style={{fontSize:22,fontWeight:700,color:'var(--ac-cyan)',fontFamily:'system-ui,-apple-system,sans-serif',letterSpacing:-0.5}}>
              ¥{(totalAssets||0)/10000 >= 1 ? `${((totalAssets||0)/10000).toFixed(2)}万` : '—'}
            </div>
            <div style={{fontSize:11,color:getProfitColor(totalProfit),marginTop:4}}>
              {fmtPct(totalReturn)} 总收益
            </div>
          </div>
          {/* 可用 + 持仓 */}
          <div style={{padding:'14px',background:'var(--ac-bgDeep)',borderRadius:10,border:`1px solid var(--ac-border)`,textAlign:'center'}}>
            <div style={{fontSize:11,color:'var(--ac-textMuted)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>可用 / 持仓</div>
            <div style={{fontSize:18,fontWeight:700,color:'var(--ac-textPrimary)',fontFamily:'system-ui,-apple-system,sans-serif'}}>
              ¥{(ss.available||0).toFixed(0)}
            </div>
            <div style={{fontSize:13,color:'var(--ac-textSecondary)',marginTop:2}}>
              ¥{(ss.totalPosition||0).toFixed(0)}
            </div>
            <div style={{fontSize:11,color:'var(--ac-textMuted)',marginTop:4}}>持仓 {holdingsCount} 只</div>
          </div>
          {/* 累计盈亏 */}
          <div style={{padding:'14px',background:'var(--ac-bgDeep)',borderRadius:10,border:`1px solid var(--ac-border)`,textAlign:'center'}}>
            <div style={{fontSize:11,color:'var(--ac-textMuted)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>累计盈亏</div>
            <div style={{fontSize:22,fontWeight:700,color:getProfitColor(totalProfit),fontFamily:'system-ui,-apple-system,sans-serif'}}>
              {fmtMoney(totalProfit)}
            </div>
            <div style={{fontSize:11,color:'var(--ac-textMuted)',marginTop:4}}>
              持仓 {fmtMoney(holdingProfit)} + 已平 {fmtMoney(closedPnl)}
            </div>
          </div>
          {/* 胜率 + 交易数 */}
          <div style={{padding:'14px',background:'var(--ac-bgDeep)',borderRadius:10,border:`1px solid var(--ac-border)`,textAlign:'center'}}>
            <div style={{fontSize:11,color:'var(--ac-textMuted)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>胜率 / 交易</div>
            <div style={{fontSize:22,fontWeight:700,color:getProfitColor(winRate-50),fontFamily:'system-ui,-apple-system,sans-serif'}}>
              {winRate}%
            </div>
            <MiniBar value={winRate} max={100} color={getProfitColor(winRate-50)} height={4} />
            <div style={{fontSize:11,color:'var(--ac-textMuted)',marginTop:4}}>已平仓胜率</div>
          </div>
        </div>

        {/* 次要指标 */}
        <div style={{padding:'0 20px 16px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
          {[
            { label:'初始资金', value: totalCapital != null ? `¥${totalCapital.toLocaleString()}` : '—', color:'var(--ac-textMuted)' },
            { label:'持仓盈亏', value:fmtMoney(holdingProfit), color:getProfitColor(holdingProfit) },
            { label:'已平仓盈亏', value:fmtMoney(closedPnl), color:getProfitColor(closedPnl) },
            { label:'总交易次数', value:tradeCount, color:'var(--ac-cyan)', clickable:true, onClick:()=>setShowTrades(true) },
          ].map(item => (
            <div key={item.label} style={{
              padding:'10px 12px', background:'var(--ac-bgDeep)', borderRadius:8,
              border:`1px solid var(--ac-border)`, display:'flex', justifyContent:'space-between', alignItems:'center',
              cursor: item.clickable ? 'pointer' : 'default',
            }} onClick={item.onClick}>
              <span style={{fontSize:11,color:'var(--ac-textMuted)'}}>{item.label}</span>
              <span style={{fontSize:13,fontWeight:600,color:item.color}}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>



      {/* ═══ 底部运行统计 ════════════════════════════════════════════ */}
      <div style={{...cardStyle({ border: `1px solid var(--ac-border)` })}} className="ctrl-section">
        <div style={{padding:'14px 20px',borderBottom:`1px solid var(--ac-border)`,display:'flex',alignItems:'center',gap:8}}>
          <span style={{color:'var(--ac-textSecondary)'}}>{Icon.barChart('var(--ac-textSecondary)',16)}</span>
          <span style={{fontSize:13,fontWeight:700,color:'var(--ac-textPrimary)'}}>运行统计</span>
        </div>
        <div style={{padding:'14px 20px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
          {[
            { label:'今日交易', value: shundiStats?.tradeCount ?? 0, icon: Icon.activitySquare, color:'var(--ac-cyan)' },
            { label:'累计收益', value: `¥${((shundiStats?.totalProfit)||0).toLocaleString()}`, icon: Icon.wallet, color: getProfitColor((shundiStats?.totalProfit)||0) },
            { label:'胜率', value: `${((shundiStats?.winRate||0)).toFixed(1)}%`, icon: Icon.target, color:'var(--ac-amber)' },
            { label:'舜帝版本', value: `V${shundiVer}`, icon: Icon.hash, color:'var(--ac-purple)' },
          ].map(item => (
            <div key={item.label} style={{
              padding:'12px', background:'var(--ac-bgDeep)', borderRadius:8,
              border:`1px solid var(--ac-border)`, display:'flex', gap:10, alignItems:'center',
            }}>
              <div style={{color:item.color,flexShrink:0}}>{item.icon(item.color, 18)}</div>
              <div>
                <div style={{fontSize:10,color:'var(--ac-textMuted)',textTransform:'uppercase',letterSpacing:0.5}}>{item.label}</div>
                <div style={{fontSize:16,fontWeight:700,color:item.color,fontFamily:'system-ui,-apple-system,sans-serif',marginTop:2}}>{item.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 全局样式
// ═══════════════════════════════════════════════════════════════════════════
const S = {
  // ── 通用卡片（核心视觉元素）────────────────────────────────
  card: {
    background: 'var(--ac-bgCard)',
    border: '1px solid var(--ac-border)',
    borderRadius: 12,
    boxShadow: '0 4px 16px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset',
  },

  page: {
    padding: 0,
    maxWidth: '100%',
    fontFamily: '"Noto Sans SC", "PingFang SC", -apple-system, sans-serif',
    background: 'var(--ac-bgDeepest)',
    minHeight: '100vh',
    color: 'var(--ac-textPrimary)',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 24px',
    background: 'var(--ac-bgDeep)',
    borderBottom: `1px solid var(--ac-border)`,
    position: 'sticky',
    top: 0,
    zIndex: 100,
    backdropFilter: 'blur(8px)',
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--ac-textPrimary)',
    letterSpacing: '-0.01em',
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    border: `1px solid var(--ac-border)`,
    borderRadius: 8,
    background: 'var(--ac-bgCard)',
    cursor: 'pointer',
    color: 'var(--ac-textSecondary)',
    transition: 'all 0.15s',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 8px',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
  },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 14px',
    borderRadius: 6,
    border: `1px solid var(--ac-border)`,
    background: 'var(--ac-bgCard)',
    color: 'var(--ac-textSecondary)',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
  },
  btnGhost: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 10px',
    borderRadius: 6,
    border: `1px solid var(--ac-border)`,
    background: 'transparent',
    color: 'var(--ac-textSecondary)',
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
  },
  searchInput: {
    background: 'var(--ac-bgDeep)',
    border: `1px solid var(--ac-border)`,
    borderRadius: 6,
    padding: '5px 10px',
    color: 'var(--ac-textPrimary)',
    fontSize: 13,
    flex: 1,
    outline: 'none',
    fontFamily: 'inherit',
  },
  dateInput: {
    background: 'var(--ac-bgDeep)',
    border: `1px solid var(--ac-border)`,
    borderRadius: 6,
    padding: '5px 8px',
    color: 'var(--ac-textPrimary)',
    fontSize: 12,
    outline: 'none',
    fontFamily: 'monospace',
  },
  select: {
    background: 'var(--ac-bgDeep)',
    border: `1px solid var(--ac-border)`,
    borderRadius: 6,
    padding: '5px 8px',
    color: 'var(--ac-textPrimary)',
    fontSize: 12,
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(5,8,16,0.85)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: 20,
  },
  modal: {
    background: 'var(--ac-bgCard)',
    borderRadius: 14,
    width: '100%',
    maxWidth: 720,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid var(--ac-borderBright)`,
    boxShadow: `0 0 40px rgba(14,165,233,0.08), 0 20px 60px rgba(0,0,0,0.6)`,
    fontFamily: '"Noto Sans SC", -apple-system, sans-serif',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: `1px solid var(--ac-border)`,
    flexShrink: 0,
    background: 'var(--ac-bgDeep)',
    borderRadius: '14px 14px 0 0',
  },
  closeBtn: {
    background: 'none',
    border: `1px solid var(--ac-border)`,
    borderRadius: 6,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    padding: 4,
    color: 'var(--ac-textMuted)',
    transition: 'all 0.15s',
  },
  listItem: {
    background: 'var(--ac-bgHover)',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 6,
    border: `1px solid var(--ac-border)`,
    transition: 'all 0.15s',
  },
};
