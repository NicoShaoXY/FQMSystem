import React, { useState, useEffect } from 'react';
import { stockAPI, blackswanAPI } from '../config/api';
import { RefreshCw, AlertTriangle, TrendingDown, TrendingUp, Newspaper, X, Filter } from 'lucide-react';
import { themeColors } from '../theme';

const SEVERITY_CONFIG = {
  RED:    { label: '🔴 严重', color: 'var(--ac-red)',    bg: 'var(--ac-redSubtle)',    border: 'var(--ac-red)'    },
  ORANGE: { label: '🟠 中度', color: '#f97316',           bg: 'rgba(249,115,22,0.1)',   border: 'rgba(249,115,22,0.4)' },
  YELLOW: { label: '🟡 轻微', color: '#eab308',           bg: 'rgba(234,179,8,0.1)',    border: 'rgba(234,179,8,0.4)' },
};

const TYPE_CONFIG = {
  news:        { label: '📰 新闻',      icon: Newspaper },
  price_crash: { label: '💥 价格闪崩',  icon: TrendingDown },
  price_surge: { label: '🚀 价格暴涨',  icon: TrendingUp },
  stoploss:    { label: '🚨 止损预警',  icon: AlertTriangle },
};

const ACTION_LABELS = {
  forbidden_buy:  '⛔ 禁止买入',
  strong_sell:   '🚫 强烈卖出',
  emergency_stop:'🚨 紧急止损',
  watch:         '⚠️ 注意观望',
};

// ── 统一样式对象（主题感知）────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh',
    background: 'var(--ac-bgDeepest)',
    color: 'var(--ac-textPrimary)',
    fontFamily: '"Noto Sans SC", -apple-system, sans-serif',
  },

  // ── 通用卡片 ─────────────────────────────────────────────
  card: {
    background: 'var(--ac-bgCard)',
    border: '1px solid var(--ac-border)',
    borderRadius: 12,
    boxShadow: '0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
  },

  // ── 通用内边距卡片 ───────────────────────────────────────
  cardPad: {
    background: 'var(--ac-bgCard)',
    border: '1px solid var(--ac-border)',
    borderRadius: 12,
    padding: '20px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
  },

  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: '2px 8px', borderRadius: 20,
    fontSize: 11, fontWeight: 600,
  },

  btn: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '6px 14px', borderRadius: 8,
    border: '1px solid var(--ac-border)',
    background: 'var(--ac-bgCard)',
    color: 'var(--ac-textSecondary)',
    fontSize: 13, cursor: 'pointer',
    transition: 'all 0.15s', fontFamily: 'inherit',
  },

  input: {
    background: 'var(--ac-bgDeep)',
    border: '1px solid var(--ac-border)',
    borderRadius: 8,
    padding: '6px 12px',
    color: 'var(--ac-textPrimary)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  },

  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(5,8,16,0.85)',
    backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, padding: 20,
  },

  modal: {
    background: 'var(--ac-bgCard)',
    border: '1px solid var(--ac-border)',
    borderRadius: 16,
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
    maxWidth: 560, width: '100%',
    maxHeight: '90vh', overflowY: 'auto',
    fontFamily: '"Noto Sans SC", -apple-system, sans-serif',
  },

  modalHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: '1px solid var(--ac-border)',
    borderRadius: '16px 16px 0 0',
    background: 'var(--ac-bgDeep)',
    flexShrink: 0,
  },

  closeBtn: {
    background: 'none', border: '1px solid var(--ac-border)',
    borderRadius: 6, cursor: 'pointer',
    display: 'flex', alignItems: 'center', padding: 4,
    color: 'var(--ac-textMuted)', transition: 'all 0.15s',
  },

  miniCard: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px',
    background: 'var(--ac-bgDeep)',
    borderRadius: 8, border: '1px solid var(--ac-border)',
  },
};

// ── 辅助函数 ────────────────────────────────────────────────────
// 兼容黑天鹅事件(affectedStocks)和舜帝止损事件(codes)的统一字段访问
function getEventStocks(event) {
  return event?.affectedStocks || event?.codes || [];
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
  if (isNaN(d)) return '-';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
// 兼容舜帝事件(timestamp)和黑天鹅事件(time)
function getEventTime(event) { return event?.time || event?.timestamp; }

function formatDuration(event) {
  const expireAt = event?.expireAt;
  const eventTime = getEventTime(event);
  if (!expireAt) return '永久';
  const expireMs = typeof expireAt === 'number' ? expireAt : Date.parse(expireAt);
  if (isNaN(expireMs)) return '--';
  let startMs;
  if (eventTime == null) {
    startMs = expireMs;
  } else {
    startMs = typeof eventTime === 'number' ? eventTime : Date.parse(eventTime);
    if (isNaN(startMs)) startMs = expireMs;
  }
  const remainingMs = expireMs - startMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '已过期';
  const mins = Math.round(remainingMs / 60000);
  if (mins < 60) return `${mins}分钟`;
  const hrs = Math.round(remainingMs / 3600000);
  if (hrs < 24) return `${hrs}小时`;
  return `${Math.round(remainingMs / 86400000)}天`;
}

// ── 个股迷你卡片（详情弹窗用）────────────────────────────────
function StockMiniCard({ code }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await stockAPI.get(code);
        if (cancelled) return;
        if (data.success) {
          setInfo({ name: data.name || code, price: parseFloat(data.price) || 0,
            change: parseFloat(data.change) || 0, changePercent: parseFloat(data.changePercent) || 0 });
        } else {
          setInfo({ name: code, price: 0, change: 0, changePercent: 0 });
        }
      } catch (_e2) {
        if (!cancelled) setInfo({ name: code, price: 0, change: 0, changePercent: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (loading) {
    return (
      <div style={{ ...S.miniCard, opacity: 0.6 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ac-textFaint)', overflow: 'hidden', minWidth: 0}} />
        <span style={{ fontSize: 12, color: 'var(--ac-textMuted)' }}>加载中…</span>
      </div>
    );
  }

  const up = info?.changePercent > 0;
  const down = info?.changePercent < 0;
  const color = down ? 'var(--ac-red)' : up ? 'var(--ac-green)' : 'var(--ac-textMuted)';

  return (
    <div style={S.miniCard}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--ac-textPrimary)' }}>{info?.name || code}</span>
        <span style={{ fontSize: 11, color: 'var(--ac-textMuted)' }}>{code}</span>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, fontWeight: 'bold', color }}>{info?.price > 0 ? (info.price != null ? Number(info.price).toFixed(2) : '--') : '--'}</div>
        <div style={{ fontSize: 12, color }}>
          {info?.changePercent !== 0 && info?.changePercent != null
            ? `${up ? '+' : ''}${Number(info?.change ?? 0).toFixed(2)} (${up ? '+' : ''}${Number(info?.changePercent ?? 0).toFixed(2)}%)`
            : '--'}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════════════════
export default function BlackSwanHistory() {
  const [C, setC] = useState(themeColors.current);
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sevFilter, setSevFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [searchText, setSearchText] = useState('');
  const [detailEvent, setDetailEvent] = useState(null);
  const [activeTab, setActiveTab] = useState('history');

  // ── 主题跟随 ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => setC(e.detail.C);
    window.addEventListener('fqm-theme-change', handler);
    return () => window.removeEventListener('fqm-theme-change', handler);
  }, []);

  // ── 数据拉取 ────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('bs_detail_event');
      if (saved) { setDetailEvent(JSON.parse(saved)); sessionStorage.removeItem('bs_detail_event'); }
    } catch (_e) { /* ignore */ }
  }, []);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (sevFilter !== 'ALL') params.set('severity', sevFilter);
      if (typeFilter !== 'ALL') params.set('type', typeFilter);
      const data = await blackswanAPI.getHistory(100, sevFilter, typeFilter);
      if (data.success) { setHistory(data.history || []); setSummary(data.summary || null); }
    } catch (_e) { console.error(_e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchHistory(); }, [sevFilter, typeFilter]);

  const filtered = history.filter(e => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return (e.title || '').toLowerCase().includes(q)
      || (e.message || '').toLowerCase().includes(q)
      || getEventStocks(e).some(s => s.toLowerCase().includes(q));
  });

  return (
    <div style={S.page}>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes slideUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .bs-item { animation: slideUp 0.3s ease both; }
        .bs-item:hover { filter: brightness(1.05); }
        .bs-spin { animation: spin 1s linear infinite; }
      `}</style>

      {/* ── 头部 ─────────────────────────────────────────── */}
      <div style={{ padding: '24px 32px 0', borderBottom: '1px solid var(--ac-border)', background: 'var(--ac-bgDeep)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: 'var(--ac-textPrimary)' }}>
              ⚠️ 黑天鹅事件中心
            </h1>
            <p style={{ color: 'var(--ac-textMuted)', fontSize: 14, marginTop: 4 }}>
              全市场黑天鹅事件监控与历史记录
            </p>
          </div>
          <button
            onClick={fetchHistory}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 10,
              background: 'var(--ac-bgCard)', color: C.cyan, border: `1px solid ${C.cyan}`,
              cursor: 'pointer', fontSize: 14, fontWeight: 600,
              boxShadow: `0 0 12px ${C.cyanGlow}`,
            }}
          >
            <RefreshCw size={16} className={loading ? 'bs-spin' : ''} />
            刷新
          </button>
        </div>

        {/* Tab */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[['history', '📋 历史记录'], ['stats', '📊 统计概览']].map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 20px', borderRadius: '8px 8px 0 0',
                border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                background: activeTab === tab ? 'var(--ac-bgCard)' : 'transparent',
                color: activeTab === tab ? 'var(--ac-textPrimary)' : 'var(--ac-textMuted)',
                borderBottom: activeTab === tab ? `2px solid ${C.cyan}` : '2px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '24px 32px' }}>

        {/* ── 统计概览 ──────────────────────────────────── */}
        {activeTab === 'stats' && summary && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, minWidth: 0, overflow: 'hidden'}}>
              {[
                { label: '事件总数',  value: summary.total,  color: 'var(--ac-textPrimary)' },
                { label: '当前活跃',  value: summary.active,  color: 'var(--ac-red)' },
                { label: '🔴 严重',  value: summary.red,     color: 'var(--ac-red)' },
                { label: '🟠 中度',  value: summary.orange,   color: '#f97316' },
                { label: '🟡 轻微',  value: summary.yellow,   color: '#eab308' },
              ].map(item => (
                <div key={item.label} style={{ ...S.cardPad, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: 13, color: 'var(--ac-textMuted)', marginTop: 4 }}>{item.label}</div>
                </div>
              ))}
            </div>

            <div style={{ ...S.cardPad }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: 'var(--ac-textPrimary)' }}>
                📌 事件类型分布
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, minWidth: 0, overflow: 'hidden'}}>
                {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
                  const count = summary.byType?.[type] || 0;
                  const isStoploss = type === 'stoploss';
                  return (
                    <div key={type} style={{
                      ...S.cardPad, textAlign: 'center',
                      background: isStoploss ? 'rgba(249,115,22,0.08)' : cfg.bg,
                      border: `1px solid ${isStoploss ? 'rgba(249,115,22,0.3)' : cfg.border}`,
                    }}>
                      <div style={{ fontSize: 24, marginBottom: 4 }}>{cfg.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: isStoploss ? '#f97316' : cfg.color }}>{count}</div>
                      <div style={{ fontSize: 12, color: 'var(--ac-textMuted)', marginTop: 4 }}>次</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── 历史记录 ──────────────────────────────────── */}
        {activeTab === 'history' && (
          <>
            {/* 过滤器 */}
            <div style={{
              ...S.cardPad, marginBottom: 16,
              display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ac-textMuted)', fontSize: 14 }}>
                <Filter size={14} /> 筛选：
              </div>

              <input
                placeholder="搜索标题/股票代码..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                style={{ ...S.input, width: 200 }}
              />

              {/* 严重级别 */}
              <div style={{ display: 'flex', gap: 6 }}>
                {[['ALL', '全部'], ['RED', SEVERITY_CONFIG.RED.label], ['ORANGE', SEVERITY_CONFIG.ORANGE.label], ['YELLOW', SEVERITY_CONFIG.YELLOW.label]].map(([sev, label]) => (
                  <button
                    key={sev}
                    onClick={() => setSevFilter(sev)}
                    style={{
                      padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: sevFilter === sev ? (sev === 'ALL' ? 'var(--ac-bgHover)' : SEVERITY_CONFIG[sev]?.bg) : 'transparent',
                      color: sevFilter === sev ? (sev === 'ALL' ? 'var(--ac-textPrimary)' : SEVERITY_CONFIG[sev]?.color) : 'var(--ac-textMuted)',
                      border: `1px solid ${sevFilter === sev ? (sev === 'ALL' ? 'var(--ac-borderBright)' : SEVERITY_CONFIG[sev]?.border) : 'var(--ac-border)'}`,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* 类型 */}
              <div style={{ display: 'flex', gap: 6 }}>
                {[['ALL', '全部类型'], ...Object.entries(TYPE_CONFIG).map(([k, v]) => [k, v.label])].map(([type, label]) => {
                  const isStoploss = type === 'stoploss';
                  return (
                    <button
                      key={type}
                      onClick={() => setTypeFilter(type)}
                      style={{
                        padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: typeFilter === type ? (isStoploss ? 'rgba(249,115,22,0.15)' : C.cyanSubtle) : 'transparent',
                        color: typeFilter === type ? (isStoploss ? '#f97316' : C.cyan) : 'var(--ac-textMuted)',
                        border: `1px solid ${typeFilter === type ? (isStoploss ? '#f97316' : C.cyan) : 'var(--ac-border)'}`,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <span style={{ color: 'var(--ac-textMuted)', fontSize: 13, marginLeft: 'auto' }}>
                共 <strong style={{ color: 'var(--ac-textPrimary)' }}>{filtered.length}</strong> 条记录
              </span>
            </div>

            {/* 列表 */}
            {loading ? (
              <div style={{ ...S.cardPad, textAlign: 'center', color: 'var(--ac-textMuted)', padding: '60px' }}>
                加载中…
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ ...S.cardPad, textAlign: 'center', padding: '80px' }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
                <div style={{ fontSize: 15, color: 'var(--ac-textMuted)', marginBottom: 8 }}>暂无黑天鹅事件记录</div>
                <div style={{ fontSize: 13, color: 'var(--ac-textFaint)', marginTop: 8 }}>
                  触发条件：强负面新闻（情绪≤-50%）或个股涨跌幅超过 ±7%<br />
                  当前市场平稳，未达到触发阈值
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filtered.map((event, idx) => {
                  const isStoploss = event.type === 'stoploss';
                  const sev = isStoploss
                    ? (event.severity === 'RED' ? SEVERITY_CONFIG.RED : event.severity === 'ORANGE' ? SEVERITY_CONFIG.ORANGE : SEVERITY_CONFIG.YELLOW)
                    : (SEVERITY_CONFIG[event.severity] || SEVERITY_CONFIG.YELLOW);
                  const isExpired = event.expireAt && Date.now() > event.expireAt;
                  const typeCfg = TYPE_CONFIG[event.type] || { label: event.type, icon: AlertTriangle };
                  const TypeIcon = typeCfg.icon;

                  return (
                    <div
                      key={event.id ? `${event.id}-${idx}` : `fallback-${idx}`}
                      className="bs-item"
                      style={{
                        ...S.card,
                        padding: '16px 20px',
                        borderLeft: `4px solid ${isExpired ? 'var(--ac-textFaint)' : sev.color}`,
                        opacity: isExpired ? 0.65 : 1,
                        display: 'flex', alignItems: 'flex-start', gap: 16,
                        cursor: 'pointer',
                        border: `1px solid ${isExpired ? 'var(--ac-border)' : sev.border}`,
                      }}
                      onClick={() => setDetailEvent(event)}
                    >
                      {/* 左侧图标 */}
                      <div style={{
                        width: 44, height: 44, borderRadius: 10,
                        background: sev.bg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                        overflow: 'hidden',
                        minWidth: 0
                    }}>
                        <TypeIcon size={20} color={isExpired ? 'var(--ac-textMuted)' : sev.color} />
                      </div>

                      {/* 中间内容 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{
                            ...S.badge,
                            background: sev.bg, color: sev.color, border: `1px solid ${sev.border}`,
                          }}>
                            {sev.label}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--ac-textMuted)' }}>{typeCfg.label}</span>
                          {isExpired && (
                            <span style={{ ...S.badge, background: 'var(--ac-bgHover)', color: 'var(--ac-textMuted)', border: '1px solid var(--ac-border)' }}>
                              已过期
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: 'var(--ac-textPrimary)' }}>
                          {event.title}
                        </div>
                        {/* 【FIX-2026-05-06】stoploss事件:优先用解析出的字段,避免显示desc中的"止损价¥N/A" */}
                        {isStoploss ? (() => {
                          const curP = event.currentPrice;
                          const stopP = event.stopPrice;
                          const pctRaw = (() => {
                            const m = (event.message || event.desc || '').match(/盈亏([+-]?[\d.]+)%/);
                            return m ? parseFloat(m[1]) : null;
                          })();
                          const pctColor = pctRaw !== null ? (pctRaw >= 0 ? '#ef4444' : '#22c55e') : 'var(--ac-textSecondary)';
                          return (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center' }}>
                              {curP != null && (
                                <span style={{ fontSize: 13, color: 'var(--ac-textSecondary)' }}>
                                  当前价 <strong style={{ color: 'var(--ac-textPrimary)' }}>¥{curP.toFixed(2)}</strong>
                                </span>
                              )}
                              {stopP != null ? (
                                <span style={{ fontSize: 13, color: '#f97316', fontWeight: 600 }}>
                                  止损价 <strong>¥{stopP.toFixed(2)}</strong>
                                </span>
                              ) : (
                                <span style={{ fontSize: 13, color: '#ef4444' }}>止损价 <strong>N/A</strong></span>
                              )}
                              {pctRaw !== null && (
                                <span style={{ fontSize: 13, color: pctColor, fontWeight: 600 }}>
                                  {pctRaw >= 0 ? '+' : ''}{pctRaw.toFixed(2)}%
                                </span>
                              )}
                            </div>
                          );
                        })() : (
                          <div style={{ fontSize: 13, color: 'var(--ac-textSecondary)', lineHeight: 1.5 }}>
                            {event.message ? event.message.slice(0, 80) + (event.message.length > 80 ? '…' : '') : event.desc || ''}
                          </div>
                        )}
                        {getEventStocks(event).length > 0 && (
                          <div style={{ marginTop: 6, fontSize: 12, color: C.cyan }}>
                            涉及股票：{getEventStocks(event).join('、')}
                          </div>
                        )}
                      </div>

                      {/* 右侧时间和周期 */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--ac-textMuted)', marginBottom: 4 }}>
                          {formatTime(getEventTime(event))}
                        </div>
                        <div style={{
                          ...S.badge,
                          background: `${C.cyan}22`, color: C.cyan,
                          border: `1px solid ${C.cyan}55`,
                        }}>
                          ⏱ {event.impactPeriod || (isStoploss ? '止损' : formatDuration(event))}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ac-textFaint)', marginTop: 4 }}>
                          危险 {event.score}/100
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 详情弹窗 ──────────────────────────────────────── */}
      {detailEvent && (
        <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) setDetailEvent(null); }}>
          <div style={S.modal}>
            <div style={S.modalHeader}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--ac-textPrimary)' }}>
                事件详情
              </h2>
              <button onClick={() => setDetailEvent(null)} style={S.closeBtn}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: 24 }}>
              {(() => {
                const sev = SEVERITY_CONFIG[detailEvent.severity] || SEVERITY_CONFIG.YELLOW;
                const typeCfg = TYPE_CONFIG[detailEvent.type] || { label: detailEvent.type };
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* 标题行 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ ...S.badge, background: sev.bg, color: sev.color, border: `1px solid ${sev.border}` }}>
                        {sev.label}
                      </span>
                      <span style={{ color: 'var(--ac-textSecondary)', fontSize: 13 }}>{typeCfg.label}</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--ac-textMuted)', fontSize: 13 }}>
                        {formatTime(detailEvent.time)}
                      </span>
                    </div>

                    {/* 标题 */}
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ac-textPrimary)' }}>
                      {detailEvent.title}
                    </div>

                    {/* 消息 */}
                    <div style={{
                      ...S.card,
                      padding: 14, fontSize: 14, color: 'var(--ac-textSecondary)', lineHeight: 1.6,
                    }}>
                      {detailEvent.message || detailEvent.desc || ''}
                    </div>

                    {/* 涉及个股 */}
                    {getEventStocks(detailEvent).length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--ac-textMuted)', marginBottom: 8 }}>📊 涉及个股</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {getEventStocks(detailEvent).slice(0, 5).map(code => (
                            <StockMiniCard key={code} code={code} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 信息卡片 */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, minWidth: 0, overflow: 'hidden'}}>
                      {[
                        ...(detailEvent.type === 'stoploss' ? [
                          { label: '止损价格', value: detailEvent.stopPrice ? `¥${detailEvent.stopPrice.toFixed(2)}` : '—', highlight: true },
                          { label: '当前价格', value: detailEvent.currentPrice ? `¥${detailEvent.currentPrice.toFixed(2)}` : '—' },
                        ] : []),
                        { label: '危险评分', value: `${detailEvent.score}/100` },
                        { label: '影响周期', value: detailEvent.impactPeriod || (detailEvent.type === 'stoploss' ? '止损' : formatDuration(detailEvent)) },
                        { label: '建议操作', value: ACTION_LABELS[detailEvent.action] || (detailEvent.type === 'stoploss' ? '止损预警' : detailEvent.action || '—') },
                        { label: '涉及股票', value: getEventStocks(detailEvent).join('、') || '全市场' },
                        { label: '发生时间', value: formatTime(getEventTime(detailEvent)) },
                        { label: '失效时间', value: detailEvent.expireAt ? formatTime(detailEvent.expireAt) : '永久' },
                      ].map(item => (
                        <div key={item.label} style={{
                          ...S.card, padding: 12,
                          background: item.highlight ? 'rgba(239,68,68,0.08)' : undefined,
                          border: item.highlight ? '1px solid rgba(239,68,68,0.3)' : undefined,
                        }}>
                          <div style={{ fontSize: 11, color: 'var(--ac-textMuted)', marginBottom: 4 }}>{item.label}</div>
                          <div style={{
                            fontSize: 13, fontWeight: 600,
                            color: item.highlight ? '#ef4444' : 'var(--ac-textPrimary)'
                          }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* 触发说明 */}
                    {detailEvent.type === 'price_crash' && (
                      <div style={{ ...S.card, padding: 12, fontSize: 13, color: 'var(--ac-textSecondary)', lineHeight: 1.6 }}>
                        <div style={{ fontSize: 11, color: 'var(--ac-textMuted)', marginBottom: 6 }}>⚡ 触发说明</div>
                        跌幅 ≥7% 触发黑天鹅预警。{detailEvent.severity === 'RED' ? '跌幅 ≥10%，危险等级最高' : '跌幅 7%~10%，危险等级较高'}。
                        {detailEvent.action === 'emergency_stop' ? '建议立即止损出局。' : detailEvent.action === 'strong_sell' ? '建议逢高减仓。' : '建议关注回避。'}
                      </div>
                    )}
                    {detailEvent.type === 'price_surge' && (
                      <div style={{ ...S.card, padding: 12, fontSize: 13, color: 'var(--ac-textSecondary)', lineHeight: 1.6 }}>
                        <div style={{ fontSize: 11, color: 'var(--ac-textMuted)', marginBottom: 6 }}>🚀 触发说明</div>
                        涨幅 ≥9% 接近涨停板，追高风险极大。历史数据显示，追涨停失败后 3 日内平均回撤超过 8%。建议不要追高，等待回调确认后再评估。
                      </div>
                    )}
                    {detailEvent.type === 'news' && (
                      <div style={{ ...S.card, padding: 12, fontSize: 13, color: 'var(--ac-textSecondary)', lineHeight: 1.6 }}>
                        <div style={{ fontSize: 11, color: 'var(--ac-textMuted)', marginBottom: 6 }}>📰 触发说明</div>
                        系统监测到重大负面/异常新闻，情绪冲击强度 {detailEvent.score}。{detailEvent.action === 'forbidden_buy' ? '建议持有者立即减仓，空仓者禁止买入。' : '建议密切关注，及时调整仓位。'}
                      </div>
                    )}

                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
