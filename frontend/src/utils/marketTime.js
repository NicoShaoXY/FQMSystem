// 市场时间判断工具
// 判断当前是否为交易时段，并返回推荐的轮询间隔
// 【时区修复】全部使用北京时间，兼容非东八区浏览器

import { toBeijingTime, bjDate } from './beijingTime';

/**
 * 判断当前是否为交易时段
 * @returns {boolean} - 是否在交易时段
 */
export function isMarketOpen() {
  const now = toBeijingTime(new Date());
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  
  // 周末不交易
  if (day === 0 || day === 6) return false;
  
  // 上午: 9:30-11:30
  if (hour === 9 && minute >= 30) return true;
  if (hour === 10) return true;
  if (hour === 11 && minute <= 30) return true;
  
  // 下午: 13:00-15:00
  if (hour === 13) return true;
  if (hour === 14) return true;
  if (hour === 15 && minute === 0) return true; // 15:00收盘
  
  return false;
}

/**
 * 判断当前是否为交易日（工作日）
 * @returns {boolean} - 是否为交易日
 */
export function isTradingDay() {
  const day = toBeijingTime(new Date()).getDay();
  return day >= 1 && day <= 5;
}

/**
 * 获取当前市场状态描述
 * @returns {string} - 市场状态描述
 */
export function getMarketStatus() {
  const now = toBeijingTime(new Date());
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  
  // 周末
  if (day === 0 || day === 6) {
    return '休市（周末）';
  }
  
  // 盘前
  if (hour < 9 || (hour === 9 && minute < 30)) {
    return '盘前';
  }
  
  // 上午交易时段
  if (hour === 9 && minute >= 30) return '交易中';
  if (hour === 10) return '交易中';
  if (hour === 11 && minute <= 30) return '交易中';
  
  // 午休
  if (hour === 11 && minute > 30) return '午休';
  if (hour === 12) return '午休';
  if (hour === 13 && minute === 0) return '午休';
  
  // 下午交易时段
  if (hour === 13 && minute > 0) return '交易中';
  if (hour === 14) return '交易中';
  if (hour === 15 && minute === 0) return '收盘';
  
  // 盘后
  if (hour >= 15) return '盘后';
  
  return '未知';
}

/**
 * 获取推荐的轮询间隔（毫秒）
 * @returns {number} - 轮询间隔（毫秒）
 */
export function getPollingInterval() {
  // 交易时段：10秒
  if (isMarketOpen()) {
    return 10000;
  }
  
  const now = toBeijingTime(new Date());
  const hour = now.getHours();
  const day = now.getDay();
  
  // 周末：120秒
  if (day === 0 || day === 6) {
    return 120000;
  }
  
  // 交易日非交易时段（盘前、午休、盘后）：30-60秒
  // 盘前（7:00-9:30）
  if (hour >= 7 && hour < 9) {
    return 30000;
  }
  if (hour === 9 && now.getMinutes() < 30) {
    return 30000;
  }
  
  // 午休（11:30-13:00）
  if (hour === 11 && now.getMinutes() > 30) {
    return 30000;
  }
  if (hour === 12) {
    return 30000;
  }
  if (hour === 13 && now.getMinutes() === 0) {
    return 30000;
  }
  
  // 盘后（15:00-23:00）
  if (hour >= 15 && hour < 23) {
    return 60000;
  }
  
  // 夜间：120秒
  return 120000;
}

/**
 * 获取距离下次开盘的时间（毫秒）
 * @returns {number} - 距离下次开盘的毫秒数，0表示当前在交易时段
 */
export function getTimeToOpen() {
  if (isMarketOpen()) return 0;
  
  const now = toBeijingTime(new Date());
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  
  let nextOpen = new Date(now);
  
  // 周末：计算到下周一
  if (day === 0) {
    nextOpen.setDate(nextOpen.getDate() + 1);
  } else if (day === 6) {
    nextOpen.setDate(nextOpen.getDate() + 2);
  }
  
  // 设置开盘时间 9:30
  nextOpen.setHours(9, 30, 0, 0);
  
  // 如果已经是交易日且过了开盘时间，但还没到下午开盘
  if (day >= 1 && day <= 5) {
    // 午休时间：计算到下午13:00
    if (hour === 11 && minute > 30 || hour === 12 || (hour === 13 && minute === 0)) {
      nextOpen.setHours(13, 0, 0, 0);
    }
    // 下午收盘后：计算到明天9:30
    else if (hour >= 15) {
      nextOpen.setDate(nextOpen.getDate() + 1);
      nextOpen.setHours(9, 30, 0, 0);
      // 如果明天是周六，跳到周一
      if (nextOpen.getDay() === 6) {
        nextOpen.setDate(nextOpen.getDate() + 2);
      }
    }
  }
  
  return Math.max(0, nextOpen.getTime() - now.getTime());
}

export default {
  isMarketOpen,
  isTradingDay,
  getMarketStatus,
  getPollingInterval,
  getTimeToOpen
};
