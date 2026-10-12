#!/bin/bash
# 监控数据库表行数增长，防止膨胀
# 超过阈值时记录日志并告警

DB_PATH="/Users/shao/Projects/FQMSystem/database/stocks.db"
LOG_FILE="/Users/shao/Projects/FQMSystem/logs/table_monitor.log"
THRESHOLD=100000

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_table() {
  local table=$1
  local count=$(/usr/local/bin/node -e "
    const db = require('better-sqlite3')('$DB_PATH');
    const row = db.prepare('SELECT COUNT(*) as c FROM $table').get();
    console.log(row.c);
    db.close();
  " 2>/dev/null)
  
  if [ -z "$count" ]; then
    log "❌ 无法查询表 $table"
    return 1
  fi
  
  log "📊 $table: $count 行"
  
  if [ "$count" -gt "$THRESHOLD" ]; then
    log "⚠️  告警！$table 行数 ($count) 超过阈值 ($THRESHOLD)"
    # 这里可以添加告警逻辑（邮件/微信/Telegram）
    return 2
  fi
  
  return 0
}

log "========== 表行数监控开始 =========="
check_table "stock_realtime"
check_table "stocks"
log "========== 监控完成 =========="
