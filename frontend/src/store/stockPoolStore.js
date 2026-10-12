import { create } from 'zustand';
import {
  fetchStockPool,
  fetchStockDetail,
  fetchYaodiAnalysis,
  formatYi,
  formatPercent,
} from '../services/realTimeData';

let API_BASE = 'http://localhost:8769/api';

const useStockPoolStore = create((set, get) => ({
  // 收藏股列表
  stocks: [],
  
  // 加载状态
  loading: false,
  lastUpdate: null,
  
  // ═══════════════════════════════════════════════════════════════
  // 数据加载方法
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 从服务器加载股票池数据
   */
  loadStockPool: async () => {
    set({ loading: true });
    
    try {
      const response = await fetch(`${API_BASE}/pool/list`);
      const data = await response.json();
      
      if (data.success) {
        set({ 
          stocks: data.pool || [],
          lastUpdate: bjISO(),
        });
      }
      
      set({ loading: false });
      
    } catch (e) {
      console.error('加载股票池失败:', e);
      set({ loading: false });
    }
  },
  
  /**
   * 添加股票到收藏
   */
  addStock: async (code, name) => {
    // 先检查是否已存在
    const exists = get().stocks.some(s => s.code === code);
    if (exists) {
      return { success: false, message: '该股票已在收藏列表中' };
    }
    
    try {
      // 先获取股票详情
      const detailRes = await fetch(`${API_BASE}/stock/${code}`);
      const detailData = await detailRes.json();
      
      const stockInfo = {
        code,
        name: name || detailData?.stock?.name || code,
        price: detailData?.stock?.price || 0,
        changePercent: detailData?.stock?.changePercent || 0,
        volume: detailData?.stock?.volume || 0,
      };
      
      // 添加到数据库
      const response = await fetch(`${API_BASE}/pool/list/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stockInfo),
      });
      
      const data = await response.json();
      
      if (data.success) {
        await get().loadStockPool();
        return { success: true, message: '添加成功' };
      }
      
      return { success: false, message: data.error || '添加失败' };
      
    } catch (e) {
      console.error('添加股票失败:', e);
      return { success: false, message: e.message };
    }
  },
  
  /**
   * 移除股票
   */
  removeStock: async (code) => {
    try {
      const response = await fetch(`${API_BASE}/pool/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        set(state => ({
          stocks: state.stocks.filter(s => s.code !== code),
        }));
      }
      
    } catch (e) {
      console.error('移除股票失败:', e);
    }
  },
  
  /**
   * 批量移除
   */
  removeStocks: async (codes) => {
    for (const code of codes) {
      await get().removeStock(code);
    }
  },
  
  /**
   * 智能分析单只股票
   */
  analyzeStock: async (code) => {
    const stock = get().stocks.find(s => s.code === code);
    if (!stock) return null;
    
    try {
      const response = await fetch(`${API_BASE}/quant/voting?code=${encodeURIComponent(code)}`);
      const data = await response.json();
      
      if (data.success && data.analysis) {
        // 更新本地缓存
        set(state => ({
          stocks: state.stocks.map(s => 
            s.code === code ? { ...s, ...data.analysis, lastAnalysis: bjISO() } : s
          ),
        }));
        
        return data.analysis;
      }
      
      return null;
      
    } catch (e) {
      console.error('分析股票失败:', e);
      return null;
    }
  },
  
  /**
   * 批量分析所有收藏股
   */
  analyzeAll: async () => {
    const stocks = get().stocks;
    
    for (const stock of stocks) {
      await get().analyzeStock(stock.code);
      // 避免请求过快
      await new Promise(r => setTimeout(r, 100));
    }
  },
  
  /**
   * 刷新行情数据
   */
  refreshPrices: async () => {
    const stocks = get().stocks;
    
    try {
      // 批量获取最新价格
      const codes = stocks.map(s => s.code).join(',');
      const response = await fetch(`${API_BASE}/stocks/batch?codes=${codes}`);
      const data = await response.json();
      
      if (data.success && data.stocks) {
        const priceMap = {};
        data.stocks.forEach(s => {
          priceMap[s.code] = s;
        });
        
        set(state => ({
          stocks: state.stocks.map(s => {
            const latest = priceMap[s.code];
            if (latest) {
              return {
                ...s,
                price: latest.price,
                changePercent: latest.changePercent || latest.change,
                volume: latest.volume,
              };
            }
            return s;
          }),
          lastUpdate: bjISO(),
        }));
      }
      
    } catch (e) {
      console.error('刷新行情失败:', e);
    }
  },
  
  /**
   * 批量添加到持仓
   */
  transferToHolding: async (codes, quantity = 100) => {
    try {
      for (const code of codes) {
        const stock = get().stocks.find(s => s.code === code);
        if (stock) {
          // 添加到持仓
          await fetch(`${API_BASE}/holdings/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: stock.code,
              name: stock.name,
              shares: quantity,
              cost_price: stock.price,
              current_price: stock.price,
            }),
          });
          
          // 从股票池移除
          await get().removeStock(code);
        }
      }
      
    } catch (e) {
      console.error('移入持仓失败:', e);
    }
  },
  
  /**
   * 获取分析报告
   */
  getAnalysisReport: () => {
    const stocks = get().stocks;
    
    const summary = {
      total: stocks.length,
      buyCount: 0,
      holdCount: 0,
      sellCount: 0,
      avgUpProb: 0,
      highRiskCount: 0,
    };
    
    stocks.forEach(s => {
      const rec = s.recommendation?.toLowerCase() || '';
      if (rec.includes('买')) summary.buyCount++;
      else if (rec.includes('卖') || rec.includes('规避')) summary.sellCount++;
      else summary.holdCount++;
      
      if (s.upProbability) {
        summary.avgUpProb += s.upProbability;
      }
      
      if (s.riskLevel?.includes('高')) {
        summary.highRiskCount++;
      }
    });
    
    if (stocks.length > 0) {
      summary.avgUpProb = (summary.avgUpProb / stocks.length).toFixed(1);
    }
    
    return summary;
  },
}));

export default useStockPoolStore;
