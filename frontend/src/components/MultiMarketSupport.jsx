/**
 * 多市场支持组件 - P2优化
 * 显示A股/港股/美股市场状态、支持切换
 */
import { useState } from 'react';
import { Globe, TrendingUp, TrendingDown, Clock, AlertCircle } from 'lucide-react';

// 市场配置
const MARKETS = [
  {
    id: 'a-share',
    name: 'A股',
    flag: '🇨🇳',
    status: 'active',
    desc: '沪深主板+创业板+科创板',
    tradingHours: '09:30-15:00',
    dataSources: ['东方财富', '腾讯财经', '新浪财经'],
  },
  {
    id: 'hk',
    name: '港股',
    flag: '🇭🇰',
    status: 'planned',
    desc: '港交所主板+创业板',
    tradingHours: '09:30-16:00',
    dataSources: ['雅虎财经', '东方财富港股'],
  },
  {
    id: 'us',
    name: '美股',
    flag: '🇺🇸',
    status: 'planned',
    desc: '纽交所+纳斯达克',
    tradingHours: '21:30-04:00 (次日)',
    dataSources: ['雅虎财经', 'Alpha Vantage'],
  },
  {
    id: 'futures',
    name: '期货',
    flag: '📊',
    status: 'planned',
    desc: '商品期货+金融期货',
    tradingHours: '09:00-15:00, 21:00-次日02:30',
    dataSources: ['文华财经', '东方财富期货'],
  },
];

export default function MultiMarketSupport({ compact = false }) {
  const [activeMarket, setActiveMarket] = useState('a-share');

  // 样式
  const cardStyle = {
    background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(59,130,246,0.1))',
    borderRadius: 12,
    padding: compact ? 12 : 16,
    border: '1px solid rgba(16,185,129,0.2)',
  };

  if (compact) {
    const market = MARKETS.find(m => m.id === activeMarket);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...cardStyle }}>
        <Globe size={16} style={{ color: '#10b981' }} />
        <span style={{ fontSize: 16 }}>{market?.flag}</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{market?.name}</span>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Globe size={18} style={{ color: '#10b981' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>多市场支持</span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 10,
          padding: '2px 6px',
          background: 'rgba(16,185,129,0.2)',
          borderRadius: 4,
          color: '#10b981',
        }}>
          P2规划
        </span>
      </div>

      {/* 市场列表 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {MARKETS.map(market => (
          <div
            key={market.id}
            onClick={() => market.status === 'active' && setActiveMarket(market.id)}
            style={{
              background: activeMarket === market.id ? 'rgba(16,185,129,0.15)' : 'rgba(0,0,0,0.2)',
              borderRadius: 8,
              padding: 12,
              cursor: market.status === 'active' ? 'pointer' : 'not-allowed',
              opacity: market.status === 'active' ? 1 : 0.6,
              border: activeMarket === market.id ? '1px solid rgba(16,185,129,0.3)' : '1px solid transparent',
            }}
          >
            {/* 头部 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{market.flag}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{market.name}</span>
              {market.status === 'active' ? (
                <span style={{
                  fontSize: 9,
                  padding: '1px 4px',
                  background: 'rgba(16,185,129,0.3)',
                  borderRadius: 3,
                  color: '#10b981',
                }}>
                  运行中
                </span>
              ) : (
                <span style={{
                  fontSize: 9,
                  padding: '1px 4px',
                  background: 'rgba(245,158,11,0.3)',
                  borderRadius: 3,
                  color: '#f59e0b',
                }}>
                  规划中
                </span>
              )}
            </div>

            {/* 描述 */}
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {market.desc}
            </div>

            {/* 交易时间 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-secondary)' }}>
              <Clock size={10} />
              {market.tradingHours}
            </div>

            {/* 数据源 */}
            <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {market.dataSources.map(src => (
                <span
                  key={src}
                  style={{
                    fontSize: 9,
                    padding: '1px 4px',
                    background: 'rgba(99,102,241,0.15)',
                    borderRadius: 3,
                    color: '#6366f1',
                  }}
                >
                  {src}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 说明 */}
      <div style={{
        marginTop: 12,
        padding: '8px 12px',
        background: 'rgba(245,158,11,0.1)',
        borderRadius: 6,
        fontSize: 11,
        color: '#f59e0b',
      }}>
        💡 港股/美股/期货支持正在规划中，预计Q3 2026上线
      </div>
    </div>
  );
}
