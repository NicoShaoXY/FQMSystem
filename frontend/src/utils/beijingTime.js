// 北京时间工具（前端统一使用，避免依赖浏览器本地时区）
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8 毫秒偏移

/**
 * 将任意Date转为北京时间Date对象
 * 返回的Date的getHours()/getMinutes()等均按北京时间
 */
export function toBeijingTime(date) {
  if (!date) return toBeijingTime(new Date());
  if (!(date instanceof Date)) date = new Date(date);
  if (isNaN(date.getTime())) return toBeijingTime(new Date());
  // UTC时间 + 8小时偏移
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + TZ_OFFSET_MS);
}

/**
 * 获取北京时间日期字符串 YYYY-MM-DD
 */
export function bjDate(date) {
  const d = toBeijingTime(date || new Date());
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 获取北京时间ISO字符串（带+08:00时区标识）
 */
export function bjISO(date) {
  const d = toBeijingTime(date || new Date());
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000+08:00`;
}

/**
 * 获取北京时间 Date 对象（用于时间比较和计算）
 */
export function bjNow() {
  return toBeijingTime(new Date());
}

/**
 * 获取北京时间字符串 YYYY-MM-DD HH:MM:SS
 */
export function bjNowStr() {
  const d = toBeijingTime(new Date());
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 获取北京时间过去n天日期字符串 YYYY-MM-DD HH:MM:SS
 * 用于SQL WHERE timestamp > bjPast(7) 查询最近7天数据
 */
export function bjPast(days) {
  const d = toBeijingTime(new Date(Date.now() - days * 86400000));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 获取北京时间未来n小时日期字符串
 */
export function bjFuture(hours) {
  const d = toBeijingTime(new Date(Date.now() + hours * 3600000));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 格式化UTC时间字符串为北京时间显示
 * 输入: '2026-05-06 06:39:08' 或 '2026-05-06T06:39:08Z'
 * 输出: '05-06 14:39:08' (北京时间)
 */
export function formatBJTime(isoString, includeDate = true) {
  if (!isoString) return '—';
  // 确保解析为UTC时间
  const d = new Date(isoString.includes('T') ? isoString : isoString.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return isoString; // 解析失败返回原值
  
  const bj = toBeijingTime(d);
  const pad = n => String(n).padStart(2, '0');
  
  if (includeDate) {
    return `${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
  } else {
    return `${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
  }
}

/**
 * 格式化UTC时间字符串为完整北京时间显示
 * 输出: '2026-05-06 14:39:08'
 */
export function formatBJTimeFull(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString.includes('T') ? isoString : isoString.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return isoString;
  
  const bj = toBeijingTime(d);
  const pad = n => String(n).padStart(2, '0');
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
}

export default { toBeijingTime, bjDate, bjISO, bjNow, bjNowStr, bjPast, bjFuture, formatBJTime, formatBJTimeFull };
