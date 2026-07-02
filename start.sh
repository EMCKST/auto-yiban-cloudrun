#!/bin/bash
# 启动 sshd + node 服务
service ssh start
echo "SSH started on port 22"
exec node server.mjs
