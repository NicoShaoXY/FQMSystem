/**
 * 日期工具函数
 * 提供北京时间相关的日期格式化功能
 */

/**
 * 获取北京时间的日期字符串 (YYYY-MM-DD)
 * @param {Date|string} date - 日期对象或字符串
 * @returns {string} 格式：YYYY-MM-DD
 */
export function bjDate(date) {
  return toBeijingTime(date || new Date()).toISOString().split('T')[0];
}

/**
 * 获取北京时间的ISO格式字符串
 * @param {Date|string} date - 日期对象或字符串
 * @returns {string} ISO格式字符串
 */
export function bjISO(date) {
  return toBeijingTime(date || new Date()).toISOString();
}

/**
 * 转换为北京时间
 * @param {Date|string} date - 日期对象或字符串
 * @returns {Date} 北京时间Date对象
 */
function toBeijingTime(date) {
  const d = new Date(date);
  // 北京时间 = UTC+8
  return new Date(d.getTime() + 8 * 60 * 60 * 1000);
}
