/**
 * Yahoo Finance API 数据源
 * 备用/辅助数据源，当国内API无法访问时使用
 */

const YAHOO_FINANCE_BASE = 'https://query1.finance.yahoo.com/v8/finance';

/**
 * 获取股票实时价格
 * @param {string[]} codes - 股票代码数组，如 ['000001.SS', '399001.SZ']
 * @returns {Promise<Object>} 价格数据
 */
async function getYahooPrices(codes) {
  // 转换股票代码格式
  // A股: 000001 -> 000001.SS (上海), 399001.SZ (深圳)
  // 港股: 0700.HK
  // 美股: AAPL
  
  const results = [];
  
  for (const code of codes) {
    let yahooCode = code;
    
    // 转换A股代码
    if (/^\d{6}$/.test(code)) {
      // 纯数字A股代码，尝试判断市场
      const num = parseInt(code);
      if (num >= 600000) {
        yahooCode = code + '.SS'; // 上海
      } else if (num >= 500000 && num < 600000) {
        yahooCode = code + '.SZ'; // 深圳
      } else {
        yahooCode = code + '.SZ';
      }
    } else if (code.startsWith('sh')) {
      yahooCode = code.slice(2) + '.SS';
    } else if (code.startsWith('sz')) {
      yahooCode = code.slice(2) + '.SZ';
    } else if (code.startsWith('hk') || /^\d{4}\.HK$/i.test(code)) {
      yahooCode = code.replace(/^hk/i, '').toUpperCase() + '.HK';
    }
    
    try {
      const url = `${YAHOO_FINANCE_BASE}/quotes?symbols=${yahooCode}`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      
      if (resp.ok) {
        const data = await resp.json();
        if (data.quoteResponse && data.quoteResponse.result) {
          for (const quote of data.quoteResponse.result) {
            results.push({
              code: code,
              name: quote.shortName || quote.longName || code,
              price: quote.regularMarketPrice || 0,
              change: quote.regularMarketChange || 0,
              changePercent: quote.regularMarketChangePercent || 0,
              volume: quote.regularMarketVolume || 0,
              timestamp: quote.regularMarketTime * 1000
            });
          }
        }
      }
    } catch (e) {
      console.error(`Yahoo Finance error for ${code}:`, e.message);
    }
  }
  
  return results;
}

/**
 * 获取指数数据
 * @param {string[]} indices - 指数代码，如 ['^SSEC', '^HSI', '^DJI']
 */
async function getYahooIndices(indices) {
  const symbols = indices.join(',');
  const url = `${YAHOO_FINANCE_BASE}/quotes?symbols=${symbols}`;
  
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (resp.ok) {
      const data = await resp.json();
      const results = [];
      
      if (data.quoteResponse && data.quoteResponse.result) {
        for (const quote of data.quoteResponse.result) {
          results.push({
            code: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            price: quote.regularMarketPrice || 0,
            change: quote.regularMarketChange || 0,
            changePercent: quote.regularMarketChangePercent || 0,
            timestamp: quote.regularMarketTime * 1000
          });
        }
      }
      
      return results;
    }
  } catch (e) {
    console.error('Yahoo Finance indices error:', e.message);
  }
  
  return [];
}

/**
 * 获取期货/大宗商品数据
 * @param {string[]} futures - 期货代码，如 ['GC=F', 'CL=F', 'SI=F']
 */
async function getYahooFutures(futures) {
  return getYahooIndices(futures.map(f => f + '=F'));
}

/**
 * 获取外汇数据
 * @param {string[]} pairs - 货币对，如 ['USDCNY=X', 'EURUSD=X', 'GBPUSD=X']
 */
async function getYahooForex(pairs) {
  return getYahooIndices(pairs);
}

module.exports = {
  getYahooPrices,
  getYahooIndices,
  getYahooFutures,
  getYahooForex
};