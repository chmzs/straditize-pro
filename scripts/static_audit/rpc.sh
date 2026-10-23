#!/bin/bash
# 用 curl 直打审计后端
curl -s -X POST http://127.0.0.1:23050/rpc \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}"
