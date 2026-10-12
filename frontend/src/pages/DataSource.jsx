import { useState, useEffect } from 'react';
import { bjISO } from '../utils/beijingTime';
import { healthAPI } from '../config/api';



// 状态颜色映射
const statusConfig = {
  healthy:  { color: 'var(--accent-green)',  label: '正常',  bg: 'rgba(52,199,89,0.1)'  },
  degraded: { color: 'var(--accent-orange)', label: '降级',  bg: 'rgba(255,149,0,0.1)'  },
  failed:   { color: 'var(--accent-red)',    label: '故障',  bg: 'rgba(255,59,48,0.1)'  },
  unknown:  { color: 'var(--text-tertiary)', label: '未知',  bg: 'var(--bg-tertiary)'   },
};

// 数据源分组配置
const SOURCE_GROUPS = {
  '行情数据': ['eastmoney', 'sina', 'tencent', 'netease', 'sse', 'szse'],
  '情绪分析': ['social_sentiment', 'report'],
  '资金动向': ['money_flow', 'longhubang'],
  '全球市场': ['global_markets'],
};

// 数据源图标
const SOURCE_ICONS = {
  eastmoney: '📈',
  sina: '📊',
  tencent: '💹',
  netease: '📉',
  sse: '🏛️',
  szse: '🏛️',
  global_markets: '🌍',
  money_flow: '💰',
  social_sentiment: '💭',
  longhubang: '🐉',
  report: '📋',
};

// 数据源卡片
function SourceCard({ source, onAction }) {
  const cfg = statusConfig[source.status] || statusConfig.unknown;
  const [expanded, setExpanded] = useState(true); // 默认展开
  const icon = SOURCE_ICONS[source.key] || '📡';

  return (
    <div className="ds-card">
      {/* 卡片头部 */}
      <div className="ds-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="ds-card-left">
          {/* 状态指示灯 */}
          <span className="ds-dot" style={{
            background: cfg.color,
            boxShadow: source.status === 'healthy' ? `0 0 6px ${cfg.color}` : 'none',
          }} />
          <div className="ds-card-info">
            <div className="ds-card-name-row">
              <span className="ds-icon">{icon}</span>
              <span className="ds-name">{source.name}</span>
              {source.badge && (
                <span className="ds-badge" style={{ background: cfg.bg, color: cfg.color }}>
                  {source.badge}
                </span>
              )}
            </div>
            <span className="ds-type">{source.description || source.type}</span>
          </div>
        </div>
        <div className="ds-card-right">
          {source.avgResponseTime > 0 && (
            <span className="ds-latency">{source.avgResponseTime}ms</span>
          )}
          <span className="ds-status-badge" style={{ background: cfg.bg, color: cfg.color }}>
            {cfg.label}
          </span>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
            style={{
              color: 'var(--text-tertiary)',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="ds-card-detail">
          <p className="ds-desc">{source.description}</p>

          {source.unavailableReason && source.status !== 'healthy' && (
            <div className="ds-alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
              {source.unavailableReason}
            </div>
          )}

          <div className="ds-metrics">
            <div className="ds-metric">
              <span className="ds-metric-label">总请求</span>
              <span className="ds-metric-value">{(source.totalRequests || 0).toLocaleString()}</span>
            </div>
            <div className="ds-metric">
              <span className="ds-metric-label">成功/失败</span>
              <span className="ds-metric-value">
                <span style={{ color: 'var(--accent-green)' }}>{source.successCount || 0}</span>
                /
                <span style={{ color: source.failureCount > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                  {source.failureCount || 0}
                </span>
              </span>
            </div>
            <div className="ds-metric">
              <span className="ds-metric-label">最后更新</span>
              <span className="ds-metric-value">
                {source.lastSuccess ? new Date(source.lastSuccess).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}
              </span>
            </div>
            {source.maxRequestsPerMinute && (
              <div className="ds-metric">
                <span className="ds-metric-label">频率限制</span>
                <span className="ds-metric-value">{source.maxRequestsPerMinute}/分钟</span>
              </div>
            )}
          </div>

          <div className="ds-freq-info">
            <span className="ds-freq-label">官方频率:</span>
            <span className="ds-freq-value">{source.officialFrequency || '未知'}</span>
            <span className="ds-freq-label" style={{ marginLeft: '12px' }}>系统频率:</span>
            <span className="ds-freq-value">{source.systemFrequency || '未配置'}</span>
          </div>

          <div className="ds-actions">
            {source.enabled === false ? (
              <button className="btn btn-primary btn-sm" onClick={() => onAction('enable', source.key)}>
                启用
              </button>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => onAction('disable', source.key)}>
                禁用
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => onAction('reset', source.key)}>
              重置统计
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 整体健康度仪表
function HealthGauge({ sources }) {
  const healthy = sources.filter(s => s.status === 'healthy').length;
  const total = sources.length;
  const pct = total > 0 ? Math.round(healthy / total * 100) : 0;
  const color = pct >= 80 ? 'var(--accent-green)' : pct >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';

  return (
    <div className="ds-gauge-card">
      <div className="ds-gauge-ring" style={{ '--pct': pct, '--color': color }}>
        <div className="ds-gauge-inner">
          <span className="ds-gauge-value" style={{ color }}>{pct}%</span>
          <span className="ds-gauge-label">健康度</span>
        </div>
      </div>
      <div className="ds-gauge-stats">
        <div className="ds-gauge-stat">
          <span style={{ color: 'var(--accent-green)' }}>{healthy}</span>
          <span>正常</span>
        </div>
        <div className="ds-gauge-stat">
          <span style={{ color: 'var(--accent-orange)' }}>
            {sources.filter(s => s.status === 'degraded').length}
          </span>
          <span>降级</span>
        </div>
        <div className="ds-gauge-stat">
          <span style={{ color: 'var(--accent-red)' }}>
            {sources.filter(s => s.status === 'failed').length}
          </span>
          <span>故障</span>
        </div>
      </div>
    </div>
  );
}

export default function DataSource() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [stats, setStats] = useState(null);

  const fetchSources = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [res, healthRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/datasource/status`),
        healthAPI.get().catch(() => ({ success: false })),
        fetch(`${API_BASE}/datasource/stats`).then(r => r.json()).catch(() => null)
      ]);
      const data = await res.json();
      if (data.success) {
        setSources(data.datasource?.sources || data.sources || data.dataSourceStatus || []);
        setLastRefresh(bjISO());
      }
      if (healthRes.success) setHealth(healthRes);
      if (statsRes?.success) {
        // stats可能是数组(每源详情)或对象(汇总)
        if (Array.isArray(statsRes.stats)) {
          const arr = statsRes.stats;
          const total = arr.reduce((s, x) => s + (x.stats?.totalRequests || 0), 0);
          const success = arr.reduce((s, x) => s + (x.stats?.totalSuccess || 0), 0);
          const active = arr.filter(x => x.status === 'healthy').length;
          setStats({ totalRequests: total, successRate: total > 0 ? success/total : 0, activeSources: active });
        } else {
          setStats(statsRes.stats);
        }
      }
    } catch (e) {
      console.error('获取数据源失败:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 测试所有数据源
  const handleTestAll = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/datasource/test`, { method: 'POST' });
      const data = await res.json();
      if (data.success) setTestResult(data);
    } catch (e) { console.error('测试失败:', e); }
    setTesting(false);
  };

  // 刷新全部数据
  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await fetch(`${API_BASE}/datasource/refresh`, { method: 'POST' });
      await fetchSources();
    } catch (e) { console.error('刷新失败:', e); }
    setRefreshing(false);
  };

  useEffect(() => {
    fetchSources();
    const t = setInterval(() => fetchSources(), 30000);
    return () => clearInterval(t);
  }, []);

  const handleAction = async (action, key) => {
    try {
      const endpoint = action === 'enable'  ? `/datasource/enable/${key}`
                     : action === 'disable' ? `/datasource/disable/${key}`
                     : `/datasource/reset/${key}`;
      await fetch(`${API_BASE}${endpoint}`, { method: 'POST' });
      fetchSources();
    } catch (e) {}
  };

  if (loading) return <div className="loading"><div className="loading-spinner" /></div>;

  const totalReqs = sources.reduce((s, src) => s + (src.totalRequests || 0), 0);
  const avgLatency = sources.filter(s => s.responseTime > 0).reduce((s, src, _, arr) =>
    s + src.responseTime / arr.length, 0);

  return (
    <div className="ds-page">
      {/* 页面标题 */}
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">数据源管理</h1>
            <p className="page-subtitle">
              {lastRefresh ? `上次刷新 ${lastRefresh.toLocaleTimeString('zh-CN', { hour12: false })}` : '实时监控数据源状态'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={handleTestAll} disabled={testing}>
              {testing ? '测试中...' : '测试全部'}
            </button>
            <button className="btn btn-primary" onClick={handleRefreshAll} disabled={refreshing}>
              {refreshing ? '刷新中...' : '刷新数据'}
            </button>
          </div>
        </div>
      </div>

      {/* 顶部统计 */}
      <div className="ds-summary">
        <HealthGauge sources={sources} />
        <div className="ds-summary-stats">
          <div className="stat-card">
            <span className="stat-label">数据源总数</span>
            <span className="stat-value">{sources.length}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">总请求次数</span>
            <span className="stat-value">{(stats?.totalRequests || totalReqs).toLocaleString()}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">平均响应</span>
            <span className="stat-value">{avgLatency > 0 ? `${avgLatency.toFixed(0)}ms` : '—'}</span>
          </div>
          {stats?.activeSources && (
            <div className="stat-card">
              <span className="stat-label">活跃源</span>
              <span className="stat-value">{stats.activeSources}</span>
            </div>
          )}
          {stats?.successRate !== undefined && (
            <div className="stat-card">
              <span className="stat-label">成功率</span>
              <span className="stat-value">{(stats.successRate * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* 后端健康状态 */}
      {health && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(0,122,255,0.1), rgba(114,46,209,0.05))',
          border: '1px solid rgba(0,122,255,0.2)',
          borderRadius: '14px',
          padding: '16px',
          marginBottom: '20px',
overflow: 'hidden',
      minWidth: 0
    }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
              后端系统状态
            </span>
            <span style={{
              fontSize: '12px',
              fontWeight: '600',
              padding: '4px 10px',
              borderRadius: '6px',
              background: health.status === 'ok' ? 'rgba(52,199,89,0.2)' : 'rgba(255,149,0,0.2)',
              color: health.status === 'ok' ? 'var(--accent-green)' : 'var(--accent-orange)',
overflow: 'hidden',
      minWidth: 0
    }}>
              {health.status === 'ok' ? '✓ 正常' : '⚠ 降级'}
            </span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            <div>时间戳: {new Date(health.timestamp).toLocaleString('zh-CN', { hour12: false })}</div>
            {health.isPeakHour && <div>⚠ 当前为高峰时段</div>}
          </div>
        </div>
      )}

      {/* 系统健康检查 */}
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '14px',
        padding: '16px',
        marginBottom: '20px',
overflow: 'hidden',
      minWidth: 0
    }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '15px', fontWeight: '600' }}>系统健康检查</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                try {
                  const res = await fetch(`${API_BASE}/system/health_check`);
                  const data = await res.json();
                  if (data.success) setHealth(data);
                } catch (e) {}
              }}
            >
              检查
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                if (confirm('确定要执行自动修复吗？')) {
                  try {
                    const res = await fetch(`${API_BASE}/system/self_heal`, { method: 'POST' });
                    const data = await res.json();
                    if (data.success) alert(data.message + '\n' + (data.actions || []).join('\n'));
                  } catch (e) {}
                }
              }}
            >
              自动修复
            </button>
          </div>
        </div>
        {health?.health && (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px', minWidth: 0, overflow: 'hidden'}}>
              <div><strong>运行时间</strong><br/>{Math.floor(health.health.uptime / 3600)}小时</div>
              <div><strong>内存占用</strong><br/>{health.health.memory?.heapUsed}</div>
              <div><strong>状态</strong><br/>
                <span style={{ color: health.health.status === 'healthy' ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                  {health.health.status === 'healthy' ? '健康' : '需要关注'}
                </span>
              </div>
            </div>
            {health.health.data && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px', minWidth: 0, overflow: 'hidden'}}>
                <span>股票 {health.health.data.stocks}</span>
                <span>行情 {health.health.data.realtime}</span>
                <span>分支 {health.health.data.branches}</span>
                <span>信号 {health.health.data.signals}</span>
                <span>持仓 {health.health.data.holdings}</span>
                <span>池 {health.health.data.pool}</span>
              </div>
            )}
            {health.health.issues?.length > 0 && (
              <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(255,149,0,0.1)', borderRadius: '8px', overflow: 'hidden', minWidth: 0
    }}>
                {health.health.issues.map((issue, i) => (
                  <div key={i} style={{ color: issue.severity === 'error' ? 'var(--accent-red)' : 'var(--accent-orange)' }}>
                    ⚠ {issue.module}: {issue.issue}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 测试结果弹窗 */}
      {testResult && (
        <div style={{ background: 'rgba(0,0,0,0.5)', position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setTestResult(null)}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: '16px', padding: '24px', maxWidth: '500px', width: '90%', overflow: 'hidden', minWidth: 0
    }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>数据源测试结果</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {testResult.results?.map(r => (
                <div key={r.key} style={{ padding: '8px 12px', borderRadius: '8px', background: r.status === 'healthy' ? 'rgba(52,199,89,0.15)' : 'rgba(255,59,48,0.15)', border: `1px solid ${r.status === 'healthy' ? 'var(--accent-green)' : 'var(--accent-red)'}` }}>
                  <span style={{ fontWeight: '600' }}>{r.name}</span>
                  <span style={{ marginLeft: '8px', color: r.status === 'healthy' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {r.status === 'healthy' ? `✓ ${r.responseTime}ms` : `✗ ${r.error?.slice(0,20)}`}
                  </span>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary" style={{ marginTop: '16px' }} onClick={() => setTestResult(null)}>关闭</button>
          </div>
        </div>
      )}

      {/* 数据源列表 - 分组展示 */}
      <div className="ds-list">
        {Object.entries(SOURCE_GROUPS).map(([groupName, groupKeys]) => {
          const groupSources = sources.filter(s => groupKeys.includes(s.key));
          if (groupSources.length === 0) return null;
          
          return (
            <div key={groupName} className="ds-group">
              <div className="ds-group-header">
                <h3 className="ds-group-title">{groupName}</h3>
                <span className="ds-group-count">
                  {groupSources.filter(s => s.status === 'healthy').length}/{groupSources.length} 正常
                </span>
              </div>
              <div className="ds-group-list">
                {groupSources.map((src, i) => (
                  <SourceCard key={src.key || src.name || i} source={src} onAction={handleAction} />
                ))}
              </div>
            </div>
          );
        })}
        
        {/* 未分组的数据源 */}
        {(() => {
          const groupedKeys = Object.values(SOURCE_GROUPS).flat();
          const ungrouped = sources.filter(s => !groupedKeys.includes(s.key));
          if (ungrouped.length === 0) return null;
          return (
            <div className="ds-group">
              <div className="ds-group-header">
                <h3 className="ds-group-title">其他数据源</h3>
                <span className="ds-group-count">
                  {ungrouped.filter(s => s.status === 'healthy').length}/{ungrouped.length} 正常
                </span>
              </div>
              <div className="ds-group-list">
                {ungrouped.map((src, i) => (
                  <SourceCard key={src.key || src.name || i} source={src} onAction={handleAction} />
                ))}
              </div>
            </div>
          );
        })()}
        
        {sources.length === 0 && (
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
              <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>
            </svg>
            <p>暂无数据源</p>
          </div>
        )}
      </div>
    </div>
  );
}
