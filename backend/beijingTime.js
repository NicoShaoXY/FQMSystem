// 北京时间工具(所有时间戳统一使用 Asia/Shanghai UTC+8)
const TZ_OFFSET = 8 * 60; // UTC+8,单位分钟

function toBeijingTime(date) {
  if (!date) return toBeijingTime(new Date());
  if (typeof date !== 'object' || !(date instanceof Date)) {
    date = new Date(date);
  }
  if (isNaN(date.getTime())) return toBeijingTime(new Date());
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + TZ_OFFSET * 60000);
}

function bjDate(date) {
  return toBeijingTime(date || new Date()).toISOString().split('T')[0];
}

function bjISO(date) {
  const d = toBeijingTime(date || new Date());
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.000+08:00';
}

function bjNow() {
  const d = toBeijingTime(new Date());
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

const bjNowStr = bjNow;

export { toBeijingTime, bjDate, bjISO, bjNow, bjNowStr };
