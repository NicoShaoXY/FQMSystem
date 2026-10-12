#!/bin/bash
# FQMSystem 停止脚本

PORT=8769
PID_FILE="/tmp/fqm_backend.pid"

echo "🛑 停止 FQMSystem 服务..."

# 尝试通过PID文件停止
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 $OLD_PID 2>/dev/null; then
        echo "  停止进程 $OLD_PID..."
        kill $OLD_PID 2>/dev/null
        sleep 2
        kill -9 $OLD_PID 2>/dev/null
    fi
    rm -f "$PID_FILE"
fi

# 通用停止命令
pkill -f "node.*data_server.js" 2>/dev/null
sleep 1

# 检查端口是否仍占用
if lsof -i:${PORT} 2>/dev/null | grep -q LISTEN; then
    echo "⚠️  端口 ${PORT} 仍被占用，强制终止..."
    PID=$(lsof -i:${PORT} 2>/dev/null | grep LISTEN | awk '{print $2}' | head -1)
    if [ -n "$PID" ]; then
        kill -9 $PID 2>/dev/null
        sleep 1
    fi
fi

# 最终检查
if lsof -i:${PORT} 2>/dev/null | grep -q LISTEN; then
    echo "❌ 停止失败，端口 ${PORT} 仍被占用"
    lsof -i:${PORT} | grep LISTEN
else
    echo "✅ 服务已停止"
fi

echo ""
echo "提示：若端口仍被占用，可能是进程卡死(UNE状态)，需重启系统释放。"
