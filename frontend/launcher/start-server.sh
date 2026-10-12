#!/bin/bash
# ══════════════════════════════════════════════════════════════
# FQMSystem 一键启动脚本
# ══════════════════════════════════════════════════════════════

PROJECT_DIR="/Users/shao/Projects/FQMSystem"
SERVER_DIR="$PROJECT_DIR/backend"
LOG_FILE="/tmp/fqm_backend_8769.log"
PID_FILE="/tmp/fqm_backend.pid"
PORT=8769

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  🚀 FQMSystem 服务管理器"
echo "══════════════════════════════════════════════════════════════"
echo ""

check_port() { lsof -i:$PORT 2>/dev/null | grep -q LISTEN; }
get_pid()    { lsof -i:$PORT 2>/dev/null | grep LISTEN | awk '{print $2}' | head -1; }

stop_server() {
    echo -e "${YELLOW}🛑 停止现有服务...${NC}"
    if check_port; then
        OLD_PID=$(get_pid)
        echo "   PID: $OLD_PID"
        kill $OLD_PID 2>/dev/null; sleep 2
        if check_port; then kill -9 $(get_pid) 2>/dev/null; sleep 1; fi
        rm -f "$PID_FILE"
        echo -e "${GREEN}   ✅ 已停止${NC}"
    else echo "   无运行中的服务"; fi
}

start_server() {
    echo -e "${BLUE}🚀 启动 FQMSystem 服务...${NC}"
    cd "$SERVER_DIR" || { echo -e "${RED}❌ 目录不存在: $SERVER_DIR${NC}"; exit 1; }
    
    # macOS Node.js HTTPS SSL 修复 + Node v24 兼容性 + 增加栈大小(ML训练需要)
    nohup env NODE_TLS_REJECT_UNAUTHORIZED=0 node --stack-size=8192 --openssl-legacy-provider data_server.js > "$LOG_FILE" 2>&1 &
    NEW_PID=$!
    echo $NEW_PID > "$PID_FILE"
    echo "   等待启动..."
    sleep 4
    if check_port; then
        echo ""
        echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}  ✅ 服务启动成功！${NC}"
        echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
        echo "   📍 http://localhost:$PORT"
        echo "   🔢 PID: $(get_pid)"
        echo "   📋 日志: $LOG_FILE"
        echo ""
    else
        echo -e "${RED}   ❌ 启动失败${NC}"; tail -10 "$LOG_FILE"
    fi
}

if check_port; then
    echo -e "${YELLOW}⚠️  检测到服务已在运行${NC} (PID: $(get_pid))"
    echo "   1. 重启 [默认]  2. 停止  3. 取消"
    read -p "   请选择 [1/2/3]: " choice
    case ${choice:-1} in
        1) stop_server; echo ""; start_server ;;
        2) stop_server ;;
    esac
else
    start_server
fi
echo ""
