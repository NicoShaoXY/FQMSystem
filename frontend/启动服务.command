#!/bin/bash
# 尧帝智能系统 - 一键启动脚本（带生命周期管理）

cd "$(dirname "$0")"

echo "══════════════════════════════════════"
echo "   尧帝智能系统 - 启动中..."
echo "══════════════════════════════════════"

# 配置
BACKEND_PORT=8769
FRONTEND_PORT=5174
PID_FILE="/tmp/fqm_backend.pid"
FRONTEND_PID_FILE="/tmp/fqm_frontend.pid"
BACKEND_LOG="/tmp/fqm_backend_${BACKEND_PORT}.log"
FRONTEND_LOG="/tmp/fqm_frontend.log"
HEARTBEAT_FILE="/tmp/fqm_heartbeat"
SESSION_ID="fqmsystem_$(date +%s)"

# 检查端口是否被占用
check_port() {
    lsof -i :$1 | grep LISTEN > /dev/null 2>&1
}

# 获取端口对应的PID
get_port_pid() {
    lsof -ti :$1 2>/dev/null
}

# 启动后端服务
if check_port $BACKEND_PORT; then
    BACKEND_PID=$(get_port_pid $BACKEND_PORT)
    echo "⚠️  后端服务已在运行 (端口 $BACKEND_PORT, PID: $BACKEND_PID)"
else
    echo "📦 启动后端服务..."
    cd ../backend
    nohup node --stack-size=8192 --max-old-space-size=512 data_server.js > "$BACKEND_LOG" 2>&1 &
    BACKEND_PID=$!
    echo $BACKEND_PID > "$PID_FILE"
    cd ../frontend
    sleep 12
    if check_port $BACKEND_PORT; then
        echo "✅ 后端服务已启动 (端口 $BACKEND_PORT, PID: $BACKEND_PID)"
        echo "   日志: $BACKEND_LOG"
    else
        echo "❌ 后端服务启动失败，请查看 $BACKEND_LOG"
        exit 1
    fi
fi

# 启动前端服务
if check_port $FRONTEND_PORT; then
    FRONTEND_PID=$(get_port_pid $FRONTEND_PORT)
    echo "⚠️  前端服务已在运行 (端口 $FRONTEND_PORT, PID: $FRONTEND_PID)"
else
    echo "🎨 启动前端服务..."
    npm run dev -- --host > "$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > "$FRONTEND_PID_FILE"
    sleep 3
    if check_port $FRONTEND_PORT; then
        echo "✅ 前端服务已启动 (端口 $FRONTEND_PORT, PID: $FRONTEND_PID)"
        echo "   日志: $FRONTEND_LOG"
    else
        echo "❌ 前端服务启动失败，请查看 $FRONTEND_LOG"
    fi
fi

# 启动心跳监控（检测浏览器关闭）
echo "💓 启动心跳监控..."
cat > /tmp/fqm_heartbeat_monitor.sh << 'HEARTBEAT_EOF'
#!/bin/bash
HEARTBEAT_FILE="/tmp/fqm_heartbeat"
BACKEND_PID_FILE="/tmp/fqm_backend.pid"
FRONTEND_PID_FILE="/tmp/fqm_frontend.pid"
HEARTBEAT_TIMEOUT=60  # 60秒无心跳则认为浏览器关闭

# 初始化心跳时间戳
touch "$HEARTBEAT_FILE"

while true; do
    sleep 10
    if [ -f "$HEARTBEAT_FILE" ]; then
        LAST_BEAT=$(stat -f %m "$HEARTBEAT_FILE" 2>/dev/null || stat -c %Y "$HEARTBEAT_FILE" 2>/dev/null)
        NOW=$(date +%s)
        ELAPSED=$((NOW - LAST_BEAT))

        if [ $ELAPSED -gt $HEARTBEAT_TIMEOUT ]; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ 浏览器心跳超时 (${ELAPSED}秒)，停止服务..." >> /tmp/fqm_heartbeat_monitor.log

            # 停止前端
            if [ -f "$FRONTEND_PID_FILE" ]; then
                FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
                kill $FRONTEND_PID 2>/dev/null
                rm -f "$FRONTEND_PID_FILE"
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] 前端服务已停止 (PID: $FRONTEND_PID)" >> /tmp/fqm_heartbeat_monitor.log
            fi

            # 停止后端
            if [ -f "$BACKEND_PID_FILE" ]; then
                BACKEND_PID=$(cat "$BACKEND_PID_FILE")
                kill $BACKEND_PID 2>/dev/null
                rm -f "$BACKEND_PID_FILE"
                echo "[$(date '+%Y-%m-%d %H:%M:%S')] 后端服务已停止 (PID: $BACKEND_PID)" >> /tmp/fqm_heartbeat_monitor.log
            fi

            exit 0
        fi
    fi
done
HEARTBEAT_EOF

chmod +x /tmp/fqm_heartbeat_monitor.sh
nohup /tmp/fqm_heartbeat_monitor.sh > /tmp/fqm_heartbeat_monitor.log 2>&1 &
HEARTBEAT_MONITOR_PID=$!
echo $HEARTBEAT_MONITOR_PID > /tmp/fqm_heartbeat_monitor.pid
echo "   心跳监控 PID: $HEARTBEAT_MONITOR_PID"

# 创建前端心跳脚本（供前端调用）
cat > /tmp/fqm_send_heartbeat.sh << 'EOF'
#!/bin/bash
touch /tmp/fqm_heartbeat
EOF
chmod +x /tmp/fqm_send_heartbeat.sh

echo ""
echo "══════════════════════════════════════"
echo "   访问地址: http://localhost:5174"
echo "   后端地址: http://localhost:${BACKEND_PORT}"
echo "   心跳脚本: /tmp/fqm_send_heartbeat.sh"
echo "══════════════════════════════════════"
echo ""

# 自动打开浏览器
open http://localhost:5174

# 初始化心跳时间戳
touch "$HEARTBEAT_FILE"

echo "按 Ctrl+C 停止服务..."
echo ""

# 清理函数
cleanup() {
    echo ""
    echo "正在停止服务..."

    # 停止心跳监控
    if [ -f /tmp/fqm_heartbeat_monitor.pid ]; then
        kill $(cat /tmp/fqm_heartbeat_monitor.pid) 2>/dev/null
        rm -f /tmp/fqm_heartbeat_monitor.pid
    fi

    # 停止前端
    if [ -f "$FRONTEND_PID_FILE" ]; then
        kill $(cat "$FRONTEND_PID_FILE") 2>/dev/null
        rm -f "$FRONTEND_PID_FILE"
        echo "✅ 前端服务已停止"
    fi

    # 停止后端
    if [ -f "$PID_FILE" ]; then
        kill $(cat "$PID_FILE") 2>/dev/null
        rm -f "$PID_FILE"
        echo "✅ 后端服务已停止"
    fi

    # 清理心跳文件
    rm -f "$HEARTBEAT_FILE"
    rm -f /tmp/fqm_heartbeat_monitor.sh

    exit 0
}

# 捕获中断信号
trap cleanup INT TERM

# 保持脚本运行
while true; do
    sleep 5
    # 检查后端是否还活着
    if ! check_port $BACKEND_PORT; then
        echo "⚠️  后端服务已停止，停止所有服务..."
        cleanup
    fi
done
