#!/usr/bin/env bash
# EC2(Ubuntu 24.04)에서 한 번 실행: Python 환경, API 서비스, HTTPS(Caddy), 정기 수집(cron)
#   사용: bash deploy/setup.sh 3.38.12.34.sslip.io      (인자 = 접속 주소)
# 전제: /home/ubuntu/MOVA 에 레포가 있고, prep/out 과 데이터/ 키 파일을 올려 둠 (deploy/README.md 참고)
set -euo pipefail
HOST="${1:?접속 주소를 인자로 주세요 (예: 3.38.12.34.sslip.io)}"
APP=/home/ubuntu/MOVA
cd "$APP"

echo "== 1. 패키지"
sudo apt-get update -y
sudo apt-get install -y python3-venv python3-pip debian-keyring debian-archive-keyring apt-transport-https curl
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -y && sudo apt-get install -y caddy
fi
sudo timedatectl set-timezone Asia/Seoul

echo "== 2. Python 가상환경"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

echo "== 3. 필요한 파일 확인"
for f in prep/out/stop_times.csv prep/out/bus_routes.csv prep/out/bus_segments.csv prep/out/transfers.csv \
         데이터/naver_key.txt 데이터/seoul_key2.txt; do
  [ -f "$f" ] || { echo "없음: $f  (deploy/README.md의 '데이터 올리기'를 먼저 하세요)"; exit 1; }
done
chmod 600 데이터/*key*.txt

echo "== 4. 노선망 미리 만들기 (평일·토·공휴일, 몇 분 걸림)"
PYTHONIOENCODING=utf-8 .venv/bin/python -c "
import sys; sys.path.insert(0, 'engine'); import network
for d in ('WD', 'SAT', 'HOL'): network.load(d); print(d, 'ok')"

echo "== 5. API 서비스 (systemd)"
sudo cp deploy/mova.service /etc/systemd/system/mova.service
sudo systemctl daemon-reload
sudo systemctl enable --now mova
sleep 3
curl -sf http://127.0.0.1:8000/api/health && echo

echo "== 6. HTTPS (Caddy)"
sed "s/{\$MOVA_HOST}/$HOST/" deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "== 7. 정기 수집 (cron): 월·토 14:00 공식 막차, 수·금 22:50 심야버스, 목·토 05:00 심야버스 시간표"
CRON="$APP/.venv/bin/python"
# 기존 crontab이 없으면 crontab -l·grep이 실패하므로 || true (set -e, pipefail 때문)
{ crontab -l 2>/dev/null | grep -v MOVA_ || true
  echo "0 14 * * 1,6 cd $APP && PYTHONIOENCODING=utf-8 $CRON prep/fetch_bus_times.py --log  # MOVA_fetch"
  echo "50 22 * * 3,5 cd $APP && PYTHONIOENCODING=utf-8 $CRON prep/collect_night_bus.py >> prep/out/night_bus.log 2>&1  # MOVA_night"
  echo "0 5 * * 4,6 cd $APP && PYTHONIOENCODING=utf-8 $CRON prep/build_night_timetable.py >> prep/out/night_bus.log 2>&1  # MOVA_nightbuild"
} | crontab -
crontab -l | grep MOVA_

echo
echo "끝. 확인: https://$HOST/api/health   문서: https://$HOST/docs"
