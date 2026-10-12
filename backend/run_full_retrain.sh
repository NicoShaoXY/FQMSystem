#!/bin/bash
# 全量重训驱动 v2：固定轮次触发，以"本轮无需训练"为真完成信号
# 守卫已临时放开；autotrain 内部串行训练每轮至多3个并自动跳过已训模型
DB=/Users/shao/Projects/FQMSystem/database/stocks.db
LOG=/tmp/full_retrain.log
BK=/Applications/QClaw.app/Contents/Resources/node/node
BKMOD=/Users/shao/Projects/FQMSystem/backend/node_modules/better-sqlite3
BELOG=/tmp/fqm_backend.log
echo "[$(date)] 全量重训驱动 v2 启动" | tee -a $LOG

# 等当前在途训练结束(无 in_progress)，用短 busy_timeout 避免锁阻塞
wait_clear(){
  for i in $(seq 1 80); do
    INPROG=$($BK -e "const D=require('$BKMOD');const db=new D('$DB',{readonly:true});db.pragma('busy_timeout=2000');try{const r=db.prepare(\"SELECT COUNT(*) c FROM ml_training_checkpoint WHERE status='in_progress'\").get();process.stdout.write(String(r.c));}catch(e){process.stdout.write('0');}db.close();" 2>/dev/null)
    if [ "$INPROG" = "0" ]; then return 0; fi
    sleep 15
  done
  return 0
}

wait_clear
echo "[$(date)] 开始循环触发(最多10轮)" | tee -a $LOG
for round in $(seq 1 10); do
  BEFORE=$(grep -c "本轮无需训练" $BELOG 2>/dev/null)
  echo "[$(date)] >> 第 $round 轮触发 ..." | tee -a $LOG
  curl -s -m 3600 -X POST http://localhost:8769/api/ml/autotrain/trigger >/dev/null 2>&1
  AFTER=$(grep -c "本轮无需训练" $BELOG 2>/dev/null)
  if [ "$AFTER" -gt "$BEFORE" ]; then
    echo "[$(date)] ✅ 后端报告'本轮无需训练' → 全部模型已重训完成" | tee -a $LOG
    break
  fi
  wait_clear
  sleep 5
done
echo "[$(date)] 全量重训驱动 v2 结束" | tee -a $LOG
# 收尾：统计 ai_ml_model 中 20 维特征模型数
$BK -e "const D=require('$BKMOD');const db=new D('$DB',{readonly:true});db.pragma('busy_timeout=3000');const ids=['lightgbm','rf','xgboost','svm','catboost','linear','bayesian'];let c=0;for(const id of ids){try{const r=db.prepare('SELECT data FROM ai_ml_model WHERE id=?').get(id);if(r){const d=JSON.parse(r.data);const fn=d.featureNames||(d.params&&d.params.featureNames);if(Array.isArray(fn)&&fn.length>=20)c++;}}catch(e){}}process.stdout.write('20维树模型数(lightgbm/rf/xgboost/svm/catboost/linear/bayesian中): '+c+'');" 2>/dev/null | tee -a $LOG
echo | tee -a $LOG
