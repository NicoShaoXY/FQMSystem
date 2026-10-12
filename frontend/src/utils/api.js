// API 基础地址
const API_BASE = 'http://localhost:8769/api';

// 东方财富API配置
export const EASTMONEY_CONFIG = {
  QUOTE_API: 'http://push2.eastmoney.com/api/qt/clist/get',
  STOCK_API: 'http://push2.eastmoney.com/api/qt/stock/get',
  KLINE_API: 'http://push2his.eastmoney.com/api/qt/stock/kline/get',
  FLOW_API: 'http://push2.eastmoney.com/api/qt/stock/fflow/kline/get',
  RANK_API: 'http://datacenter-web.eastmoney.com/api/data/v1/get',
  INDEX_API: 'http://push2.eastmoney.com/api/qt/ulist.np/get',
  BOARD_API: 'http://push2.eastmoney.com/api/qt/clist/get',
};

export const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://quote.eastmoney.com/',
  'Accept': 'application/json, text/plain, */*',
};

// 获取全市场股票列表 (使用东方财富API，分批获取)
export async function fetchAllStocks() {
  try {
    // 东方财富分批获取 - 每批1000只，分6批获取约6000只
    const BATCH_SIZE = 1000;
    const TOTAL_PAGES = 6;
    const MARKET_CODES = 'm:0+t:5,m:0+t:6,m:1+t:2,m:1+t:23'; // 沪深主板+创业板
    
    const allStocks = [];
    
    console.log('📊 开始分批获取全市场股票...');

    // 优先尝试后端全量 API（舜帝数据库中的全量股票）
    try {
      // 添加5秒超时保护
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const backendResp = await fetch(`${API_BASE}/stocks/all`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const backendData = await backendResp.json();
      if (backendData.stocks && backendData.stocks.length > 100) {
        console.log(`📊 从后端全量API获取到 ${backendData.stocks.length} 只股票`);
        return { total: backendData.total || backendData.stocks.length, stocks: backendData.stocks };
      }
    } catch (e) {
      console.log('后端全量API不可用，尝试新浪直连');
    }

    // 新浪财经备用（浏览器直连，非交易时间可能有缓存数据）
    try {
      const resp = await fetch('https://hq.sinajs.cn/list=_sh_sh000001_sz_399001_sz_399006');
      const text = await resp.text();
      if (text && text.length > 10) {
        console.log('📊 新浪财经可用');
      }
    } catch (e) {}
    
    for (let page = 1; page <= TOTAL_PAGES; page++) {
      const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${BATCH_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${MARKET_CODES}&fields=f2,f3,f4,f12,f14,f15,f16,f17&_=${Date.now()}`;
      
      try {
        const response = await fetch(url, {
          headers: REQUEST_HEADERS
        });
        const data = await response.json();
        
        if (data.data && data.data.diff && data.data.diff.length > 0) {
          console.log(`📥 第${page}批: 获取到 ${data.data.diff.length} 只`);
          allStocks.push(...data.data.diff);
        } else {
          console.log(`📥 第${page}批: 无数据，停止获取`);
          break;
        }
        
        // 每批间隔200ms，避免请求过快
        if (page < TOTAL_PAGES) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (err) {
        console.error(`❌ 第${page}批获取失败:`, err);
        // 继续尝试下一批
      }
    }
    
    console.log(`📊 总计获取原始数据 ${allStocks.length} 只，开始过滤...`);
    
    // 过滤股票：排除科创板、北交所、ST股、退市股、无价格股
    const filteredStocks = allStocks.filter(item => {
      const code = item.f12 || '';
      const name = item.f14 || '';
      
      // 过滤科创板: 688开头
      if (code.startsWith('688')) return false;
      // 过滤北交所: 8开头、920开头、9开头
      if (code.startsWith('8') || code.startsWith('920') || code.startsWith('9')) return false;
      // 过滤ST股
      if (name.includes('ST') || name.includes('*ST') || name.includes('S')) return false;
      // 过滤无价格股票
      if (!item.f2 || item.f2 <= 0) return false;
      // 过滤价格异常（低于1元或高于1000元）
      if (item.f2 < 1 || item.f2 > 1000) return false;
      return true;
    }).map(item => ({
      code: item.f12,
      name: item.f14,
      price: item.f2,
      changePercent: item.f3,
      change: item.f4,
      high: item.f15,
      low: item.f16,
      volume: item.f17,
    }));
    
    // 按代码排序
    filteredStocks.sort((a, b) => a.code.localeCompare(b.code));
    
    console.log(`✅ 过滤后最终获得 ${filteredStocks.length} 只股票`);
    return { total: filteredStocks.length, stocks: filteredStocks };
  } catch (error) {
    console.error('获取全市场股票列表失败:', error);
    return { total: 0, stocks: [] };
  }
}

// 辅助函数：尝试解码GBK文本
async function decodeGBKResponse(response) {
  try {
    const buffer = await response.arrayBuffer();
    const encodings = ['gbk', 'gb2312', 'gb18030', 'windows-936'];
    
    for (const encoding of encodings) {
      try {
        const decoder = new TextDecoder(encoding);
        const text = decoder.decode(buffer);
        if (text.includes('~') && (text.includes('沪') || text.includes('深') || /[\u4e00-\u9fff]/.test(text))) {
          return text;
        }
      } catch (e) {
        continue;
      }
    }
    console.warn('无法解码GBK，使用UTF-8解码（可能乱码）');
    return new TextDecoder('utf-8').decode(buffer);
  } catch (error) {
    console.warn('使用arrayBuffer失败，回退到text():', error);
    return await response.text();
  }
}

// 获取单只股票详情
export async function fetchStockDetail(code) {
  if (!code || code.length < 6) {
    console.error('股票代码格式错误:', code);
    return null;
  }
  
  const market = code.startsWith('6') || code.startsWith('9') ? 'sh' : 'sz';
  const url = `https://qt.gtimg.cn/q=${market}${code}`;
  
  try {
    const response = await fetch(url);
    const text = await decodeGBKResponse(response);
    
    const match = text.match(new RegExp(`v_${market}${code}="([^"]+)"`));
    
    if (!match) {
      console.error('未找到股票数据:', code);
      return null;
    }
    
    const parts = match[1].split('~');
    if (parts.length < 40) {
      console.error('数据格式错误:', parts.length, '字段');
      return null;
    }
    
    const price = parseFloat(parts[3]) || 0;
    const preClose = parseFloat(parts[4]) || 0;
    const open = parseFloat(parts[5]) || 0;
    const high = parseFloat(parts[33]) || price;
    const low = parseFloat(parts[34]) || price;
    const volume = parseFloat(parts[6]) || 0;
    
    const change = price - preClose;
    const changePercent = preClose > 0 ? (change / preClose) * 100 : 0;
    
    console.log(`🔍 搜索股票 ${code}: ${parts[1] || '未知'}, 价格=${price}, 涨跌幅=${changePercent.toFixed(2)}%`);
    
    return {
      code,
      name: parts[1] || '未知',
      price,
      preClose,
      open,
      high,
      low,
      volume: volume * 100,
      amount: parseFloat(parts[37]) || 0,
      change,
      changePercent: parseFloat(changePercent.toFixed(2)),
    };
  } catch (error) {
    console.error(`获取股票 ${code} 详情失败:`, error);
    return null;
  }
}

// 获取指数数据（通过后端API）
export async function fetchIndices() {
  try {
    const response = await fetch(`${API_BASE}/indices`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('获取指数数据失败:', error);
    return [];
  }
}

// 获取市场统计
export async function fetchMarketStats() {
  try {
    const response = await fetch(`${API_BASE}/stats`);
    const data = await response.json();
    
    const amp = data.stats?.amplitude || {};
    return {
      total: data.stats?.total || data.totalStocks || 0,
      limitUp: data.stats?.limitUp || 0,
      limitDown: data.stats?.limitDown || 0,
      up: data.stats?.up || 0,
      down: data.stats?.down || 0,
      flat: data.stats?.flat || 0,
      amplitude: amp,
      sentiment: data.stats?.sentiment || 50,
      northFlow: data.stats?.northFlow || 0,
    };
  } catch (error) {
    console.error('获取市场统计失败:', error);
    return { total: 0, limitUp: 0, limitDown: 0, up: 0, down: 0, flat: 0, amplitude: {}, sentiment: 50, northFlow: 0 };
  }
}

// 搜索股票（支持代码或名称）- 通过本地 API 代理
export async function searchStocks(query, limit = 20) {
  if (!query || query.trim().length === 0) {
    return [];
  }
  
  try {
    const encodedQuery = encodeURIComponent(query.trim());
    const response = await fetch(`${API_BASE}/search?q=${encodedQuery}`);
    const data = await response.json();
    // 后端返回裸数组 [{code, name, ...}]，兼容 {stocks: [...]} 格式
    const results = Array.isArray(data) ? data : (data.stocks || []);
    return results.slice(0, limit);
  } catch (error) {
    console.error('searchStocks: 失败', error);
    return [];
  }
}

