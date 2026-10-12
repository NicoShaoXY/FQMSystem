// 股票实时数据获取 - 使用本地后端代理
import { API_BASE } from '../config/api';
import { toBeijingTime } from './beijingTime';

export async function fetchStockRealTime(code) {
  if (!code || code.length < 6) {
    console.error('股票代码格式错误:', code);
    return null;
  }
  
  try {
    // 使用后端 API 获取股票数据
    const response = await fetch(`${API_BASE}/stock/${code}`);
    const data = await response.json();
    
    if (data.success && data.stock) {
      const stock = data.stock;
      return {
        code: stock.code,
        name: stock.name,
        price: stock.price || 0,
        open: stock.open || stock.price,
        high: stock.high || stock.price,
        low: stock.low || stock.price,
        preClose: stock.preClose || stock.price,
        change: stock.change || 0,
        changePercent: stock.changePercent || stock.change_percent || 0,
        volume: stock.volume || 0,
        amount: stock.amount || 0,
        time: (() => { const t = toBeijingTime(); const p = n => String(n).padStart(2,'0'); return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`; })(),
      };
    }
    
    return null;
  } catch (error) {
    console.error('获取股票实时数据失败:', code, error);
    return null;
  }
}

export async function fetchMultipleStocksRealTime(codes) {
  if (!codes || codes.length === 0) return [];
  
  try {
    const response = await fetch(`${API_BASE}/stocks?limit=1000`);
    const data = await response.json();
    
    if (data.success && data.stocks) {
      const stockMap = {};
      data.stocks.forEach(s => {
        stockMap[s.code] = s;
      });
      
      return codes.map(code => {
        const stock = stockMap[code];
        if (stock) {
          return {
            code: stock.code,
            name: stock.name,
            price: stock.price || 0,
            changePercent: stock.changePercent || stock.change_percent || 0,
            volume: stock.volume || 0,
          };
        }
        return null;
      }).filter(Boolean);
    }
    
    return [];
  } catch (error) {
    console.error('批量获取股票数据失败:', error);
    return [];
  }
}

export default {
  fetchStockRealTime,
  fetchMultipleStocksRealTime,
};
