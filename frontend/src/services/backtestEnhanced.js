/**
 * 策略回测报告增强
 * 
 * 功能：
 * 1. 更多性能指标（卡尔玛比率、索提诺比率等）
 * 2. 风险调整收益
 * 3. 最大回撤分析
 * 4. 交易成本计算
 * 5. 蒙特卡洛模拟
 * 6. 因子归因分析
 */

// ========== 增强回测引擎 ==========

export class EnhancedBacktestEngine {
  constructor(config = {}) {
    this.config = {
      initialCapital: config.initialCapital || 1000000,
      commission: config.commission || 0.0003,   // 万3手续费
      slippage: config.slippage || 0.001,         // 0.1%滑点
      riskFreeRate: config.riskFreeRate || 0.03,  // 3%无风险利率
      stopLossPct: config.stopLossPct || 0,       // 止损比例(0=不启用)
      takeProfitPct: config.takeProfitPct || 0,   // 止盈比例(0=不启用)
      ...config,
    };

    this.trades = [];
    this.equity = [this.config.initialCapital];
    this.positions = {};
  }

  /**
   * 执行回测
   */
  runBacktest(strategy, priceData) {
    let capital = this.config.initialCapital;
    const equityCurve = [capital];
    const trades = [];

    priceData.forEach((bar, i) => {
      const signal = strategy.generateSignal(bar, priceData.slice(0, i + 1));

      // 【P5优化】止损止盈检查（持仓时先检查）
      if (this.positions[bar.code]) {
        const pos = this.positions[bar.code];
        const pnlPct = (bar.close - pos.entryPrice) / pos.entryPrice;
        // 止损触发
        if (this.config.stopLossPct > 0 && pnlPct <= -this.config.stopLossPct) {
          const proceeds = pos.shares * bar.close * (1 - this.config.commission - this.config.slippage);
          capital += proceeds;
          trades.push({ type: 'sell', code: bar.code, price: bar.close, shares: pos.shares, time: bar.time, pnl: proceeds - pos.shares * pos.entryPrice, reason: 'stopLoss' });
          delete this.positions[bar.code];
        }
        // 止盈触发
        else if (this.config.takeProfitPct > 0 && pnlPct >= this.config.takeProfitPct) {
          const proceeds = pos.shares * bar.close * (1 - this.config.commission - this.config.slippage);
          capital += proceeds;
          trades.push({ type: 'sell', code: bar.code, price: bar.close, shares: pos.shares, time: bar.time, pnl: proceeds - pos.shares * pos.entryPrice, reason: 'takeProfit' });
          delete this.positions[bar.code];
        }
      }

      if (signal === 'buy' && !this.positions[bar.code]) {
        const shares = Math.floor(capital * 0.1 / bar.close);
        const cost = shares * bar.close * (1 + this.config.commission + this.config.slippage);

        if (cost <= capital) {
          capital -= cost;
          this.positions[bar.code] = { shares, entryPrice: bar.close, entryTime: bar.time };
          trades.push({ type: 'buy', code: bar.code, price: bar.close, shares, time: bar.time });
        }
      } else if (signal === 'sell' && this.positions[bar.code]) {
        const pos = this.positions[bar.code];
        const proceeds = pos.shares * bar.close * (1 - this.config.commission - this.config.slippage);
        capital += proceeds;

        trades.push({
          type: 'sell',
          code: bar.code,
          price: bar.close,
          shares: pos.shares,
          time: bar.time,
          pnl: proceeds - pos.shares * pos.entryPrice,
          holdingDays: (bar.time - pos.entryTime) / (24 * 60 * 60 * 1000),
        });

        delete this.positions[bar.code];
      }

      // 计算当前权益
      const positionsValue = Object.values(this.positions).reduce((sum, pos) => {
        return sum + pos.shares * (bar.close || pos.entryPrice);
      }, 0);

      equityCurve.push(capital + positionsValue);
    });

    this.trades = trades;
    this.equity = equityCurve;

    return this.generateReport(trades, equityCurve);
  }

  /**
   * 生成完整报告
   */
  generateReport(trades, equityCurve) {
    const returns = this.calculateReturns(equityCurve);
    const drawdown = this.calculateDrawdown(equityCurve);
    const tradeStats = this.calculateTradeStats(trades);
    const riskMetrics = this.calculateRiskMetrics(returns, drawdown);

    return {
      summary: {
        initialCapital: this.config.initialCapital,
        finalCapital: equityCurve[equityCurve.length - 1],
        totalReturn: (equityCurve[equityCurve.length - 1] / this.config.initialCapital - 1) * 100,
        annualizedReturn: riskMetrics.annualizedReturn,
        totalTrades: trades.length,
        winRate: tradeStats.winRate,
      },
      riskMetrics,
      drawdown,
      tradeStats,
      equityCurve,
      trades,
    };
  }

  /**
   * 计算收益序列
   */
  calculateReturns(equityCurve) {
    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
    return returns;
  }

  /**
   * 计算回撤
   */
  calculateDrawdown(equityCurve) {
    let peak = equityCurve[0];
    let maxDrawdown = 0;
    let maxDrawdownStart = 0;
    let maxDrawdownEnd = 0;
    const drawdowns = [];

    equityCurve.forEach((value, i) => {
      if (value > peak) {
        peak = value;
        maxDrawdownStart = i;
      }

      const drawdown = (peak - value) / peak;
      drawdowns.push(drawdown);

      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownEnd = i;
      }
    });

    return {
      maxDrawdown: maxDrawdown * 100,
      maxDrawdownStart,
      maxDrawdownEnd,
      maxDrawdownDuration: maxDrawdownEnd - maxDrawdownStart,
      drawdowns,
      currentDrawdown: drawdowns[drawdowns.length - 1] * 100,
    };
  }

  /**
   * 计算交易统计
   */
  calculateTradeStats(trades) {
    const sellTrades = trades.filter(t => t.type === 'sell');
    if (sellTrades.length === 0) return { winRate: 0, avgPnl: 0, profitFactor: 0 };

    const wins = sellTrades.filter(t => t.pnl > 0);
    const losses = sellTrades.filter(t => t.pnl <= 0);

    const totalProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

    return {
      totalTrades: sellTrades.length,
      winTrades: wins.length,
      lossTrades: losses.length,
      winRate: (wins.length / sellTrades.length * 100).toFixed(1),
      avgPnl: sellTrades.reduce((sum, t) => sum + t.pnl, 0) / sellTrades.length,
      avgWin: wins.length > 0 ? totalProfit / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
      profitFactor: totalLoss > 0 ? (totalProfit / totalLoss).toFixed(2) : '∞',
      avgHoldingDays: sellTrades.reduce((sum, t) => sum + (t.holdingDays || 0), 0) / sellTrades.length,
    };
  }

  /**
   * 计算风险指标
   */
  calculateRiskMetrics(returns, drawdown) {
    const n = returns.length;
    if (n === 0) return {};

    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    const annualizedReturn = Math.pow(1 + mean, 252) - 1;
    const annualizedVol = stdDev * Math.sqrt(252);

    // 夏普比率
    const sharpeRatio = annualizedVol > 0
      ? (annualizedReturn - this.config.riskFreeRate) / annualizedVol
      : 0;

    // 索提诺比率（只考虑下行波动）
    const downReturns = returns.filter(r => r < 0);
    const downVariance = downReturns.reduce((sum, r) => sum + r * r, 0) / n;
    const downStdDev = Math.sqrt(downVariance) * Math.sqrt(252);
    const sortinoRatio = downStdDev > 0
      ? (annualizedReturn - this.config.riskFreeRate) / downStdDev
      : 0;

    // 卡尔玛比率
    const calmarRatio = drawdown.maxDrawdown > 0
      ? annualizedReturn / (drawdown.maxDrawdown / 100)
      : 0;

    // 信息比率（相对基准）
    const benchmarkReturn = 0.08; // 假设基准年化8%
    const trackingError = annualizedVol;
    const informationRatio = trackingError > 0
      ? (annualizedReturn - benchmarkReturn) / trackingError
      : 0;

    return {
      annualizedReturn: (annualizedReturn * 100).toFixed(2),
      annualizedVolatility: (annualizedVol * 100).toFixed(2),
      sharpeRatio: sharpeRatio.toFixed(2),
      sortinoRatio: sortinoRatio.toFixed(2),
      calmarRatio: calmarRatio.toFixed(2),
      informationRatio: informationRatio.toFixed(2),
      maxDrawdown: drawdown.maxDrawdown.toFixed(2),
      var95: this.calculateVaR(returns, 0.95),
      cvar95: this.calculateCVaR(returns, 0.95),
    };
  }

  /**
   * 计算VaR（风险价值）
   */
  calculateVaR(returns, confidence) {
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    return (sorted[index] * 100).toFixed(2);
  }

  /**
   * 计算CVaR（条件风险价值）
   */
  calculateCVaR(returns, confidence) {
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    const tailReturns = sorted.slice(0, index);
    const cvar = tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length;
    return (cvar * 100).toFixed(2);
  }
}

// ========== 蒙特卡洛模拟 ==========

export class MonteCarloSimulation {
  constructor(config = {}) {
    this.config = {
      simulations: config.simulations || 1000,
      days: config.days || 252,
      ...config,
    };
  }

  /**
   * 运行蒙特卡洛模拟
   */
  runSimulation(returns) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length
    );

    const paths = [];

    for (let sim = 0; sim < this.config.simulations; sim++) {
      const path = [1];
      let value = 1;

      for (let day = 0; day < this.config.days; day++) {
        const randomReturn = mean + stdDev * this.normalRandom();
        value *= (1 + randomReturn);
        path.push(value);
      }

      paths.push(path);
    }

    return this.analyzeSimulations(paths);
  }

  /**
   * 分析模拟结果
   */
  analyzeSimulations(paths) {
    const finalValues = paths.map(p => p[p.length - 1]);
    finalValues.sort((a, b) => a - b);

    const mean = finalValues.reduce((a, b) => a + b) / finalValues.length;
    const median = finalValues[Math.floor(finalValues.length / 2)];
    const p5 = finalValues[Math.floor(finalValues.length * 0.05)];
    const p95 = finalValues[Math.floor(finalValues.length * 0.95)];

    return {
      simulations: paths.length,
      mean: ((mean - 1) * 100).toFixed(2),
      median: ((median - 1) * 100).toFixed(2),
      p5: ((p5 - 1) * 100).toFixed(2),
      p95: ((p95 - 1) * 100).toFixed(2),
      probabilityOfProfit: (finalValues.filter(v => v > 1).length / finalValues.length * 100).toFixed(1),
      paths: paths.slice(0, 100), // 只返回100条路径用于可视化
    };
  }

  /**
   * 生成标准正态随机数（Box-Muller变换）
   */
  normalRandom() {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// ========== 因子归因分析 ==========

export class FactorAttributionAnalysis {
  constructor(config = {}) {
    this.config = config;
    this.factors = {
      market: 0,
      size: 0,
      value: 0,
      momentum: 0,
      quality: 0,
    };
  }

  /**
   * 分析因子贡献
   */
  analyzeFactorContribution(returns, factorReturns) {
    const contributions = {};
    let totalExplained = 0;

    Object.keys(this.factors).forEach(factor => {
      if (factorReturns[factor]) {
        const correlation = this.calculateCorrelation(returns, factorReturns[factor]);
        const contribution = correlation * Math.abs(correlation);
        contributions[factor] = (contribution * 100).toFixed(2);
        totalExplained += Math.abs(contribution);
      }
    });

    contributions.alpha = ((1 - totalExplained) * 100).toFixed(2);

    return {
      contributions,
      r_squared: (totalExplained * 100).toFixed(2),
      alpha: contributions.alpha,
    };
  }

  /**
   * 计算相关系数
   */
  calculateCorrelation(x, y) {
    const n = Math.min(x.length, y.length);
    const xMean = x.slice(0, n).reduce((a, b) => a + b) / n;
    const yMean = y.slice(0, n).reduce((a, b) => a + b) / n;

    let numerator = 0, xVar = 0, yVar = 0;

    for (let i = 0; i < n; i++) {
      numerator += (x[i] - xMean) * (y[i] - yMean);
      xVar += Math.pow(x[i] - xMean, 2);
      yVar += Math.pow(y[i] - yMean, 2);
    }

    return numerator / Math.sqrt(xVar * yVar) || 0;
  }
}

// ========== 工厂函数 ==========

export function createBacktestEngine(config) {
  return new EnhancedBacktestEngine(config);
}

export function createMonteCarloSimulation(config) {
  return new MonteCarloSimulation(config);
}

export function createFactorAttribution(config) {
  return new FactorAttributionAnalysis(config);
}
