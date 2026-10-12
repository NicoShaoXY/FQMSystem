#!/bin/bash
# 尧帝智能系统 - 停止服务脚本

echo "══════════════════════════════════════"
echo "   尧帝智能系统 - 停止服务..."
echo "══════════════════════════════════════"

BACKEND_PORT=8769
FRONTEND_PORT=5174
BACKEND_PID_FILE="/tmp/fqm_backend.pid"
FRONTEND_PID_FILE="/tmp/fqm_frontend.pid"
HEARTBEAT_MONITOR_PID="/tmp/fqm_heartbeat_monitor.pid"

# 停止心跳监控
if [ -f "$HEARTBEAT_MONITOR_PID" ]; then
    MONITOR_PID=$(cat "$HEARTBEAT_MONITOR_PID")
    if kill -0 $MONITOR_PID 2>/dev/null; then
        kill $MONITOR_PID
        echo "✅ 心跳监控已停止 (PID: $MONITOR_PID)"
    fi
    rm -f "$HEARTBEAT_MONITOR_PID"
fi

# 停止前端服务
if [ -f "$FRONTEND_PID_FILE" ]; then
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
    if kill -0 $FRONTEND_PID 2>/dev/null; then
        kill $FRONTEND_PID
        echo "✅ 前端服务已停止 (PID: $FRONTEND_PID)"
    fi
    rm -f "$FRONTEND_PID_FILE"
else
    # 尝试从端口获取PID
    FRONTEND_PID=$(lsof -ti :$FRONTEND_PORT 2>/dev/null)
    if [ -n "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
        echo "✅ 前端服务已停止 (PID: $FRONTEND_PID)"
    else
        echo "⚠️  前端服务未运行"
    fi
fi

# 停止后端服务
if [ -f "$BACKEND_PID_FILE" ]; then
    BACKEND_PID=$(cat "$BACKEND_PID_FILE")
    if kill -0 $BACKEND_PID 2>/dev/null; then
        kill $BACKEND_PID
        echo "✅ 后端服务已停止 (PID: $BACKEND_PID)"
    fi
    rm -f "$BACKEND_PID_FILE"
else
    # 尝试从端口获取PID
    BACKEND_PID=$(lsof -ti :$BACKEND_PORT 2>/dev/null)
    if [ -n "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
        echo "✅ 后端服务已停止 (PID: $BACKEND_PID)"
    else
        echo "⚠️  后端服务未运行"
    fi
fi

# 清理心跳文件
rm -f /tmp/fqm_heartbeat
rm -f /tmp/fqm_heartbeat_monitor.sh

echo ""
echo "══════════════════════════════════════"
echo "   所有服务已停止"
echo "══════════════════════════════════════"
