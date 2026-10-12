import { useState, useEffect, useRef, useCallback } from 'react';
import { holdingAPI, capitalAPI, indicatorAPI, batchConfidenceAPI, stockAPI } from '../config/api';
import { analyzeHolding, optimizePortfolio } from '../services/yaodiAnalysis';
// 做T建议 & 组合优化 改用尧帝AI分析（原技术指标规则引擎已弃用）
import { Brain, X, Zap, TrendingUp, TrendingDown, Shield, BarChart2, AlertTriangle, TrendingUpIcon, Plus, Search } from 'lucide-react';
import MainFlowChart from '../components/common/MainFlowChart';

// ─── 持仓卡片 ────────────────────────────────────────────────
function HoldingCard({ holding, onAction, confidence, mainFlow }) {
  // 字段映射：统一后端返回的字段名
  const h = {
    ...holding,
    price: holding.realtime_price && holding.realtime_price > 0 ? holding.realtime_price : holding.current_price || holding.price,
    quantity: holding.shares || holding.quantity,
    cost: holding.cost_price || holding.cost,
  };
  
  const profit = (h.price - h.cost) * h.quantity;
  const profitPct = h.cost > 0 ? ((h.price - h.cost) / h.cost) * 100 : 0;
  const isUp = profit >= 0;

  // 【P0新增】交易决策原因
  const tradeReason = holding.reason || holding.strategy || null;

  // 主力资金数据
  const mf = mainFlow;
  const mfInflow = mf?.main_inflow || 0;
  const mfColor = mfInflow >= 0 ? '#ef4444' : '#22c55e';
  const mfText = mfInflow >= 0 ? '净入' : '净出';
  const mfAbs = Math.abs(mfInflow);
  const mfDisplay = mfAbs >= 1e8 ? (mfInflow / 1e8).toFixed(2) + '亿' : mfAbs >= 1e4 ? (mfInflow / 1e4).toFixed(0) + '万' : mfInflow.toFixed(0);

  return (
    <div className="holding-card">
      <div className="holding-header">
        <div className="holding-info">
          <h4 className="holding-name">{holding.name}</h4>
          <span className="holding-code">{holding.code}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="badge badge-info">{h.quantity}股</span>
          {holding.sector && (
            <span className="badge" style={{ background: 'rgba(99,102,241,0.2)', color: '#6366f1', fontSize: '11px', fontWeight: '600' }}>
              {holding.sector}
            </span>
          )}
          {confidence != null && (
            <span className="badge" style={{
              background: confidence >= 75 ? 'rgba(52,199,89,0.2)' : confidence >= 60 ? 'rgba(255,149,0,0.2)' : 'rgba(255,59,48,0.2)',
              color: confidence >= 75 ? 'var(--accent-green)' : confidence >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)',
              fontSize: '11px',
              fontWeight: '600'
            }}>
              置信{(confidence ?? 0).toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      <div className="holding-price-row">
        <div>
          <span className="holding-label">现价</span>
          <span className="holding-price">{h.price != null ? Number(h.price).toFixed(2) : '--'}</span>
        </div>
        <div>
          <span className="holding-label">成本</span>
          <span className="holding-cost">{h.cost != null ? Number(h.cost).toFixed(2) : '--'}</span>
        </div>
      </div>

      <div className="holding-profit-row">
        <div className={`profit-value ${isUp ? 'up' : 'down'}`}>
          <span className="profit-amount">{isUp ? '+' : ''}{((profit ?? 0) / 10000).toFixed(2)}万</span>
          <span className="profit-pct">{isUp ? '+' : ''}{(profitPct ?? 0).toFixed(2)}%</span>
        </div>
        <div className="holding-market-value">
          市值 ¥{Number((h.price || 0) * (h.quantity || 0) / 10000).toFixed(2)}万
        </div>
      </div>

      {/* 主力资金标签 */}
      {mf && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 8, padding: '5px 10px',
          background: mfInflow >= 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
          borderRadius: 6, fontSize: 12
        }}>
          <span style={{ color: mfColor, fontWeight: 600 }}>
            主力{mfText}{mfDisplay}
          </span>
          {mf.strengthClass && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: 11 }}>
              <span>主力强度{mf.mainStrength != null ? `${mf.mainStrength}%` : `${Number(mf.main_ratio).toFixed(1)}%`}</span>
              <span style={{
                color: mf.strengthClass === '抢筹' ? '#ef4444' : mf.strengthClass === '建仓' ? '#ef4444' : mf.strengthClass === '洗盘' ? '#f97316' : mf.strengthClass === '出货' ? '#22c55e' : '#facc15',
                fontWeight: 700, fontSize: 10
              }}>[{mf.strengthClass}]</span>
            </span>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="holding-actions">
        <button
          className="btn-analyze"
          onClick={() => onAction?.('dayt', h)}
          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
        >
          <Zap size={13} />
          做T建议
        </button>
        <button
          className="btn-analyze"
          onClick={() => onAction?.('analyze', h)}
        >
          <Brain size={13} />
          尧帝分析
        </button>
        <button
          className="btn-analyze"
          onClick={() => onAction?.('mainFlow', h)}
          style={{ background: 'linear-gradient(135deg, #ec4899, #f43f5e)' }}
        >
          💰主力
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onAction?.('edit', h)}
        >
          买入
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onAction?.('sell', h)}
        >
          卖出
        </button>
      </div>

      {/* 【P0新增】交易决策原因 */}
      {tradeReason && (
        <div style={{ 
          marginTop: 8, 
          padding: '6px 10px', 
          background: 'rgba(99,102,241,0.1)', 
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--text-secondary)',
          borderLeft: '3px solid #6366f1'
        }}>
          <span style={{ color: '#6366f1', fontWeight: 600 }}>决策:</span> {tradeReason}
        </div>
      )}
    </div>
  );
}

// ─── 尧帝分析弹窗 ─────────────────────────────────────────────

// ─── 添加持仓弹窗 ─────────────────────────────────────────────
function AddHoldingModal({ isOpen, onClose, onAdded }) {
  const [step, setStep] = useState('search'); // search | form
  const [keyword, setKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [shares, setShares] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [adding, setAdding] = useState(false);

  // 实时搜索（防抖300ms）
  useEffect(() => {
    if (!keyword.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await stockAPI.search(keyword.trim(), 50);
        const raw = Array.isArray(data) ? data : (data.stocks || []);
        // 去重：stocks 表存在重复 code 行，避免 React key 冲突
        const seen = new Set();
        const deduped = raw.filter(s => {
          if (!s || s.code == null) return false;
          if (seen.has(s.code)) return false;
          seen.add(s.code);
          return true;
        });
        setSearchResults(deduped);
      } catch (e) { console.error(e); }
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  const handleSelect = async (stock) => {
    setSelected(stock);
    setShares('');
    setCostPrice(stock.price > 0 ? String(stock.price) : '');
    setStep('form');
    // 选中后拉实时股价（覆盖搜索列表中的价格）
    try {
            const d = await stockAPI.get(stock.code);
      if (d?.price) setCostPrice(String(d.price));
    } catch(e) { /* 静默 */ }
  };

  const handleAdd = async () => {
    const qty = parseInt(shares);
    const price = parseFloat(costPrice);
    if (!selected || !qty || qty < 100 || !price) return;
    setAdding(true);
    try {
      await holdingAPI.add(selected.code, selected.name, qty, price);
      // 买入后：扣除可用资金，新增持仓市值，总资产不变
      const buyAmount = qty * price;
      try {
        const capCfg = await capitalAPI.getConfig();
        const currentAvail = capCfg?.available_capital || capCfg?.config?.available_capital || 0;
        await capitalAPI.setConfig({ available_capital: Math.max(0, currentAvail - buyAmount) });
      } catch (_) { /* 资金更新失败不阻断买入流程 */ }
      onAdded?.();
      onClose();
    } catch (e) { console.error(e); }
    setAdding(false);
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}>
      <div style={{ background: 'var(--bg-primary)', borderRadius: '16px', width: '420px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden', minWidth: 0
    }}>
        {/* 头部 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '16px', fontWeight: '700' }}>
            {step === 'search' ? '🔍 搜索股票' : `添加 ${selected?.name}(${selected?.code})`}
          </span>
          <button onClick={() => { if (step === 'form') setStep('search'); else onClose(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px' }}>
          {step === 'search' ? (
            <>
              <div style={{ marginBottom: '16px' }}>
                <input
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  placeholder="输入股票代码或名称搜索..."
                  autoFocus
                  style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {searchResults.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '30px 0' }}>
                    输入代码或名称搜索股票
                  </div>
                ) : searchResults.map(s => (
                  <div key={s.code} onClick={() => handleSelect(s)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', marginBottom: '4px', background: 'var(--bg-secondary)', transition: 'background 0.15s', overflow: 'hidden', minWidth: 0
    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  >
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--text-primary)' }}>{s.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{s.code}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '600', fontSize: '14px' }}>¥{s.price != null ? Number(s.price).toFixed(2) : '--'}</div>
                      <div style={{ fontSize: '12px', color: (s.changePercent || 0) >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                        {(s.changePercent || 0) >= 0 ? '+' : ''}{Number(s.changePercent || 0).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', overflow: 'hidden', minWidth: 0
    }}>
                <div>
                  <div style={{ fontWeight: '700' }}>{selected?.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{selected?.code} · 现价 ¥{selected?.price != null ? Number(selected.price).toFixed(2) : '--'}</div>
                </div>
                <div style={{ fontSize: '18px', fontWeight: '700' }}>¥{selected?.price != null ? Number(selected.price).toFixed(2) : '--'}</div>
              </div>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>买入数量（股）</label>
                <input type="number" value={shares} min="100" step="100" onChange={e => setShares(Math.max(100, parseInt(e.target.value) || 100))} placeholder="最低100股" style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', overflow: 'hidden', minWidth: 0
    }} />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>买入价格（元）</label>
                <input type="number" step="0.01" value={costPrice} onChange={e => setCostPrice(e.target.value)} placeholder="如 10.50" style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', overflow: 'hidden', minWidth: 0
    }} />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setStep('search')} style={{ flex: 1, padding: '10px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: '600', overflow: 'hidden', minWidth: 0
    }}>返回</button>
                <button onClick={handleAdd} disabled={adding || !shares || !costPrice} style={{ flex: 2, padding: '10px', border: 'none', borderRadius: '10px', background: 'var(--accent-blue)', color: 'white', cursor: adding ? 'wait' : 'pointer', fontWeight: '600', opacity: (!shares || !costPrice) ? 0.5 : 1, overflow: 'hidden', minWidth: 0
    }}>
                  {adding ? '添加中...' : '确认添加'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 编辑持仓弹窗 ────────────────────────────────────────────────
function EditHoldingModal({ holding, isOpen, onClose, onSave }) {
  const [shares, setShares] = useState(holding?.shares || 0);
  const [costPrice, setCostPrice] = useState(holding?.cost_price || 0);
  
  useEffect(() => {
    if (holding) {
      setShares(holding.shares || 0);
      setCostPrice(holding.cost_price || 0);
    }
  }, [holding]);
  
  if (!isOpen || !holding) return null;
  
  const handleSave = () => {
    onSave(holding.code, { 
      shares: parseInt(shares), 
      cost_price: parseFloat(costPrice) 
    });
    onClose();
  };
  
  return (
    <div className="hm-overlay" onClick={onClose}>
      <div className="hm-panel" onClick={e => e.stopPropagation()} style={{ width: '400px', maxWidth: '90vw' }}>
        <div className="hm-header">
          <div className="hm-header-left">
            <div className="hm-brain-icon" style={{ background: 'linear-gradient(135deg, #007AFF, #5856D6)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </div>
            <div>
              <div className="hm-title">买入</div>
              <div className="hm-subtitle">{holding.name}（{holding.code}）</div>
            </div>
          </div>
          <button className="hm-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        
        <div className="hm-body" style={{ padding: '20px' }}>
          {/* 持仓数量 */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '13px', 
              fontWeight: '600',
              color: 'var(--text-secondary)',
              marginBottom: '8px'
            }}>
              持仓数量（股）
            </label>
            <input
              type="number"
              value={shares}
              onChange={e => setShares(Math.max(100, parseInt(e.target.value) || 100))}
              min="100"
              step="100"
              style={{
                width: '100%',
                padding: '12px 16px',
                fontSize: '16px',
                fontWeight: '500',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                outline: 'none',
                transition: 'border-color 0.2s',
overflow: 'hidden',
      minWidth: 0
    }}
              onFocus={e => e.target.style.borderColor = 'var(--accent-blue)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
            />
          </div>
          
          {/* 成本价 */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              fontSize: '13px', 
              fontWeight: '600',
              color: 'var(--text-secondary)',
              marginBottom: '8px'
            }}>
              成本价（元）
            </label>
            <input
              type="number"
              step="0.01"
              value={costPrice}
              onChange={e => setCostPrice(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 16px',
                fontSize: '16px',
                fontWeight: '500',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                outline: 'none',
                transition: 'border-color 0.2s',
overflow: 'hidden',
      minWidth: 0
    }}
              onFocus={e => e.target.style.borderColor = 'var(--accent-blue)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
            />
          </div>
          
          {/* 持仓市值预览 */}
          <div style={{
            padding: '16px',
            background: 'var(--bg-secondary)',
            borderRadius: '10px',
            marginBottom: '20px',
overflow: 'hidden',
      minWidth: 0
    }}>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
              持仓市值预览
            </div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)' }}>
              ¥{((shares || 0) * (holding.realtime_price && holding.realtime_price > 0 ? holding.realtime_price : holding.current_price || 0)).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
              现价 ¥{Number(holding.realtime_price && holding.realtime_price > 0 ? holding.realtime_price : holding.current_price || 0).toFixed(2)} × {shares || 0}股
            </div>
          </div>
          
          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: '12px',
                fontSize: '14px',
                fontWeight: '600',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
overflow: 'hidden',
      minWidth: 0
    }}
            >
              取消
            </button>
            <button
              onClick={handleSave}
              style={{
                flex: 1,
                padding: '12px',
                fontSize: '14px',
                fontWeight: '600',
                border: 'none',
                borderRadius: '10px',
                background: 'var(--accent-blue)',
                color: 'white',
                cursor: 'pointer',
overflow: 'hidden',
      minWidth: 0
    }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function HoldingAnalysisModal({ holding, isOpen, onClose }) {
  const [result, setResult] = useState(null);
  const [indicators, setIndicators] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !holding) return;
    setLoading(true);
    setResult(null);
    setIndicators(null);
    setError(null);
    
    Promise.all([
      analyzeHolding(holding),
      indicatorAPI.get(holding.code).catch(() => null)
    ])
      .then(([r, ind]) => { 
        setResult(r); 
        setIndicators(ind?.success ? ind.indicators : null);
        setLoading(false); 
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [isOpen, holding?.code]);

  if (!isOpen || !holding) return null;

  const colorMap = {
    green:  { bg: 'rgba(52,199,89,0.1)',   color: 'var(--accent-green)',  border: 'rgba(52,199,89,0.25)'  },
    red:    { bg: 'rgba(255,59,48,0.1)',    color: 'var(--accent-red)',    border: 'rgba(255,59,48,0.25)'  },
    blue:   { bg: 'rgba(0,122,255,0.1)',    color: 'var(--accent-blue)',   border: 'rgba(0,122,255,0.25)'  },
    yellow: { bg: 'rgba(255,149,0,0.1)',    color: 'var(--accent-orange)', border: 'rgba(255,149,0,0.25)'  },
    orange: { bg: 'rgba(255,149,0,0.1)',    color: 'var(--accent-orange)', border: 'rgba(255,149,0,0.25)'  },
    purple: { bg: 'rgba(114,46,209,0.1)',   color: 'var(--accent-purple)', border: 'rgba(114,46,209,0.25)' },
  };
  const sc = colorMap[result?.suggestionColor] || colorMap.blue;
  const profitPct = parseFloat(result?.profitPct) || 0;
  const isUp = profitPct >= 0;

  return (
    <div className="hm-overlay" onClick={onClose}>
      <div className="hm-panel" onClick={e => e.stopPropagation()}>

        {/* 头部 */}
        <div className="hm-header">
          <div className="hm-header-left">
            <div className="hm-brain-icon">
              <Brain size={20} color="white" />
            </div>
            <div>
              <div className="hm-title">尧帝智能分析</div>
              <div className="hm-subtitle">
                {holding.name}（{holding.code}）· {holding.quantity || holding.shares || 0}股
              </div>
            </div>
          </div>
          <button className="hm-close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* 内容 */}
        <div className="hm-body">

          {/* 加载中 */}
          {loading && (
            <div className="hm-loading">
              <div className="hm-loading-icon">
                <Brain size={28} color="var(--accent-purple)" />
              </div>
              <p>尧帝正在分析持仓...</p>
              <span>调用分支智能体投票中</span>
            </div>
          )}

          {/* 错误 */}
          {!loading && error && (
            <div className="hm-loading">
              <AlertTriangle size={32} color="var(--text-tertiary)" />
              <p>分析失败</p>
              <span>{error}</span>
            </div>
          )}

          {/* 结果 */}
          {!loading && result && (
            <>
              {/* 盈亏横幅 */}
              <div className="hm-profit-banner" style={{
                background: isUp
                  ? 'linear-gradient(135deg,rgba(52,199,89,0.1),rgba(52,199,89,0.04))'
                  : 'linear-gradient(135deg,rgba(255,59,48,0.1),rgba(255,59,48,0.04))',
                border: `1px solid ${isUp ? 'rgba(52,199,89,0.2)' : 'rgba(255,59,48,0.2)'}`,
              }}>
                <div className="hm-profit-main">
                  <span className={`hm-profit-pct ${isUp ? 'up' : 'down'}`}>
                    {isUp ? '+' : ''}{(profitPct ?? 0).toFixed(2)}%
                  </span>
                  <span className="hm-profit-label">
                    {isUp ? '盈利' : '亏损'} ¥{Math.abs((result.profitAmount || 0) / 10000).toFixed(2)}万
                  </span>
                </div>
                <div className="hm-profit-detail">
                  <span>成本 ¥{Number(result.costPrice || holding.cost || holding.cost_price || 0).toFixed(2)}</span>
                  <span>现价 ¥{Number(result.currentPrice || holding.price || holding.realtime_price && holding.realtime_price > 0 ? holding.realtime_price : holding.current_price || 0).toFixed(2)}</span>
                  <span>市值 ¥{(((result.currentPrice || 0) * (result.shares || holding.shares || 0)) / 10000).toFixed(2)}万</span>
                </div>
              </div>

              {/* 尧帝建议 */}
              <div className="hm-suggestion" style={{ background: sc.bg, border: `1px solid ${sc.border}` }}>
                <div className="hm-suggestion-row">
                  <Zap size={16} color={sc.color} />
                  <span className="hm-suggestion-action" style={{ color: sc.color }}>
                    {result.suggestion}
                  </span>
                  {result.urgency === 'high' && (
                    <span className="badge badge-error" style={{ marginLeft: 'auto' }}>紧急</span>
                  )}
                </div>
                <p className="hm-suggestion-reason">{result.suggestionReason}</p>
              </div>

              {/* 四项指标 */}
              <div className="hm-metrics">
                {[
                  { label: '尧帝准确率', value: `${result.yaodi?.accuracy != null ? Number(result.yaodi.accuracy).toFixed(1) : '--'}%`, color: 'var(--accent-purple)' },
                  { label: '尧帝胜率',   value: `${result.yaodi?.winRate != null ? Number(result.yaodi.winRate).toFixed(1) : '--'}%`,  color: 'var(--accent-blue)'   },
                  { label: '分支投票',   value: `${result.votingBranches ?? 0}个`,                color: 'var(--text-primary)'  },
                  { label: '夏普比率',   value: `${result.yaodi?.sharpeRatio != null ? Number(result.yaodi.sharpeRatio).toFixed(2) : '--'}`, color: 'var(--text-primary)'  },
                ].map(m => (
                  <div key={m.label} className="hm-metric">
                    <span className="hm-metric-label">{m.label}</span>
                    <span className="hm-metric-value" style={{ color: m.color }}>{m.value}</span>
                  </div>
                ))}
              </div>

              {/* 五因子雷达图（V2引擎） */}
              {result.yaodi?.v2?.factors && (
                <div style={{ margin: '12px 0', padding: '10px', background: 'rgba(99,102,241,0.05)', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.15)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                    🎯 尧帝五维评分 {result.yaodi.v2.factors?.l1TotalScore != null ? `· 综合 ${result.yaodi.v2.factors.l1TotalScore}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px' }}>
                    {[
                      { label: '价值', key: 'valueScore', icon: '💎' },
                      { label: '动量', key: 'growthScore', icon: '📈' },
                      { label: '质量', key: 'qualityScore', icon: '🏆' },
                      { label: '波动', key: 'volatilityScore', icon: '🌊' },
                      { label: '市值', key: 'sizeScore', icon: '🏢' },
                    ].map(f => {
                      const val = result.yaodi.v2.factors[f.key] || 0;
                      const pct = Math.min(100, Math.max(0, val));
                      const color = pct >= 70 ? '#22c55e' : pct >= 50 ? '#6366f1' : '#f59e0b';
                      return (
                        <div key={f.key} style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '2px' }}>{f.label}</div>
                          <div style={{ height: '16px', background: 'var(--bg-card)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: pct + '%', background: color, transition: 'width 0.3s', borderRadius: '3px' }} />
                          </div>
                          <div style={{ fontSize: '10px', fontWeight: '600', color, marginTop: '1px' }}>{val}</div>
                        </div>
                      );
                    })}
                  </div>
                  {/* 额外V2指标 */}
                  {result.yaodi.v2.l2Score != null && (
                    <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {result.yaodi.v2.l2Rank != null && <span>L2排名 #{result.yaodi.v2.l2Rank}</span>}
                      {result.yaodi.v2.signalStatus && <span>信号状态: {result.yaodi.v2.signalStatus}</span>}
                      {result.yaodi.v2.kellyPct != null && <span>凯利仓位 {result.yaodi.v2.kellyPct}%</span>}
                    </div>
                  )}
                </div>
              )}

              {/* 止盈止损 */}
              <div className="hm-price-zones">
                <div className="hm-zone">
                  <TrendingUp size={14} color="var(--accent-red)" />
                  <span className="hm-zone-label">止盈价</span>
                  <span className="hm-zone-value up">¥{result.takeProfitPrice ?? '--'}</span>
                </div>
                <div className="hm-zone">
                  <TrendingDown size={14} color="var(--accent-green)" />
                  <span className="hm-zone-label">止损价</span>
                  <span className="hm-zone-value down">¥{result.stopLossPrice ?? '--'}</span>
                </div>
                {result.moveUpStop && (
                  <div className="hm-zone">
                    <Shield size={14} color="var(--accent-blue)" />
                    <span className="hm-zone-label">移动止损</span>
                    <span className="hm-zone-value" style={{ color: 'var(--accent-blue)' }}>¥{result.moveUpStop}</span>
                  </div>
                )}
              </div>

              {/* 技术分析 */}
              {indicators ? (
                <div className="hm-tech">
                  <div className="hm-tech-title">
                    <BarChart2 size={14} />
                    实时技术指标
                  </div>
                  
                  {/* MA */}
                  {indicators.ma && (
                    <div className="hm-tech-row">
                      <span className="hm-tech-name">均线(MA)</span>
                      <span className="hm-tech-signal">
                        5:{indicators.ma.MA5} 10:{indicators.ma.MA10} 20:{indicators.ma.MA20}
                      </span>
                    </div>
                  )}
                  
                  {/* MACD */}
                  {indicators.macd && (
                    <div className="hm-tech-row">
                      <span className="hm-tech-name">MACD</span>
                      <span className={`hm-tech-signal ${indicators.macd.signal === '多头' ? 'up' : 'down'}`}>
                        {indicators.macd.signal} ({indicators.macd.DIF})
                      </span>
                    </div>
                  )}
                  
                  {/* RSI */}
                  {indicators.rsi && (
                    <div className="hm-tech-row">
                      <span className="hm-tech-name">RSI</span>
                      <span className={`hm-tech-signal ${indicators.rsi.signal === '强势' ? 'up' : 'down'}`}>
                        {indicators.rsi.signal} ({indicators.rsi.RSI})
                      </span>
                    </div>
                  )}
                  
                  {/* KDJ */}
                  {indicators.kdj && (
                    <div className="hm-tech-row">
                      <span className="hm-tech-name">KDJ</span>
                      <span className={`hm-tech-signal ${indicators.kdj.signal === '超买' ? 'up' : indicators.kdj.signal === '超卖' ? 'down' : ''}`}>
                        {indicators.kdj.signal}
                      </span>
                    </div>
                  )}
                  
                  {/* 布林带 */}
                  {indicators.boll && (
                    <div className="hm-tech-row">
                      <span className="hm-tech-name">布林带</span>
                      <span className="hm-tech-signal">
                        中:{indicators.boll.MID} 上:{indicators.boll.UPPER} 下:{indicators.boll.LOWER}
                      </span>
                    </div>
                  )}
                </div>
              ) : result.techSummaries?.length > 0 && (
                <div className="hm-tech">
                  <div className="hm-tech-title">
                    <BarChart2 size={14} />
                    技术分析（{result.techSummaries.length}个指标）
                  </div>
                  {result.techSummaries.slice(0, 6).map((t, i) => (
                    <div key={i} className="hm-tech-row">
                      <span className="hm-tech-name">{t.name || t.indicator}</span>
                      <span className={`hm-tech-signal ${
                        (t.signal || '').includes('买') || (t.signal || '').includes('多') ? 'up' : 'down'
                      }`}>
                        {t.signal || '中性'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────
export default function Holding() {
  const [holdings, setHoldings] = useState([]);
  const [capital, setCapital] = useState(null);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const [analysisTarget, setAnalysisTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [daytTarget, setDaytTarget] = useState(null);
  const [daytData, setDaytData] = useState(null);
  const [daytLoading, setDaytLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false); // 添加持仓弹窗
  const [confidenceMap, setConfidenceMap] = useState({}); // 置信度缓存
  const [showCapitalModal, setShowCapitalModal] = useState(false); // 可用资产编辑弹窗
  const [inputAvailableCapital, setInputAvailableCapital] = useState(''); // 输入的可用资产
  const [portfolio, setPortfolio] = useState(null); // 组合优化
  const [holdingStats, setHoldingStats] = useState(null); // 持仓统计
  const [showPortfolio, setShowPortfolio] = useState(false); // 展示组合优化
  const [sellTarget, setSellTarget] = useState(null); // 卖出弹窗目标
  const [sellPrice, setSellPrice] = useState(''); // 卖出价格
  const [sellShares, setSellShares] = useState(''); // 卖出数量
  const [selling, setSelling] = useState(false); // 卖出中
  const [riskAnalysis, setRiskAnalysis] = useState(null); // 集中度风险分析
  const [showRiskPanel, setShowRiskPanel] = useState(false); // 风险面板展开
  const [mainFlowTarget, setMainFlowTarget] = useState(null); // 主力资金弹窗目标
  const [mainFlowMap, setMainFlowMap] = useState({}); // 主力资金缓存(code -> data)

  const fetchData = useCallback(async () => {
    try {
      if (!initialLoadDone.current) setLoading(true);
      const [hData, cRes, batchConf, portRes, statsRes, riskRes] = await Promise.all([
                    holdingAPI.getList(),
        capitalAPI.getConfig(),
        batchConfidenceAPI.get().catch(() => ({ stocks: [] })),
        // 组合优化改用尧帝AI，不再调用后端 /api/portfolio/optimize
        Promise.resolve(null),
              holdingAPI.getStats().catch(() => null),
              holdingAPI.getRiskAnalysis().catch(() => null),
      ]);
      if (hData.success) setHoldings(hData.holdings || []);
      if (cRes.success) setCapital(cRes.config);
      
      // 构建置信度map
      if (batchConf.stocks) {
        const confMap = {};
        batchConf.stocks.forEach(s => {
          confMap[s.code] = s.confidence;
        });
        setConfidenceMap(confMap);
      }
      // 组合优化：尧帝AI分析（异步，不阻塞初始加载）
      if (hData.success && hData.holdings?.length > 0) {
        optimizePortfolio(hData.holdings).then(portData => {
          if (portData?.success) setPortfolio(portData.portfolio);
        }).catch(e => console.error('尧帝AI组合优化失败:', e));
      }
      if (statsRes?.success) setHoldingStats(statsRes.stats || statsRes);
      if (riskRes?.success) setRiskAnalysis(riskRes.data);
    } catch (e) {
      console.error('获取持仓失败:', e);
    }
    setLoading(false);
    initialLoadDone.current = true;
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000); // 从30s改为60s，减少不必要的频繁刷新
    return () => clearInterval(t);
  }, [fetchData]);

  // 获取所有持仓股的主力资金(今日)
  useEffect(() => {
    if (!holdings.length) return;
    const codes = holdings.map(h => h.code).filter(Boolean);
    if (!codes.length) return;
    fetch(`http://localhost:8769/api/main-flow/today`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.flows) {
          const map = {};
          data.flows.forEach(f => { map[f.code] = f; });
          setMainFlowMap(map);
        }
      })
      .catch(() => {});
    // 每5分钟刷新
    const t = setInterval(() => {
      fetch(`http://localhost:8769/api/main-flow/today`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          if (data.success && data.flows) {
            const map = {};
            data.flows.forEach(f => { map[f.code] = f; });
            setMainFlowMap(map);
          }
        })
        .catch(() => {});
    }, 300000);
    return () => clearInterval(t);
  }, [holdings]);

  // 补全缺失的主力资金数据（针对持仓中未在40只批量采集范围内的股票）
  useEffect(() => {
    if (!holdings.length) return;
    const timer = setTimeout(() => {
      for (const h of holdings) {
        if (!mainFlowMap?.[h.code]) {
          fetch(`http://localhost:8769/api/main-flow/today/${h.code}`, { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
              if (data.success && data.flows?.length > 0) {
                setMainFlowMap(prev => ({ ...prev, [h.code]: data.flows[0] }));
              }
            })
            .catch(() => {});
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [holdings, mainFlowMap]);

  const handleAction = async (action, holding) => {
    if (action === 'analyze') {
      setAnalysisTarget(holding);
    } else if (action === 'mainFlow') {
      setMainFlowTarget(holding);
    } else if (action === 'dayt') {
      // 【2026-04-14 改造】做T建议改用尧帝AI进化引擎分析
      // 原 /api/holding/dayt 技术指标规则引擎已弃用
      setDaytTarget(holding);
      setDaytLoading(true);
      try {
        const aiResult = await analyzeHolding(holding);
        // 将尧帝AI分析结果映射为做T弹窗格式
        setDaytData({
          success: true,
          name: holding.name,
          shares: holding.shares || holding.quantity,
          costPrice: holding.cost_price || holding.cost,
          currentPrice: holding.current_price || holding.price,
          profitAmount: ((holding.current_price || holding.price) - (holding.cost_price || holding.cost)) * (holding.shares || holding.quantity),
          profitPct: aiResult.profitPct || 0,
          indicators: aiResult.indicators || {},
          analysis: aiResult.analysis || { trend: '震荡' },
          bestStrategy: aiResult.bestStrategy || { type: '观望', reason: '尧帝AI分析中' },
          allStrategies: aiResult.allStrategies || [],
          yaodi: aiResult.yaodi || {}, // 尧帝状态
          techSummaries: aiResult.techSummaries || [], // 技术分析摘要
          _source: aiResult._source || 'yaodi_v2' // 尧帝2.0优先，v1降级
        });
        setDaytLoading(false);
      } catch (e) {
        console.error('尧帝AI分析失败:', e);
        setDaytData({ success: false, error: '尧帝AI分析失败: ' + e.message });
        setDaytLoading(false);
      }
    } else if (action === 'edit') {
      setEditTarget(holding);
    } else if (action === 'sell') {
      // 打开卖出弹窗，预填当前价和持股数
      setSellTarget(holding);
      // 优先用实时价，其次用缓存价
      const initPrice = holding.realtime_price || holding.current_price || holding.price || '';
      setSellPrice(String(initPrice));
      setSellShares((holding.shares || holding.quantity || '').toString());
      // 自动拉实时股价（覆盖缓存价）
      try {
                const d = await stockAPI.get(holding.code);
        if (d?.price) setSellPrice(String(d.price));
      } catch(e) { /* 静默，拉不到就用缓存价 */ }
    }
  };
  
  const handleEditSave = (code, updates) => {
    holdingAPI.update(code, updates).then(fetchData);
  };

  // 保存可用资产（用户设置，总资产自动计算）
  const handleSaveCapital = async () => {
    const available = parseFloat(inputAvailableCapital);
    if (isNaN(available) || available < 0) {
      alert('请输入有效的可用资产金额');
      return;
    }
    try {
      // 保存可用资产，总资产 = 可用资产 + 持仓市值（后端自动计算）
      const res = await capitalAPI.setConfig({ available_capital: available });
      if (res.success) {
        setCapital(res.config || { ...capital, available_capital: available });
        setShowCapitalModal(false);
      }
    } catch (e) {
      console.error('保存可用资产失败:', e);
    }
  };

  // 汇总统计
  const totalValue  = holdings.reduce((s, h) => s + (h.realtime_price && h.realtime_price > 0 ? h.realtime_price : h.current_price || 0) * (h.shares || 0), 0);
  const availableCapital = capital?.available_capital || 0;  // 可用资产（用户设置）
  const totalCapital = availableCapital + totalValue;  // 总资产 = 可用资产 + 持仓市值（自动计算）
  // 今日盈亏：Σ(现价 - 昨收) × 持仓数（BUG修复：优先用 realtime_price，从 change_percent 推算昨收）
  const todayProfit = holdings.reduce((s, h) => {
    const currentPrice = h.realtime_price || h.current_price || h.price || 0;
    // 优先用 realtime_price 推算昨收（因为 DB pre_close 经常为 0）
    const changePct = h.change_percent || 0;
    const preClose = currentPrice > 0 && changePct !== 0 
      ? currentPrice / (1 + changePct / 100) 
      : (h.pre_close || h.cost_price || 0);
    return s + (currentPrice - preClose) * (h.shares || 0);
  }, 0);

  if (loading) return <div className="loading"><div className="loading-spinner" /></div>;

  return (
    <div className="holding-page">
      {/* 标题栏 */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">用户持仓</h1>
            <p className="page-subtitle">共 {holdings.length} 只持仓</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', border: 'none', borderRadius: '10px',
              background: 'var(--accent-blue)', color: 'white',
              cursor: 'pointer', fontWeight: '600', fontSize: '13px',
overflow: 'hidden',
      minWidth: 0
    }}
          >
            <Plus size={15} /> 添加持仓
          </button>
        </div>
      </div>

      {/* 总览 */}
      <div className="holding-summary">
        <div className="summary-card" style={{ cursor: 'pointer' }} onClick={() => { setShowCapitalModal(true); setInputAvailableCapital(String(availableCapital)); }}>
          <span className="summary-label">总资产 <span style={{ fontSize: '10px', opacity: 0.6 }}>(点击编辑)</span></span>
          <span className="summary-value">¥{(totalCapital / 10000).toFixed(2)}万</span>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>可用 ¥{(availableCapital / 10000).toFixed(2)}万 + 市值 ¥{(totalValue / 10000).toFixed(2)}万</div>
        </div>
        <div className="summary-card">
          <span className="summary-label">持仓市值</span>
          <span className="summary-value">¥{(totalValue / 10000).toFixed(2)}万</span>
        </div>
        <div className="summary-card highlight">
          <span className="summary-label">今日盈亏</span>
          <span className={`summary-value ${todayProfit >= 0 ? 'up' : 'down'}`}>
            {todayProfit >= 0 ? '+' : ''}¥{(todayProfit / 10000).toFixed(2)}万
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          【风控层v3】集中度风险分析（Herfindahl + 行业 + 波动率 + Beta）
          ═══════════════════════════════════════════════════════════════ */}
      {riskAnalysis && riskAnalysis.summary && (() => {
        const s = riskAnalysis.summary;
        const hasWarnings = s.warnings?.length > 0;
        const hasInfo = s.infoItems?.length > 0;
        if (!hasWarnings && !hasInfo) return null;
        return (
          <div style={{
            background: hasWarnings ? 'rgba(239,68,68,0.06)' : 'rgba(99,102,241,0.06)',
            border: `1px solid ${hasWarnings ? 'rgba(239,68,68,0.2)' : 'rgba(99,102,241,0.2)'}`,
            borderRadius: '14px', padding: '14px 16px', marginBottom: '20px', overflow: 'hidden', minWidth: 0
          }}>
            {/* 标题栏 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={15} style={{ color: hasWarnings ? '#ef4444' : '#6366f1' }} />
                <span style={{ fontSize: '13px', fontWeight: '600', color: hasWarnings ? '#ef4444' : '#6366f1' }}>
                  集中度风险分析
                </span>
                {s.herfindahl && (
                  <span style={{
                    fontSize: '11px', padding: '2px 6px', borderRadius: '4px',
                    background: s.herfindahl.dispersionPct >= 60 ? 'rgba(52,199,89,0.15)' : s.herfindahl.dispersionPct >= 40 ? 'rgba(255,149,0,0.15)' : 'rgba(239,68,68,0.15)',
                    color: s.herfindahl.dispersionPct >= 60 ? '#34c759' : s.herfindahl.dispersionPct >= 40 ? '#ff9500' : '#ef4444'
                  }}>
                    分散度 {s.herfindahl.dispersionPct?.toFixed(0)}%
                  </span>
                )}
              </div>
              <button onClick={() => setShowRiskPanel(v => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-blue)', fontSize: '12px' }}>
                {showRiskPanel ? '收起' : '详情'}
              </button>
            </div>

            {/* 预警列表 */}
            {s.warnings?.map((w, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '6px', marginBottom: '6px',
                padding: '6px 10px', borderRadius: '6px',
                background: w.level === 'high' ? 'rgba(239,68,68,0.08)' : 'rgba(255,149,0,0.08)'
              }}>
                <AlertTriangle size={13} style={{ color: w.level === 'high' ? '#ef4444' : '#ff9500', flexShrink: 0, marginTop: '1px' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.5' }}>{w.text}</span>
              </div>
            ))}

            {/* 信息项（展开时显示） */}
            {showRiskPanel && s.infoItems?.map((info, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>✓</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{info.text}</span>
              </div>
            ))}

            {/* 展开详情面板 */}
            {showRiskPanel && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                {/* Herfindahl 指数条 */}
                {s.herfindahl && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                      <span>Herfindahl 指数</span>
                      <span>{(s.herfindahl.original * 10000).toFixed(0)} / 均匀值 {(s.herfindahl.equalWeight * 10000).toFixed(0)}</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--bg-card)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${Math.min(s.herfindahl.ratio * 20, 100)}%`,
                        background: s.herfindahl.dispersionPct >= 60 ? '#34c759' : s.herfindahl.dispersionPct >= 40 ? '#ff9500' : '#ef4444',
                        borderRadius: '3px'
                      }} />
                    </div>
                  </div>
                )}

                {/* 行业集中度 */}
                {s.sectorAlerts && s.sectorAlerts.length > 0 && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>行业分布</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {s.sectorAlerts.map((sa, i) => (
                        <span key={i} style={{
                          fontSize: '11px', padding: '3px 8px', borderRadius: '4px',
                          background: sa.ratio > 30 ? 'rgba(239,68,68,0.12)' : 'var(--bg-card)',
                          color: sa.ratio > 30 ? '#ef4444' : 'var(--text-secondary)'
                        }}>
                          {sa.sector} {sa.ratio.toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 组合 Beta & 波动率 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '11px' }}>
                  <div style={{ textAlign: 'center', padding: '6px', background: 'var(--bg-card)', borderRadius: '6px' }}>
                    <div style={{ color: 'var(--text-tertiary)', marginBottom: '2px' }}>组合β</div>
                    <div style={{ fontWeight: '600', color: s.portfolioBeta > 1.2 ? '#ef4444' : s.portfolioBeta > 0.8 ? 'var(--text-primary)' : '#34c759' }}>
                      {s.portfolioBeta?.toFixed(2) || '--'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '6px', background: 'var(--bg-card)', borderRadius: '6px' }}>
                    <div style={{ color: 'var(--text-tertiary)', marginBottom: '2px' }}>持仓数</div>
                    <div style={{ fontWeight: '600' }}>{s.totalCount}</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '6px', background: 'var(--bg-card)', borderRadius: '6px' }}>
                    <div style={{ color: 'var(--text-tertiary)', marginBottom: '2px' }}>前三大</div>
                    <div style={{ fontWeight: '600', color: s.concentration?.top3R > 50 ? '#ef4444' : 'var(--text-primary)' }}>
                      {s.concentration?.top3R?.toFixed(0) || '--'}%
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* 组合优化建议 */}
      {portfolio && (portfolio.recommendations?.length > 0 || portfolio.suggestions?.length > 0) && (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px', marginBottom: '20px', overflow: 'hidden', minWidth: 0
    }}>
          {/* 标题栏 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <BarChart2 size={15} /> 组合优化建议
              {!portfolio._source || (portfolio._source !== 'yaodi_ai' && portfolio._source !== 'yaodi_v2') && (
                <span style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg-card)', color: 'var(--text-tertiary)', borderRadius: '4px' }}>传统模型</span>
              )}
            </h3>
            <button onClick={() => setShowPortfolio(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-blue)', fontSize: '13px' }}>
              {showPortfolio ? '收起' : '展开'}
            </button>
          </div>

          {/* 尧帝AI状态（仅当数据来自尧帝AI时显示） */}
          {portfolio._source === 'yaodi_ai' || portfolio._source === 'yaodi_v2' && (
            <div style={{ padding: '12px', background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))', borderRadius: '8px', marginBottom: '14px', border: '1px solid rgba(99,102,241,0.2)', overflow: 'hidden', minWidth: 0
    }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#8b5cf6' }}>🧠 尧帝AI组合分析</span>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>健康度: <span style={{ fontWeight: '700', color: portfolio.healthScore >= 70 ? '#52c41a' : portfolio.healthScore >= 50 ? '#faad14' : '#ff4d4f' }}>{portfolio.healthScore}分</span></span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '11px', minWidth: 0, overflow: 'hidden'}}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-tertiary)' }}>平均评分</div>
                  <div style={{ fontWeight: '700', color: '#8b5cf6' }}>{portfolio.avgYaodiScore?.toFixed(0) || '--'}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-tertiary)' }}>盈利比例</div>
                  <div style={{ fontWeight: '700', color: portfolio.profitRatio >= 50 ? '#52c41a' : '#ff4d4f' }}>{portfolio.profitRatio}%</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-tertiary)' }}>分散度</div>
                  <div style={{ fontWeight: '700' }}>{portfolio.diversification}%</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-tertiary)' }}>风险等级</div>
                  <div style={{ fontWeight: '700', color: portfolio.riskLevel === '低' ? '#52c41a' : portfolio.riskLevel === '中' ? '#faad14' : '#ff4d4f' }}>{portfolio.riskLevel}</div>
                </div>
              </div>
            </div>
          )}

          {/* 整体指标 - 兼容新旧数据结构 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px', minWidth: 0, overflow: 'hidden'}}>
            {[
              { label: '组合建议', value: portfolio.portfolioSuggestion || '--', color: 'var(--accent-blue)' },
              { label: '总资产', value: `¥${(portfolio.totalValue / 10000).toFixed(2)}万`, color: 'var(--text-primary)' },
              { label: '持仓数', value: portfolio.stockCount || '--', color: 'var(--text-primary)' },
              { label: '风险等级', value: portfolio.riskLevel || '--', color: portfolio.riskLevel === '低' ? 'var(--accent-green)' : portfolio.riskLevel === '高' ? 'var(--accent-red)' : 'var(--accent-orange)' },
            ].map((item, i) => (
              <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '10px', textAlign: 'center', overflow: 'hidden', minWidth: 0
    }}>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{item.label}</div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: item.color, marginTop: '2px' }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* 个股详细建议 */}
          {showPortfolio && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(portfolio.suggestions || portfolio.recommendations || []).map((rec, i) => {
                const isUp = parseFloat(rec.profitPct) >= 0;
                const action = rec.action || (rec.action === 'buy' ? '加仓' : rec.action === 'sell' ? '减仓' : '持有');
                const isAdd = action === '加仓';
                const isReduce = action === '减仓';
                return (
                  <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '10px', padding: '14px', border: `1px solid ${isAdd ? 'rgba(99,102,241,0.3)' : isReduce ? 'rgba(255,59,48,0.2)' : 'var(--border-color)'}` }}>
                    {/* 股票标题行 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '15px', fontWeight: '700' }}>{rec.name || '未知'}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{rec.code || '--'}</span>
                        <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
                          background: isAdd ? 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))' : isReduce ? 'rgba(255,59,48,0.15)' : 'rgba(255,107,0,0.1)',
                          color: isAdd ? '#8b5cf6' : isReduce ? 'var(--accent-red)' : 'var(--accent-orange)',
overflow: 'hidden',
      minWidth: 0
    }}>
                          {action}
                        </span>
                      </div>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: isUp ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                        {isUp ? '+' : ''}{parseFloat(rec.profitPct || 0).toFixed(2)}%
                      </span>
                    </div>

                    {/* 持仓基本信息 */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '10px', minWidth: 0, overflow: 'hidden'}}>
                      {[
                        { label: '当前权重', value: `${(rec.weight * 100).toFixed(1)}%` },
                        { label: '目标权重', value: `${(rec.targetWeight * 100).toFixed(1)}%` },
                        { label: '尧帝评分', value: rec.yaodiScore?.toFixed(0) || '--', highlight: true },
                        { label: '胜率', value: `${rec.backtestWinRate || '--'}%` },
                      ].map((item, j) => (
                        <div key={j} style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '7px 10px', overflow: 'hidden', minWidth: 0
    }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{item.label}</div>
                          <div style={{ fontSize: '13px', fontWeight: '600', marginTop: '2px',
                            color: item.highlight ? '#8b5cf6' : 'var(--text-primary)'
                          }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* 调仓详情 - 仅加减仓时显示 */}
                    {(rec.action === '加仓' || rec.action === '减仓') && rec.adjustShares !== 0 && (
                      <div style={{ background: rec.action === '加仓' ? 'rgba(99,102,241,0.08)' : 'rgba(255,59,48,0.08)', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px', border: `1px solid ${rec.action === '加仓' ? 'rgba(99,102,241,0.2)' : 'rgba(255,59,48,0.2)'}` }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', marginBottom: '8px', color: rec.action === '加仓' ? '#8b5cf6' : 'var(--accent-red)' }}>
                          {rec.action === '加仓' ? '📈 加仓计划' : '📉 减仓计划'}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', minWidth: 0, overflow: 'hidden'}}>
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>调仓价格</div>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: rec.action === '加仓' ? '#8b5cf6' : 'var(--accent-red)' }}>¥{rec.actionPrice || '--'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{rec.action === '加仓' ? '买入股数' : '卖出股数'}</div>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: rec.action === '加仓' ? '#8b5cf6' : 'var(--accent-red)' }}>{Math.abs(rec.adjustShares)}股</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{rec.action === '加仓' ? '买入金额' : '卖出金额'}</div>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: rec.action === '加仓' ? '#8b5cf6' : 'var(--accent-red)' }}>¥{(rec.actionAmount || 0).toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 操作建议 */}
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5', background: 'var(--bg-secondary)', padding: '10px', borderRadius: '6px', overflow: 'hidden', minWidth: 0
    }}>
                      💡 {rec.reason}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 持仓列表 */}
      {holdings.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1.5"/>
            <rect x="14" y="3" width="7" height="7" rx="1.5"/>
            <rect x="3" y="14" width="7" height="7" rx="1.5"/>
            <rect x="14" y="14" width="7" height="7" rx="1.5"/>
          </svg>
          <p>暂无持仓</p>
        </div>
      ) : (
        <div className="holdings-grid">
          {holdings.map((h, i) => (
            <HoldingCard
              key={h.code || i}
              holding={{
                ...h,
                quantity: h.shares  || h.quantity || 0,
                cost:     h.cost_price || h.cost  || 0,
                price:    h.realtime_price && h.realtime_price > 0 ? h.realtime_price : h.current_price || h.price || 0,
              }}
              // 【修复】舜帝持仓自带尧帝综合评分，优先使用；batchConfidence兜底
              confidence={h.confidence ?? confidenceMap[h.code]}
              mainFlow={mainFlowMap[h.code]}
              onAction={handleAction}
            />
          ))}
        </div>
      )}

      {/* 尧帝分析弹窗 */}
      <HoldingAnalysisModal
        holding={analysisTarget}
        isOpen={!!analysisTarget}
        onClose={() => setAnalysisTarget(null)}
      />

      {/* 主力资金弹窗 */}
      {mainFlowTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
          onClick={() => setMainFlowTarget(null)}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: '16px', width: '1400px', maxWidth: '96vw', maxHeight: '92vh', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden', minWidth: 0 }}
            onClick={e => e.stopPropagation()}>
            {/* 头部 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <span className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{mainFlowTarget.name}</span>
                <span className="text-sm" style={{ color: 'var(--text-tertiary)', marginLeft: 12 }}>{mainFlowTarget.code}</span>
                <span style={{ fontSize: 14, color: '#ec4899', marginLeft: 12, fontWeight: 600 }}>💰 主力资金</span>
              </div>
              <button onClick={() => setMainFlowTarget(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
                <X size={20} />
              </button>
            </div>
            {/* 图表内容 */}
            <div style={{ padding: '24px 28px', overflowY: 'auto', maxHeight: 'calc(92vh - 70px)' }}>
              <MainFlowChart code={mainFlowTarget.code} name={mainFlowTarget.name} />
            </div>
          </div>
        </div>
      )}

      {/* 做T建议弹窗 */}
      {daytTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', overflowY: 'auto' }}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: '16px', width: '600px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', margin: '20px auto', overflow: 'hidden', minWidth: 0
    }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, background: 'var(--bg-primary)', zIndex: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: '700' }}>⚡ 做T建议</span>
                {daytData?._source === 'yaodi_ai' || daytData?._source === 'yaodi_v2' && (
                  <span style={{ fontSize: '10px', padding: '2px 6px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', borderRadius: '4px', fontWeight: '600', overflow: 'hidden', minWidth: 0
    }}>尧帝AI</span>
                )}
              </div>
              <button onClick={() => { setDaytTarget(null); setDaytData(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
              {daytLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div className="loading-spinner" style={{ margin: '0 auto' }} />
                </div>
              ) : daytData?.success ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px', minWidth: 0, overflow: 'hidden'}}>
                    <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', overflow: 'hidden', minWidth: 0
    }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>股票</div>
                      <div style={{ fontSize: '14px', fontWeight: '600', marginTop: '4px' }}>{daytData.name}</div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', overflow: 'hidden', minWidth: 0
    }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>持股数</div>
                      <div style={{ fontSize: '14px', fontWeight: '600', marginTop: '4px' }}>{daytData.shares}股</div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', overflow: 'hidden', minWidth: 0
    }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>成本价</div>
                      <div style={{ fontSize: '14px', fontWeight: '600', marginTop: '4px' }}>¥{daytData.costPrice}</div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', overflow: 'hidden', minWidth: 0
    }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>现价</div>
                      <div style={{ fontSize: '14px', fontWeight: '600', marginTop: '4px' }}>¥{daytData.currentPrice}</div>
                    </div>
                  </div>

                  <div style={{ padding: '12px', background: 'rgba(52,199,89,0.1)', borderRadius: '8px', marginBottom: '20px', border: '1px solid rgba(52,199,89,0.2)', overflow: 'hidden', minWidth: 0
    }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>盈亏</div>
                    <div style={{ fontSize: '18px', fontWeight: '700', marginTop: '4px', color: parseFloat(daytData.profitAmount) >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                      {parseFloat(daytData.profitAmount) >= 0 ? '+' : ''}¥{parseFloat(daytData.profitAmount).toFixed(2)} ({daytData.profitPct}%)
                    </div>
                  </div>

                  <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', marginBottom: '20px', overflow: 'hidden', minWidth: 0
    }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>📊 技术指标</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px', minWidth: 0, overflow: 'hidden'}}>
                      <div>RSI: <span style={{ fontWeight: '600' }}>{daytData.indicators?.rsi || '--'}</span></div>
                      <div>MACD: <span style={{ fontWeight: '600' }}>{daytData.indicators?.macd || '--'}</span></div>
                      <div>MA5: <span style={{ fontWeight: '600' }}>¥{daytData.indicators?.ma5 || '--'}</span></div>
                      <div>MA20: <span style={{ fontWeight: '600' }}>¥{daytData.indicators?.ma20 || '--'}</span></div>
                      <div>波动率: <span style={{ fontWeight: '600' }}>{daytData.indicators?.volatility || '--'}%</span></div>
                      <div>趋势: <span style={{ fontWeight: '600', color: daytData.analysis?.trend === '上升' ? 'var(--accent-red)' : 'var(--accent-green)' }}>{daytData.analysis?.trend || '震荡'}</span></div>
                    </div>
                  </div>

                  {/* 尧帝2.0指标面板（支持V2和V1降级） */}
                  {daytData.yaodi && (daytData._source === 'yaodi_v2' || daytData._source === 'yaodi_ai') && (
                    <div style={{ padding: '12px', background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))', borderRadius: '8px', marginBottom: '20px', border: '1px solid rgba(99,102,241,0.2)', overflow: 'hidden', minWidth: 0
    }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: '#8b5cf6' }}>
                        {daytData.hasV2 ? '🧠 尧帝2.0三层选股引擎' : '🧠 尧帝AI状态'}
                        {daytData.hasV2 && <span style={{ fontSize: '10px', marginLeft: '6px', padding: '1px 5px', background: '#6366f1', color: 'white', borderRadius: '3px', fontWeight: '600' }}>V2</span>}
                      </div>
                      {daytData.hasV2 && daytData.yaodi.v2 ? (
                        /* 尧帝2.0核心指标（6项） */
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '12px', marginBottom: '10px', minWidth: 0, overflow: 'hidden'}}>
                          <div style={{ textAlign: 'center', padding: '8px 4px', background: 'rgba(99,102,241,0.08)', borderRadius: '6px' }}>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>L3置信度</div>
                            <div style={{ fontWeight: '700', color: '#6366f1', fontSize: '16px' }}>{daytData.yaodi.v2.confidence != null ? daytData.yaodi.v2.confidence + '%' : '--'}</div>
                          </div>
                          <div style={{ textAlign: 'center', padding: '8px 4px', background: 'rgba(99,102,241,0.08)', borderRadius: '6px' }}>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>L2堆叠得分</div>
                            <div style={{ fontWeight: '700', color: '#6366f1', fontSize: '16px' }}>{daytData.yaodi.v2.l2Score != null ? daytData.yaodi.v2.l2Score.toFixed(3) : '--'}</div>
                          </div>
                          <div style={{ textAlign: 'center', padding: '8px 4px', background: 'rgba(99,102,241,0.08)', borderRadius: '6px' }}>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>L1排名</div>
                            <div style={{ fontWeight: '700', color: '#6366f1', fontSize: '16px' }}>{daytData.yaodi.v2.l1Rank != null ? 'Top' + daytData.yaodi.v2.l1Rank : '--'}</div>
                          </div>
                          <div style={{ textAlign: 'center', padding: '8px 4px', background: 'rgba(99,102,241,0.08)', borderRadius: '6px' }}>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>信号状态</div>
                            <div style={{ fontWeight: '700', color: daytData.yaodi.v2.signalStatus === 'buy' ? '#22c55e' : daytData.yaodi.v2.signalStatus === 'restricted' ? '#ef4444' : '#f59e0b', fontSize: '13px', textTransform: 'capitalize' }}>{daytData.yaodi.v2.signalStatus || '--'}</div>
                          </div>
                          <div style={{ textAlign: 'center', padding: '8px 4px', background: 'rgba(99,102,241,0.08)', borderRadius: '6px' }}>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>凯利仓位</div>
                            <div style={{ fontWeight: '700', color: '#6366f1', fontSize: '16px' }}>{daytData.yaodi.v2.kellyPct != null ? daytData.yaodi.v2.kellyPct + '%' : '--'}</div>
                          </div>
                          <div style={{ textAlign: 'center', padding: '8px 4px', background: 'rgba(99,102,241,0.08)', borderRadius: '6px' }}>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>ATR止损</div>
                            <div style={{ fontWeight: '700', color: '#6366f1', fontSize: '16px' }}>{daytData.yaodi.v2.atrStop != null ? daytData.yaodi.v2.atrStop.toFixed(2) : '--'}</div>
                          </div>
                        </div>
                      ) : (
                        /* 尧帝1.0传统指标 */
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', fontSize: '12px', minWidth: 0, overflow: 'hidden'}}>
                          <div style={{ textAlign: 'center' }}><div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>准确率</div><div style={{ fontWeight: '700', color: '#8b5cf6' }}>{daytData.yaodi.v1Accuracy != null ? daytData.yaodi.v1Accuracy.toFixed(1) + '%' : '--'}</div></div>
                          <div style={{ textAlign: 'center' }}><div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>胜率</div><div style={{ fontWeight: '700', color: '#8b5cf6' }}>{daytData.yaodi.v1WinRate != null ? daytData.yaodi.v1WinRate.toFixed(1) + '%' : '--'}</div></div>
                          <div style={{ textAlign: 'center' }}><div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>夏普比</div><div style={{ fontWeight: '700', color: '#8b5cf6' }}>{daytData.yaodi.v1SharpeRatio != null ? daytData.yaodi.v1SharpeRatio.toFixed(2) : '--'}</div></div>
                          <div style={{ textAlign: 'center' }}><div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>进化次数</div><div style={{ fontWeight: '700', color: '#8b5cf6' }}>{(daytData.yaodi.evolutionCount || 0).toLocaleString()}</div></div>
                        </div>
                      )}
                      {daytData.hasV2 && daytData.yaodi.v2?.factors && (
                        /* 五因子雷达图展示 */
                        <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(99,102,241,0.05)', borderRadius: '6px' }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>五因子综合得分: {daytData.yaodi.v2.factors?.l1TotalScore || '--'}</div>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '11px' }}>
                            {[
                              { label: '价值', key: 'valueScore', icon: '💎' },
                              { label: '动量', key: 'growthScore', icon: '📈' },
                              { label: '质量', key: 'qualityScore', icon: '🏆' },
                              { label: '波动', key: 'volatilityScore', icon: '🌊' },
                              { label: '市值', key: 'sizeScore', icon: '🏢' },
                            ].map(f => {
                              const val = daytData.yaodi.v2.factors?.[f.key] || 0;
                              const pct = Math.min(100, Math.max(0, val));
                              const color = pct >= 70 ? '#22c55e' : pct >= 50 ? '#6366f1' : '#f59e0b';
                              return (
                                <div key={f.key} style={{ flex: 1, textAlign: 'center' }}>
                                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '2px' }}>{f.label}</div>
                                  <div style={{ height: '16px', background: 'var(--bg-card)', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: pct + '%', background: color, transition: 'width 0.3s', borderRadius: '3px' }} />
                                  </div>
                                  <div style={{ fontSize: '10px', fontWeight: '600', color, marginTop: '1px' }}>{val}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ padding: '16px', background: 'linear-gradient(135deg, rgba(255,149,0,0.1), rgba(255,59,48,0.05))', borderRadius: '8px', border: '1px solid rgba(255,149,0,0.2)', marginBottom: '20px', overflow: 'hidden', minWidth: 0
    }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px' }}>🎯 最优策略</div>
                    <div style={{ fontSize: '16px', fontWeight: '700', color: daytData.bestStrategy.type === '止损' || daytData.bestStrategy.type === '防守减仓T' ? 'var(--accent-orange)' : daytData.bestStrategy.type.includes('高抛') || daytData.bestStrategy.type.includes('正T') || daytData.bestStrategy.type.includes('区间') ? 'var(--accent-green)' : daytData.bestStrategy.type.includes('低吸') || daytData.bestStrategy.type.includes('先买') ? 'var(--accent-red)' : daytData.bestStrategy.type.includes('先卖') ? 'var(--accent-green)' : 'var(--accent-orange)', marginBottom: '8px' }}>
                      {daytData.bestStrategy.type}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '12px' }}>
                      {daytData.bestStrategy.description}
                    </div>
                    
                    {/* 买卖点价格区 */}
                    {(daytData.bestStrategy.buyPrice || daytData.bestStrategy.sellPrice || daytData.bestStrategy.stopLoss) && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px', minWidth: 0, overflow: 'hidden'}}>
                        {daytData.bestStrategy.buyPrice && (
                          <div style={{ padding: '10px', background: 'rgba(255,59,48,0.15)', borderRadius: '6px', textAlign: 'center', overflow: 'hidden', minWidth: 0
    }}>
                            <div style={{ fontSize: '10px', color: 'var(--accent-red)' }}>买入挂单价</div>
                            <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--accent-red)' }}>¥{daytData.bestStrategy.buyPrice}</div>
                          </div>
                        )}
                        {daytData.bestStrategy.sellPrice && (
                          <div style={{ padding: '10px', background: 'rgba(52,199,89,0.15)', borderRadius: '6px', textAlign: 'center', overflow: 'hidden', minWidth: 0
    }}>
                            <div style={{ fontSize: '10px', color: 'var(--accent-green)' }}>卖出挂单价</div>
                            <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--accent-green)' }}>¥{daytData.bestStrategy.sellPrice}</div>
                          </div>
                        )}
                        {daytData.bestStrategy.stopLoss && (
                          <div style={{ padding: '10px', background: 'rgba(255,149,0,0.15)', borderRadius: '6px', textAlign: 'center', overflow: 'hidden', minWidth: 0
    }}>
                            <div style={{ fontSize: '10px', color: 'var(--accent-green)' }}>止损价</div>
                            <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--accent-orange)' }}>¥{daytData.bestStrategy.stopLoss}</div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* 做T操作步骤 */}
                    {daytData.bestStrategy.tSteps && daytData.bestStrategy.tSteps.length > 0 && (
                      <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(0,122,255,0.08)', borderRadius: '8px', border: '1px solid rgba(0,122,255,0.2)' }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--accent-blue)', marginBottom: '8px' }}>📋 操作步骤</div>
                        {daytData.bestStrategy.tSteps.map((step, i) => (
                          <div key={i} style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.8', whiteSpace: 'pre-wrap' }}>{step}</div>
                        ))}
                      </div>
                    )}

                    {/* 技术指标快照 */}
                    {daytData.bestStrategy.techSnapshot && (
                      <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        <span>RSI: <b>{daytData.bestStrategy.techSnapshot.rsi}</b></span>
                        <span>MACD: <b>{daytData.bestStrategy.techSnapshot.macd}</b></span>
                        <span>MA5: <b>¥{daytData.bestStrategy.techSnapshot.ma5}</b></span>
                        <span>MA20: <b>¥{daytData.bestStrategy.techSnapshot.ma20}</b></span>
                        <span>波动率: <b>{daytData.bestStrategy.techSnapshot.volatility}</b></span>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', minWidth: 0, overflow: 'hidden', marginTop: '8px' }}>
                      <div>操作: <span style={{ fontWeight: '600' }}>{daytData.bestStrategy.action}</span></div>
                      <div>做T比例: <span style={{ fontWeight: '600' }}>{(daytData.bestStrategy.ratio * 100).toFixed(0)}%</span></div>
                      {daytData.bestStrategy.tRange && (
                        <div>做T幅度: <span style={{ fontWeight: '600' }}>{daytData.bestStrategy.tRange}%</span></div>
                      )}
                      {daytData.bestStrategy.tProfitPct && (
                        <div>做T收益: <span style={{ fontWeight: '600', color: 'var(--accent-green)' }}>+{daytData.bestStrategy.tProfitPct}%</span></div>
                      )}
                      <div>风险: <span style={{ fontWeight: '600' }}>{daytData.bestStrategy.riskLevel}</span></div>
                      <div>周期: <span style={{ fontWeight: '600' }}>{daytData.bestStrategy.timeframe}</span></div>
                    </div>
                  </div>

                  {daytData.allStrategies && daytData.allStrategies.length > 1 && (
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-secondary)' }}>📋 所有可选策略</div>
                      {daytData.allStrategies.map((s, i) => (
                        <div key={i} style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', marginBottom: '8px', fontSize: '12px', overflow: 'hidden', minWidth: 0
    }}>
                          <div style={{ fontWeight: '600', marginBottom: '6px', color: s.type === daytData.bestStrategy.type ? 'var(--accent-blue)' : 'var(--text-primary)' }}>
                            {s.type === daytData.bestStrategy.type ? '✓ ' : ''}{s.type}
                          </div>
                          <div style={{ color: 'var(--text-secondary)', marginBottom: '6px' }}>{s.description}</div>
                          
                          {/* 买卖点 */}
                          {(s.buyPrice || s.sellPrice || s.stopLoss) && (
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                              {s.buyPrice && (
                                <span style={{ background: 'rgba(255,59,48,0.15)', color: 'var(--accent-red)', padding: '2px 8px', borderRadius: '4px', fontWeight: '600', overflow: 'hidden', minWidth: 0
    }}>
                                  买入 ¥{s.buyPrice}{s.buyQuantity ? ` × ${s.buyQuantity}股` : ''}
                                </span>
                              )}
                              {s.sellPrice && (
                                <span style={{ background: 'rgba(52,199,89,0.15)', color: 'var(--accent-green)', padding: '2px 8px', borderRadius: '4px', fontWeight: '600', overflow: 'hidden', minWidth: 0
    }}>
                                  卖出 ¥{s.sellPrice}{s.sellQuantity ? ` × ${s.sellQuantity}股` : ''}
                                </span>
                              )}
                              {s.stopLoss && (
                                <span style={{ background: 'rgba(255,149,0,0.15)', color: 'var(--accent-orange)', padding: '2px 8px', borderRadius: '4px', fontWeight: '600', overflow: 'hidden', minWidth: 0
    }}>
                                  止损 ¥{s.stopLoss}
                                </span>
                              )}
                            </div>
                          )}
                          
                          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11px' }}>
                            <span>操作: {s.action}</span>
                            <span>比例: {(s.ratio * 100).toFixed(0)}%</span>
                            <span>风险: {s.riskLevel}</span>
                            <span>周期: {s.timeframe}</span>
                          </div>
                          {s.tSteps && s.tSteps.length > 0 && (
                            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                              {s.tSteps.map((step, j) => (
                                <div key={j} style={{ lineHeight: '1.6' }}>{step}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                  获取建议失败
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 编辑持仓弹窗 */}
      <EditHoldingModal
        holding={editTarget}
        isOpen={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSave={handleEditSave}
      />

      {/* 添加持仓弹窗 */}
      <AddHoldingModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={fetchData}
      />

      {/* 剩余可用资产编辑弹窗 */}
      {showCapitalModal && (
        <div className="modal-overlay" onClick={() => setShowCapitalModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '360px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: '600' }}>设置总资产</h3>
            <div style={{ marginBottom: '12px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '10px', fontSize: '13px', overflow: 'hidden', minWidth: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', textAlign: 'center' }}>
                <div>
                  <div style={{ color: 'var(--text-tertiary)', marginBottom: '4px', fontSize: '11px' }}>持仓市值</div>
                  <div style={{ fontWeight: '700', fontSize: '15px' }}>¥{(totalValue / 10000).toFixed(2)}万</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-tertiary)', marginBottom: '4px', fontSize: '11px' }}>可用资产</div>
                  <div style={{ fontWeight: '700', fontSize: '15px', color: '#6366f1' }}>¥{(availableCapital / 10000).toFixed(2)}万</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-tertiary)', marginBottom: '4px', fontSize: '11px' }}>总资产</div>
                  <div style={{ fontWeight: '700', fontSize: '15px', color: '#10b981' }}>¥{(totalCapital / 10000).toFixed(2)}万</div>
                </div>
              </div>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                输入可用资产（元）
              </label>
              <input
                type="number"
                value={inputAvailableCapital}
                onChange={e => setInputAvailableCapital(e.target.value)}
                placeholder="如 50000"
                autoFocus
                style={{
                  width: '100%', padding: '12px', fontSize: '16px',
                  border: '1px solid var(--border-color)', borderRadius: '10px',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
overflow: 'hidden',
      minWidth: 0
    }}
              />
            </div>
            {parseFloat(inputAvailableCapital) >= 0 && (
              <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(0,122,255,0.08)', borderRadius: '10px', fontSize: '13px', overflow: 'hidden', minWidth: 0
    }}>
                <div style={{ color: 'var(--text-tertiary)', marginBottom: '4px' }}>计算后总资产</div>
                <div style={{ fontWeight: '700', fontSize: '18px', color: 'var(--accent-blue)' }}>
                  ¥{((totalValue + parseFloat(inputAvailableCapital || 0)) / 10000).toFixed(2)}万
                </div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginTop: '4px' }}>
                  = 市值 ¥{(totalValue / 10000).toFixed(2)}万 + 剩余可用 ¥{(parseFloat(inputAvailableCapital || 0) / 10000).toFixed(2)}万
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setShowCapitalModal(false)}
                style={{ flex: 1, padding: '10px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', overflow: 'hidden', minWidth: 0
    }}
              >取消</button>
              <button
                onClick={handleSaveCapital}
                style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '10px', background: 'var(--accent-blue)', color: 'white', cursor: 'pointer', fontWeight: '600', overflow: 'hidden', minWidth: 0
    }}
              >保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 卖出弹窗 */}
      {sellTarget && (() => {
        const h = sellTarget;
        const price = parseFloat(sellPrice) || 0;
        const qty = parseInt(sellShares) || 0;
        const costPrice = h.cost_price || h.cost || 0;
        const origShares = h.shares || h.quantity || 0;
        const sellAmount = price * qty; // 本次卖出金额
        const costAmount = costPrice * qty; // 本次卖出成本
        const sellProfit = sellAmount - costAmount; // 本次卖出盈亏
        const sellProfitPct = costAmount > 0 ? (sellProfit / costAmount * 100) : 0;
        const remainShares = origShares - qty; // 剩余持股
        // 卖出后重新计算汇总
        const otherValue = holdings
          .filter(x => x.code !== h.code)
          .reduce((s, x) => s + (x.realtime_price && x.realtime_price > 0 ? x.realtime_price : x.current_price || 0) * (x.shares || 0), 0);
        const remainValue = remainShares > 0 ? (h.realtime_price && h.realtime_price > 0 ? h.realtime_price : h.current_price || price) * remainShares : 0;
        const newTotalValue = otherValue + remainValue;
        // 可用资金 = 总资产 - 新持仓市值（卖出金额已自动包含在可用资金中）
        const newAvailable = availableCapital + sellAmount; // 卖出资金回到可用
        const isValid = price > 0 && qty > 0 && qty <= origShares;
        return (
          <div className="modal-overlay" onClick={() => setSellTarget(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '400px', padding: '0', overflow: 'hidden' }}>
              {/* 标题 */}
              <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '17px', fontWeight: '700' }}>卖出 {h.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{h.code} · 持仓 {origShares} 股 · 成本 ¥{costPrice.toFixed(2)}</div>
                </div>
                <button onClick={() => setSellTarget(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '4px' }}>
                  <X size={18} />
                </button>
              </div>

              {/* 输入区 */}
              <div style={{ padding: '18px 20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px', minWidth: 0, overflow: 'hidden'}}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>卖出价格（元）</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={sellPrice}
                      onChange={e => setSellPrice(e.target.value)}
                      placeholder={`当前价 ${h.current_price != null ? Number(h.current_price).toFixed(2) : '--'}`}
                      autoFocus
                      style={{ width: '100%', padding: '10px 12px', fontSize: '15px', fontWeight: '600', border: '1.5px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', overflow: 'hidden', minWidth: 0
    }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>卖出数量（股）</label>
                    <input
                      type="number"
                      step="100"
                      min="100"
                      max={origShares}
                      value={sellShares}
                      onChange={e => setSellShares(e.target.value)}
                      placeholder={`最多 ${origShares} 股`}
                      style={{ width: '100%', padding: '10px 12px', fontSize: '15px', fontWeight: '600', border: '1.5px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', overflow: 'hidden', minWidth: 0
    }}
                    />
                  </div>
                </div>

                {/* 快捷按钮 */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  {[['1/4仓', 0.25], ['半仓', 0.5], ['3/4仓', 0.75], ['全仓', 1]].map(([label, ratio]) => (
                    <button key={label} onClick={() => setSellShares(String(Math.floor(origShares * ratio / 100) * 100 || origShares))}
                      style={{ flex: 1, padding: '6px 0', fontSize: '12px', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', overflow: 'hidden', minWidth: 0
    }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* 预览计算 */}
                {isValid && (
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '14px', marginBottom: '16px', overflow: 'hidden', minWidth: 0
    }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '10px', fontWeight: '600' }}>卖出预览</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px', minWidth: 0, overflow: 'hidden'}}>
                      <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>卖出金额</div>
                        <div style={{ fontWeight: '700', marginTop: '2px' }}>¥{sellAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>本次盈亏</div>
                        <div style={{ fontWeight: '700', marginTop: '2px', color: sellProfit >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                          {sellProfit >= 0 ? '+' : ''}¥{sellProfit.toFixed(2)} ({sellProfitPct >= 0 ? '+' : ''}{sellProfitPct.toFixed(2)}%)
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>剩余持股</div>
                        <div style={{ fontWeight: '700', marginTop: '2px' }}>{remainShares} 股</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>卖出后可用</div>
                        <div style={{ fontWeight: '700', marginTop: '2px', color: 'var(--accent-blue)' }}>¥{(newAvailable / 10000).toFixed(2)}万</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>卖出后总市值</div>
                        <div style={{ fontWeight: '700', marginTop: '2px' }}>¥{(newTotalValue / 10000).toFixed(2)}万</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>总资产</div>
                        <div style={{ fontWeight: '700', marginTop: '2px' }}>¥{((newAvailable + newTotalValue) / 10000).toFixed(2)}万</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 错误提示 */}
                {qty > origShares && (
                  <div style={{ color: 'var(--accent-red)', fontSize: '12px', marginBottom: '12px' }}>⚠️ 卖出数量不能超过持仓数量 {origShares} 股</div>
                )}

                {/* 操作按钮 */}
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={() => setSellTarget(null)}
                    style={{ flex: 1, padding: '12px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', overflow: 'hidden', minWidth: 0
    }}>
                    取消
                  </button>
                  <button
                    disabled={!isValid || selling}
                    onClick={async () => {
                      if (!isValid || selling) return;
                      setSelling(true);
                      try {
                        if (qty >= origShares) {
                          // 全部卖出：删除持仓
                          await holdingAPI.remove(h.code);
                        } else {
                          // 部分卖出：更新持股数
                          await holdingAPI.update(h.code, {
                            shares: remainShares,
                            cost_price: costPrice, // 成本不变
                          });
                        }
                        // 卖出后：卖出金额回到可用资金，总资产不变
                        const currentAvail = capital?.available_capital || 0;
                        await capitalAPI.setConfig({ available_capital: currentAvail + sellAmount });
                        setSellTarget(null);
                        fetchData();
                        const cap = await capitalAPI.getConfig();
                        if (cap) setCapital(cap);
                      } catch (e) {
                        console.error('卖出失败:', e);
                      } finally {
                        setSelling(false);
                      }
                    }}
                    style={{ flex: 2, padding: '12px', border: 'none', borderRadius: '10px', background: isValid ? 'var(--accent-red)' : 'var(--bg-tertiary)', color: isValid ? 'white' : 'var(--text-tertiary)', cursor: isValid ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: '700', overflow: 'hidden', minWidth: 0
    }}>
                    {selling ? '卖出中...' : `确认卖出 ${qty > 0 ? qty + '股' : ''}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
