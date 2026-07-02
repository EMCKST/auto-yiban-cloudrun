#!/bin/bash
# 启动 ttyd（web终端，内部端口 7681）+ node 服务
ttyd -p 7681 bash &
echo "ttyd terminal on port 7681"
exec node server.mjs
