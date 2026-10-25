#!/usr/bin/env bash
# K线看板 服务管理脚本：./kline.sh {start|stop|restart|status}
# 环境变量：PORT（默认 8787）、YJNT_TOKEN（可选，解锁实时行情）
set -u
cd "$(dirname "$0")"

PORT="${PORT:-8787}"
PID_FILE=".server.pid"
LOG_FILE="server.log"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

do_start() {
  if is_running; then
    echo "已在运行 (PID $(cat "$PID_FILE"))，访问 http://localhost:$PORT"
    return 0
  fi
  echo "启动中…"
  if [ -n "${YJNT_TOKEN:-}" ]; then
    nohup env PORT="$PORT" YJNT_TOKEN="$YJNT_TOKEN" node server.js >> "$LOG_FILE" 2>&1 &
  else
    nohup env PORT="$PORT" node server.js >> "$LOG_FILE" 2>&1 &
  fi
  echo $! > "$PID_FILE"
  sleep 1
  if is_running; then
    echo "✓ 已启动 (PID $(cat "$PID_FILE")) → http://localhost:${PORT}（日志：${LOG_FILE}）"
  else
    echo "✗ 启动失败，最近日志："
    tail -5 "$LOG_FILE"
    rm -f "$PID_FILE"
    return 1
  fi
}

do_stop() {
  if is_running; then
    local pid; pid=$(cat "$PID_FILE")
    echo "停止中 (PID $pid)…"
    kill "$pid" 2>/dev/null
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done
    rm -f "$PID_FILE"
    echo "✓ 已停止"
  else
    # 兜底：按端口清理残留进程
    local pids; pids=$(lsof -ti ":$PORT" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo $pids | xargs kill 2>/dev/null
      echo "✓ 已停止端口 ${PORT} 上的残留进程"
    else
      echo "未在运行"
    fi
  fi
}

do_status() {
  if is_running; then
    local pid; pid=$(cat "$PID_FILE")
    echo "● 运行中 (PID $pid) → http://localhost:$PORT"
    curl -s -m 3 "http://localhost:$PORT/api/health" 2>/dev/null | head -c 120; echo
  else
    echo "○ 未运行"
  fi
}

case "${1:-}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  status)  do_status ;;
  *) echo "用法: ./kline.sh {start|stop|restart|status}"; echo "  PORT=9000 YJNT_TOKEN=xxx ./kline.sh start"; exit 1 ;;
esac
