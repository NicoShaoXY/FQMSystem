import { useState, useEffect, useRef, useCallback } from 'react';
import { useMarketStore } from '../store/store';
import { marketAPI, stockAPI, sentimentAPI, smartAPI, historyAPI } from '../config/api';

// 相对时间
const relativeTime = (isoStr) => {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
};

// 影响周期
const impactCycle = (sentiment, hot) => {
  const intensity = Math.abs((sentiment || 0) - 0.5) * 2;
  if (hot && intensity > 0.7) return '长期';
  if (intensity > 0.6) return '中期';
  if (intensity > 0.3) return '短期';
  return '瞬时';
};

const Icon = ({ name, size = 20 }) => {
  const icons = {
    up: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>,
    down: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>,
    chart: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 5-6"/></svg>,
    brain: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>,
    clock: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    globe: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  };
  return icons[name] || null;
};

function StatCard({ label, value, change, subValue, icon, highlight }) {
  return (
    <div className={`stat-card ${highlight ? 'highlight' : ''}`}>
      <div className="stat-header">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {(change !== undefined || subValue) && (
        <div className="stat-change">
          {change !== undefined && <span>{change}</span>}
          {subValue && <span className="sub-value">{subValue}</span>}
        </div>
      )}
    </div>
  );
}

function IndexCard({ name, code, price, change, changePercent, volume }) {
  const isUp = changePercent >= 0;
  return (
    <div className={`index-card ${isUp ? 'up' : 'down'}`}>
      <div className="index-header">
        <span className="index-name">{name}</span>
        <span className="index-code">{code}</span>
      </div>
      <div className={`index-change ${isUp ? 'up' : 'down'}`}>
        {isUp ? '+' : ''}{changePercent?.toFixed(2)}%
      </div>
      <div className={`index-price ${isUp ? 'up' : 'down'}`}>
        {price?.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
      </div>
      {volume && <div className="index-volume">成交 {(volume / 1e8).toFixed(0)}亿</div>}
    </div>
  );
}

function HotStocksList({ stocks, title }) {
  if (!stocks?.length) return null;
  return (
    <div className="hot-stocks">
      <h3 className="section-title">{title}</h3>
      <div className="stock-list">
        {(() => {
          const seen = new Set();
          const unique = (stocks || []).filter(s => {
            if (!s || s.code == null) return false;
            if (seen.has(s.code)) return false;
            seen.add(s.code);
            return true;
          });
          return unique.slice(0, 8);
        })().map(stock => {
          const isUp = stock.changePercent > 0;
          return (
            <div key={stock.code} className="stock-item">
              <div className="stock-info">
                <span className="stock-name">{stock.name}</span>
                <span className="stock-code">{stock.code}</span>
              </div>
              <div className="stock-price">
                <span className={`price ${isUp ? 'up' : 'down'}`}>{stock.price != null ? Number(stock.price).toFixed(2) : '--'}</span>
                <span className={`change ${isUp ? 'up' : 'down'}`}>
                  {Number(stock.changePercent ?? 0).toFixed(2)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 智能预测面板
function SmartPredictionPanel({ prediction, timing, crossmarket }) {
  if (!prediction && !timing) return null;
  const levelColor = {
    '强势': 'var(--accent-green)',
    '震荡上行': 'var(--accent-blue)',
    '中性': 'var(--text-secondary)',
    '弱势': 'var(--accent-red)',
  };
  const signalColor = {
    'buy': 'var(--accent-green)',
    'sell': 'var(--accent-red)',
    'hold': 'var(--text-secondary)',
    'wait': 'var(--accent-yellow)',
  };
  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px', marginBottom: '20px', overflow: 'hidden', minWidth: 0}}>
      <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Icon name="brain" size={16} /> 智能分析中枢
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', minWidth: 0, overflow: 'hidden'}}>
        {/* 综合预测 */}
        {prediction && (
          <div style={{ background: 'var(--bg-card)', borderRadius: '10px', padding: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', minWidth: 0}}>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>综合预测</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: levelColor[prediction.level] || 'var(--text-primary)' }}>
              {prediction.level || '--'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              置信度 {typeof prediction.confidence === 'string' ? prediction.confidence : Number(prediction.confidence * 100).toFixed(0) + '%'}
            </div>
            {prediction.marketData && (
              <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(52,199,89,0.15)', color: 'var(--accent-green)', overflow: 'hidden', minWidth: 0}}>
                  涨停 {prediction.marketData.limitUp}
                </span>
                <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,59,48,0.15)', color: 'var(--accent-red)', overflow: 'hidden', minWidth: 0}}>
                  跌停 {prediction.marketData.limitDown}
                </span>
              </div>
            )}
          </div>
        )}
        {/* 智能择时 */}
        {timing && (
          <div style={{ background: 'var(--bg-card)', borderRadius: '10px', padding: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', minWidth: 0}}>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Icon name="clock" size={11} /> 智能择时
            </div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: signalColor[timing.signal] || 'var(--text-primary)' }}>
              {timing.signal === 'buy' ? '积极买入' : timing.signal === 'sell' ? '减仓观望' : timing.signal === 'wait' ? '等待时机' : '持仓观察'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {timing.period || '--'} · 强度 {timing.strength || 0}%
            </div>
            {timing.recommendation && (
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px', lineHeight: '1.4' }}>
                {timing.recommendation}
              </div>
            )}
          </div>
        )}
        {/* 跨市场 */}
        {crossmarket && (
          <div style={{ background: 'var(--bg-card)', borderRadius: '10px', padding: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', minWidth: 0}}>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Icon name="globe" size={11} /> 跨市场联动
            </div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: crossmarket.correlation > 0.5 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
              {crossmarket.correlation > 0.7 ? '高度联动' : crossmarket.correlation > 0.4 ? '中度联动' : '低度联动'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              相关系数 {Number(crossmarket.correlation || 0).toFixed(2)}
            </div>
            {crossmarket.markets && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {Object.entries(crossmarket.markets).filter(([k, v]) => v !== null && v !== undefined).slice(0, 3).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>{k}</span>
                    <span style={{ color: v > 0 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: '600' }}>
                      {v > 0 ? '+' : ''}{typeof v === 'number' ? v.toFixed(2) + '%' : '--'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MarketOverview() {
  const [indices, setIndices] = useState([]);
  const [stats, setStats] = useState(null);
  const [hotStocks, setHotStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const [sentiment, setSentiment] = useState(null);
  const [news, setNews] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [timing, setTiming] = useState(null);
  const [crossmarket, setCrossmarket] = useState(null);
  const [socialSentiment, setSocialSentiment] = useState(null);
  const [historyStats, setHistoryStats] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  // 核心数据加载（优先）
  const fetchCoreData = useCallback(async () => {
    const [indicesRes, statsRes, stocksRes] = await Promise.all([
      marketAPI.getIndices(),
      marketAPI.getStats(),
      stockAPI.getAll(),
    ]);
    
    if (indicesRes.success) setIndices(indicesRes.indices || []);
    if (statsRes.success) setStats(statsRes);
    if (stocksRes.success) {
      const sorted = (stocksRes.stocks || []).sort((a, b) =>
        Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0)
      );
      setHotStocks(sorted.slice(0, 16));
    }
  }, []);

  // 次要数据加载（后台）
  const fetchSecondaryData = useCallback(async () => {
        const [sentimentRes, predRes, timingRes, crossRes] = await Promise.all([
      sentimentAPI.getRadar().catch(() => null),
      smartAPI.getPrediction().catch(() => null),
      smartAPI.getTiming().catch(() => null),
      smartAPI.getCrossMarket().catch(() => null),
        ]);
    
    // 情绪雷达数据标准化（API返回扁平结构）
    if (sentimentRes?.success) {
      setSentiment({
        fearGreedIndex: sentimentRes.fearGreedIndex || sentimentRes.score || 50,
        bullBearRatio: sentimentRes.bullBearRatio || 1,
        overallSentiment: sentimentRes.overallSentiment || 50,
        marketMood: sentimentRes.marketMood || sentimentRes.sentiment || '中性',
        hotKeywords: sentimentRes.hotKeywords || [],
      });
    }
    if (predRes?.success) setPrediction(predRes.prediction);
    if (timingRes?.success) setTiming(timingRes.timing);
    if (crossRes?.success) setCrossmarket(crossRes.crossmarket);
  }, []);

  // 可选数据加载（延迟）
  const fetchOptionalData = useCallback(async () => {
    const [newsRes, socialRes, historyRes] = await Promise.all([
      sentimentAPI.getNews().catch(() => null),
      sentimentAPI.getSocial().catch(() => null),
      historyAPI.getStats().catch(() => null),
    ]);
    
    if (newsRes?.success) setNews(newsRes.news || []);
    if (socialRes?.success) setSocialSentiment(socialRes.social || socialRes);
    if (historyRes?.success) setHistoryStats(historyRes.stats);
  }, []);

  const fetchData = useCallback(async () => {
    if (!initialLoadDone.current) setLoading(true);
    try {
      // 先加载核心数据（快速显示）
      await fetchCoreData();
      
      // 核心数据加载完成后立即显示页面
      if (!initialLoadDone.current) {
        setLoading(false);
        initialLoadDone.current = true;
      }
      
      // 后台加载次要数据
      fetchSecondaryData();
      
      // 延迟加载可选数据
      setTimeout(fetchOptionalData, 500);
    } catch (e) {
      console.error('获取市场数据失败:', e);
      setLoading(false);
    }
  }, [fetchCoreData, fetchSecondaryData, fetchOptionalData]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const upCount = stats?.stats?.up ?? 0;
  const downCount = stats?.stats?.down ?? 0;
  const flatCount = stats?.stats?.flat ?? 0;
  const totalStocks = stats?.stats?.total ?? stats?.totalStocks ?? (upCount + downCount + flatCount);

  if (loading) return <div className="loading"><div className="loading-spinner" /></div>;

  return (
    <div className="market-overview">
      <div className="page-header">
        <h1 className="page-title">市场概览</h1>
        <p className="page-subtitle">
          实时市场行情 · 智能分析 · 情绪监测
          {historyStats && (
            <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
              | 历史数据 {historyStats.stock_count} 只 · {(historyStats.total_records || 0).toLocaleString()} 条 ({historyStats.earliest_date} ~ {historyStats.latest_date})
            </span>
          )}
        </p>
      </div>

      {/* 指数卡片 */}
      <div className="indices-grid">
        {indices && indices.length > 0 ? (
          indices.map(idx => <IndexCard key={idx.code} {...idx} />)
        ) : (
          <div className="empty-state"><p>暂无指数数据</p></div>
        )}
      </div>

      {/* 统计卡片 */}
      <div className="stats-grid">
        <StatCard label="实时个股" value={totalStocks} subValue="系统已获取" highlight />
        <StatCard label="上涨家数" value={upCount} change={totalStocks > 0 ? Number(upCount / totalStocks * 100).toFixed(1) + '%' : '--'} highlight />
        <StatCard label="下跌家数" value={downCount} change={totalStocks > 0 ? Number(downCount / totalStocks * 100).toFixed(1) + '%' : '--'} />
        <StatCard label="市场情绪" value={upCount > downCount ? '偏多' : upCount < downCount ? '偏空' : '平衡'} subValue={upCount > downCount ? '多方占优' : upCount < downCount ? '空方占优' : '多空平衡'} />
        <StatCard label="涨跌比" value={`${upCount}:${downCount}`} subValue={`平盘 ${flatCount} 只`} icon={<Icon name="chart" />} />
      </div>

      {/* 智能分析中枢 */}
      <SmartPredictionPanel prediction={prediction} timing={timing} crossmarket={crossmarket} />

      {/* 情绪雷达 + 社交情绪 */}
      {(sentiment || socialSentiment) && (
        <div style={{ display: 'grid', gridTemplateColumns: sentiment && socialSentiment ? '1fr 1fr' : '1fr', gap: '12px', marginBottom: '20px', minWidth: 0, overflow: 'hidden'}}>
          {sentiment && (
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px', overflow: 'hidden', minWidth: 0}}>
              <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '600' }}>市场情绪雷达</h3>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: `conic-gradient(var(--accent-red) ${sentiment.fearGreedIndex * 3.6}deg, var(--bg-tertiary) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', overflow: 'hidden', minWidth: 0}}>
                    <span style={{ fontSize: '18px', fontWeight: '700', color: sentiment.fearGreedIndex > 60 ? 'var(--accent-red)' : sentiment.fearGreedIndex < 40 ? 'var(--accent-green)' : 'var(--text-primary)' }}>{sentiment.fearGreedIndex}</span>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', flex: 1, minWidth: 0, overflow: 'hidden'}}>
                  <div><div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>市场情绪</div><div style={{ fontSize: '15px', fontWeight: '600' }}>{sentiment.marketMood || (sentiment.fearGreedIndex > 60 ? '贪婪' : sentiment.fearGreedIndex < 40 ? '恐惧' : '中性')}</div></div>
                  <div><div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>牛熊比</div><div style={{ fontSize: '15px', fontWeight: '600' }}>{parseFloat(sentiment.bullBearRatio || 1).toFixed(2)}</div></div>
                  <div><div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>综合情绪</div><div style={{ fontSize: '15px', fontWeight: '600' }}>{(sentiment.overallSentiment || 50).toFixed(0)}</div></div>
                  <div><div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>热门关键词</div><div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{(sentiment.hotKeywords || []).join(' ')}</div></div>
                </div>
              </div>
            </div>
          )}
          {socialSentiment && (
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px', overflow: 'hidden', minWidth: 0}}>
              <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '600' }}>
                社交情绪
                {socialSentiment.news?.hotTopics && <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: '400', marginLeft: '8px' }}>({socialSentiment.news.source})</span>}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', minWidth: 0, overflow: 'hidden'}}>
                {[
                  { label: '利好词频', value: socialSentiment.news?.bullish || socialSentiment.bullish || 0, color: 'var(--accent-red)' },
                  { label: '利空词频', value: socialSentiment.news?.bearish || socialSentiment.bearish || 0, color: 'var(--accent-green)' },
                  { label: '涨停家数', value: socialSentiment.limit?.limitUp || socialSentiment.limitUp || '--', color: 'var(--accent-orange)' },
                  { label: '跌停家数', value: socialSentiment.limit?.limitDown || socialSentiment.limitDown || '--', color: 'var(--accent-green)' },
                ].map((item, i) => (
                  <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '10px', overflow: 'hidden', minWidth: 0}}>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{item.label}</div>
                    <div style={{ fontSize: '18px', fontWeight: '700', color: item.color, marginTop: '2px' }}>
                      {item.value || item.value === 0 ? item.value : '--'}
                    </div>
                  </div>
                ))}
              </div>
              {/* 热门话题 */}
              {socialSentiment.news?.hotTopics && socialSentiment.news.hotTopics.length > 0 && (
                <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {socialSentiment.news.hotTopics.slice(0, 4).map((topic, i) => (
                    <span key={i} style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '11px', background: topic.sentiment === '利好' ? 'rgba(255,59,48,0.15)' : 'rgba(52,199,89,0.15)', color: topic.sentiment === '利好' ? 'var(--accent-red)' : 'var(--accent-green)', overflow: 'hidden', minWidth: 0}}>
                      {topic.title?.slice(0, 15)}{topic.title?.length > 15 ? '...' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 新闻舆情 */}
      {news && news.length > 0 && (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px', marginBottom: '20px', overflow: 'hidden', minWidth: 0}}>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '600' }}>市场舆情</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {news.slice(0, 5).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                {item.hot && <span style={{ color: 'var(--accent-red)' }}>🔥</span>}
                <span style={{ flex: 1 }}>{item.title}</span>
                <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0}}>
                  {relativeTime(item.time)}
                </span>
                <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', background: impactCycle(item.sentiment, item.hot) === '长期' ? 'rgba(255,149,0,0.15)' : impactCycle(item.sentiment, item.hot) === '中期' ? 'rgba(82,196,26,0.15)' : 'var(--bg-tertiary)', color: impactCycle(item.sentiment, item.hot) === '长期' ? '#ff9500' : impactCycle(item.sentiment, item.hot) === '中期' ? '#52c41a' : 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0}}>
                  {impactCycle(item.sentiment, item.hot)}
                </span>
                <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', background: (item.sentiment || 0) > 0.5 ? 'rgba(255,59,48,0.15)' : (item.sentiment || 0) < 0.5 ? 'rgba(52,199,89,0.15)' : 'var(--bg-tertiary)', color: (item.sentiment || 0) > 0.5 ? 'var(--accent-red)' : (item.sentiment || 0) < 0.5 ? 'var(--accent-green)' : 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0}}>
                  {(item.sentiment || 0) > 0.5 ? '利好' : (item.sentiment || 0) < 0.5 ? '利空' : '中性'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 热门股票 */}
      <div className="hot-section">
        <HotStocksList stocks={hotStocks.filter(s => s.changePercent > 0)} title="涨幅榜" />
        <HotStocksList stocks={hotStocks.filter(s => s.changePercent < 0)} title="跌幅榜" />
      </div>
    </div>
  );
}
