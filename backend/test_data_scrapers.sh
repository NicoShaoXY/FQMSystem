#!/bin/bash
# 综合测试脚本：测试北向持股和融资融券数据采集

echo "========================================="
echo "综合测试脚本：数据采集验证"
echo "========================================="
echo ""

# 数据库路径
DB_PATH="/Users/shao/Projects/FQMSystem/database/stocks.db"

echo "📊 数据库位置: $DB_PATH"
echo ""

# 检查表是否存在
echo "1️⃣ 检查数据库表结构..."
echo ""
echo "--- northbound_holdings 表 ---"
sqlite3 "$DB_PATH" << 'EOF'
SELECT sql FROM sqlite_master WHERE type='table' AND name='northbound_holdings';
EOF

echo ""
echo "--- margin_data 表 ---"
sqlite3 "$DB_PATH" << 'EOF'
SELECT sql FROM sqlite_master WHERE type='table' AND name='margin_data';
EOF

echo ""
echo "2️⃣ 检查表数据量..."
echo ""
echo "--- northbound_holdings 记录数 ---"
sqlite3 "$DB_PATH" "SELECT COUNT(*) as count FROM northbound_holdings;"

echo ""
echo "--- margin_data 记录数 ---"
sqlite3 "$DB_PATH" "SELECT COUNT(*) as count FROM margin_data;"

echo ""
echo "3️⃣ 测试北向持股数据采集脚本..."
echo ""
cd /Users/shao/Projects/FQMSystem/backend
node scrape_northbound.mjs

echo ""
echo "4️⃣ 测试融资融券数据采集脚本..."
echo ""
node scrape_margin.mjs

echo ""
echo "5️⃣ 验证采集结果..."
echo ""
echo "--- northbound_holdings 最新数据 ---"
sqlite3 "$DB_PATH" << 'EOF'
SELECT code, date, hold_ratio, hold_amount, hold_market_value 
FROM northbound_holdings 
ORDER BY date DESC 
LIMIT 5;
EOF

echo ""
echo "--- margin_data 最新数据 ---"
sqlite3 "$DB_PATH" << 'EOF'
SELECT code, date, margin_buy, margin_balance, short_balance 
FROM margin_data 
ORDER BY date DESC 
LIMIT 5;
EOF

echo ""
echo "========================================="
echo "✅ 测试完成"
echo "========================================="
