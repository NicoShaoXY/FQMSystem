import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

function useBodyScrollLock(isOpen) {
  useEffect(() => {
    if (isOpen) {
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
      return () => {
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
      };
    }
  }, [isOpen]);
}

export default function IntradayChart({ code, name, onClose }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preClose, setPreClose] = useState(0);

  useBodyScrollLock(!!code);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setError(null);
    fetch(`/api/stock/intraday/${code}`)
      .then(r => r.json())
      .then(res => {
        if (res.trends && res.trends.length > 0) {
          setData(res.trends);
          setPreClose(res.preClose || 0);
        } else {
          setError('暂无分时数据');
        }
      })
      .catch(() => setError('获取分时数据失败'))
      .finally(() => setLoading(false));
  }, [code]);

  if (!code) return null;

  // 均线参考
  const avgPrice = data.length > 0 ? data[data.length - 1].avg_price : 0;
  const lastPrice = data.length > 0 ? data[data.length - 1].price : 0;
  const changePct = preClose > 0 ? ((lastPrice - preClose) / preClose * 100) : 0;
  const isUp = changePct >= 0;

  // 时间范围
  const times = data.map(d => d.time);
  const prices = data.map(d => d.price);
  const volumes = data.map(d => d.volume);
  const minPrice = Math.min(...prices, preClose) * 0.998;
  const maxPrice = Math.max(...prices, preClose) * 1.002;
  const maxVol = Math.max(...volumes, 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="modal-card w-[900px] max-h-[80vh] p-0 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">{name || code}</span>
            <span className="text-sm text-[var(--text-secondary)]">{code}</span>
            <span className={`text-lg font-mono font-bold ${isUp ? 'text-red-400' : 'text-green-400'}`}>
              {lastPrice != null ? Number(lastPrice).toFixed(2) : '--'}
            </span>
            <span className={`text-sm ${isUp ? 'text-red-400' : 'text-green-400'}`}>
              {isUp ? '+' : ''}{changePct != null ? Number(changePct).toFixed(2) : '--'}%
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X size={18} className="text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {loading && (
            <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
              <div className="animate-spin mr-2">⏳</div> 加载分时数据...
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
              {error}
            </div>
          )}
          {!loading && !error && (
            <>
              {/* 价格分时图 */}
              <div className="mb-2">
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#666' }} interval={29} />
                    <YAxis
                      domain={[minPrice, maxPrice]}
                      tick={{ fontSize: 10, fill: '#666' }}
                      tickFormatter={v => v != null ? Number(v).toFixed(2) : '--'}
                    />
                    <Tooltip
                      contentStyle={{ background: 'rgba(15,15,25,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      formatter={(value, name) => {
                        if (name === 'price') return [value != null ? Number(value).toFixed(2) : '--', '价格'];
                        if (name === 'avg_price') return [value != null ? Number(value).toFixed(2) : '--', '均价'];
                        return [value, name];
                      }}
                    />
                    {preClose > 0 && (
                      <ReferenceLine y={preClose} stroke="rgba(255,255,255,0.3)" strokeDasharray="5 5" />
                    )}
                    <Area
                      type="monotone"
                      dataKey="avg_price"
                      stroke="#eab308"
                      strokeWidth={1}
                      dot={false}
                      fill="none"
                      strokeDasharray="4 2"
                    />
                    <Area
                      type="monotone"
                      dataKey="price"
                      stroke={isUp ? '#ef4444' : '#22c55e'}
                      strokeWidth={1.5}
                      dot={false}
                      fill={isUp ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)'}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* 成交量 */}
              <ResponsiveContainer width="100%" height={80}>
                <ComposedChart data={data} margin={{ top: 0, right: 10, left: 10, bottom: 5 }}>
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#666' }} interval={29} />
                  <YAxis hide />
                  <Bar
                    dataKey="volume"
                    fill="rgba(100,150,255,0.3)"
                    radius={[2, 2, 0, 0]}
                  />
                </ComposedChart>
              </ResponsiveContainer>

              {/* 图例说明 */}
              <div className="flex items-center gap-6 mt-2 text-xs text-[var(--text-tertiary)]">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-white/30" style={{ borderTop: '1px dashed rgba(255,255,255,0.5)' }}></span>
                  昨收 {preClose > 0 ? (preClose != null ? Number(preClose).toFixed(2) : '--') : '-'}
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-yellow-500"></span>
                  均价 {avgPrice != null ? Number(avgPrice).toFixed(2) : '--'}
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5" style={{ background: isUp ? '#ef4444' : '#22c55e' }}></span>
                  分时线
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
