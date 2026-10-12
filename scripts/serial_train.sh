#!/bin/bash
# 串行训练脚本：等一个模型完成后再启动下一个

BASE_URL="http://localhost:8769"
TRAINING_QUEUE=("svm" "linear" "catboost" "lstm" "gru" "cnn" "transformer" "rl")

echo "串行训练脚本启动"
echo "训练队列: ${TRAINING_QUEUE[@]}"
echo ""

train_model() {
    local model_id=$1
    echo "========================================"
    echo "启动训练: $model_id"
    echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"

    # 启动训练
    response=$(curl -s -X POST "$BASE_URL/api/ml/manual/start/$model_id")
    success=$(echo "$response" | jq -r '.success')

    if [ "$success" != "true" ]; then
        echo "❌ 启动失败: $(echo "$response" | jq -r '.error')"
        return 1
    fi

    echo "✅ 训练已启动"

    # 等待训练完成
    while true; do
        sleep 5
        status=$(curl -s "$BASE_URL/api/ml/manual/status" | jq -r ".models[\"$model_id\"].trainStatus")
        progress=$(curl -s "$BASE_URL/api/ml/manual/status" | jq -r ".models[\"$model_id\"].progress // 0")
        accuracy=$(curl -s "$BASE_URL/api/ml/manual/status" | jq -r ".models[\"$model_id\"].accuracy // 0")

        echo "状态: $status | 进度: ${progress}% | 准确率: $(echo "$accuracy * 100" | bc -l | cut -c1-6)%"

        if [ "$status" = "completed" ] || [ "$status" = "failed" ]; then
            echo "训练结束: $status"
            break
        fi
    done

    # 获取最终准确率
    final_acc=$(curl -s "$BASE_URL/api/ml/manual/status" | jq -r ".models[\"$model_id\"].accuracy // 0")
    prev_acc=$(curl -s "$BASE_URL/api/ml/manual/status" | jq -r ".models[\"$model_id\"].previous_accuracy // 0")

    echo "最终准确率: $(echo "$final_acc * 100" | bc -l | cut -c1-6)%"

    if [ "$prev_acc" != "null" ] && [ "$prev_acc" != "0" ]; then
        diff=$(echo "$final_acc - $prev_acc" | bc -l)
        if (( $(echo "$diff > 0" | bc -l) )); then
            echo "📈 准确率提升: +$(echo "$diff * 100" | bc -l | cut -c1-6)%"
        elif (( $(echo "$diff < 0" | bc -l) )); then
            echo "📉 准确率下降: $(echo "$diff * 100" | bc -l | cut -c1-6)%"
        else
            echo "➖ 准确率无变化"
        fi
    fi

    echo "冷却5秒..."
    sleep 5
}

# 检查当前是否有模型在训练
current_training=$(curl -s "$BASE_URL/api/ml/manual/status" | jq -r '.models | to_entries[] | select(.value.trainStatus == "training") | .key' | head -1)

if [ -n "$current_training" ]; then
    echo "检测到当前正在训练: $current_training"
    echo "等待其完成..."
    while true; do
        sleep 5
        status=$(curl -s "$BASE_URL/api/ml/manual/status" | jq -r ".models[\"$current_training\"].trainStatus")
        if [ "$status" != "training" ]; then
            echo "✅ $current_training 已完成"
            break
        fi
    done
fi

# 开始串行训练
for model_id in "${TRAINING_QUEUE[@]}"; do
    train_model "$model_id"
    echo ""
done

echo "========================================"
echo "✅ 所有模型训练完成"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
