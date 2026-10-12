#!/bin/bash
# fqm-backend-start.sh - 正确传递 Node.js 参数
export NODE_OPTIONS="--max-old-space-size=3072"
cd "$(dirname "$0")/backend"
exec /Applications/QClaw.app/Contents/Resources/node/node \
  --stack-size=98304 \
  --max-old-space-size=3072 \
   data_server.js "$@"
