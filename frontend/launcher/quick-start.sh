#!/bin/bash
# FQMSystem 快速重启脚本（无交互）

PORT=8769
LOG="/tmp/fqm_backend_8769.log"
PID_FILE="/tmp/fqm_backend.pid"
SERVER_DIR="/Users/shao/Projects/FQMSystem/backend"

# 停止现有服务
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 $OLD_PID 2>/dev/null; then
        echo "🛑 停止现有服务 (PID: $OLD_PID)..."
        kill $OLD_PID 2>/dev/null
        sleep 2
        kill -9 $OLD_PID 2>/dev/null
    fi
    rm -f "$PID_FILE"
fi

# 二次确认端口已释放
if lsof -i:$PORT 2>/dev/null | grep -q LISTEN; then
    OLD_PID=$(lsof -i:$PORT 2>/dev/null | grep LISTEN | awk '{print $2}' | head -1)
    kill -9 $OLD_PID 2>/dev/null
    sleep 1
fi

# 启动服务
echo "🚀 启动 FQMSystem 服务..."
cd "$SERVER_DIR" || { echo "❌ 目录不存在: $SERVER_DIR"; exit 1; }
nohup env NODE_TLS_REJECT_UNAUTHORIZED=0 node --stack-size=8192 data_server.js > "$LOG" 2>&1 &
NEW_PID=$!
echo $NEW_PID > "$PID_FILE"
sleep 3

# 检查结果
if lsof -i:$PORT 2>/dev/null | grep -q LISTEN; then
    echo "✅ 服务已启动 | PID: $NEW_PID | http://localhost:$PORT"
    echo "   日志: $LOG"
else
    echo "❌ 启动失败，查看日志: tail -20 $LOG"
fi
