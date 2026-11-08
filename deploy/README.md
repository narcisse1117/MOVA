# deploy: AWS EC2(서울)에 백엔드 올리기

구성: EC2 (Ubuntu 24.04, 메모리 2GB) 한 대에 FastAPI(uvicorn) + Caddy(HTTPS) + cron(정기 수집).
프론트(React, Vercel)는 `https://주소/api/...`를 부른다.

## 0. AWS 계정 (사용자)

1. https://aws.amazon.com 가입 (카드 등록)
2. **결제 알림 먼저:** 콘솔 → Billing and Cost Management → Budgets → 예산 만들기 → 월 예산(예: 15,000원 ≈ 10달러), 80% 넘으면 메일
3. 오른쪽 위 리전을 **아시아 태평양(서울) ap-northeast-2**로

## 1. 서버 만들기 (콘솔에서)

EC2 → 인스턴스 시작
- 이름 `mova`, AMI **Ubuntu Server 24.04 LTS**, 인스턴스 유형 **t3.small** (2GB)
- 키 페어: 새로 만들기 → `mova` (RSA, .pem) → 내려받은 파일을 `C:\Users\osh\.ssh\mova.pem`에 둔다
- 네트워크 설정 → 보안 그룹: **SSH(22) 내 IP만**, **HTTP(80)**, **HTTPS(443)** 허용
- 스토리지 20GB
- 시작 후: EC2 → 탄력적 IP → 할당 → 이 인스턴스에 연결 (주소가 안 바뀌게)

## 2. 접속과 코드 받기

```
ssh -i C:\Users\osh\.ssh\mova.pem ubuntu@<탄력적IP>
```

레포가 비공개라 서버용 읽기 전용 키(Deploy key)를 쓴다.
```
ssh-keygen -t ed25519 -N "" -f ~/.ssh/github_mova
cat ~/.ssh/github_mova.pub      # 출력된 한 줄을 GitHub 레포 → Settings → Deploy keys → Add (Allow write 끄기)
printf 'Host github.com\n  IdentityFile ~/.ssh/github_mova\n' >> ~/.ssh/config
git clone git@github.com:narcisse1117/MOVA.git ~/MOVA
```

## 3. 데이터 올리기 (이 컴퓨터에서, PowerShell)

GitHub에 없는 정리 결과·공식 버스 시각·인증키를 올린다.
```
cd C:\Users\osh\Claude\택시
.\deploy\upload.ps1 -Ip <탄력적IP> -Key C:\Users\osh\.ssh\mova.pem
```

## 4. 설치 (서버에서)

```
cd ~/MOVA && bash deploy/setup.sh <탄력적IP>.sslip.io
```
- Python 환경, 노선망 미리 만들기, API 서비스(systemd, 꺼져도 자동 재시작), HTTPS(Caddy, 자동 인증서), 정기 수집(cron)
- 도메인이 없으면 `<IP>.sslip.io`가 그 IP를 가리키는 무료 주소라 HTTPS 인증서를 받을 수 있다. 도메인을 사면 그 주소로 바꾸면 된다
- 확인: `https://<IP>.sslip.io/api/health`, 문서 `https://<IP>.sslip.io/docs`

## 정기 수집 (서버가 24시간 켜져 있어서 여기서 돈다)

| 언제 | 무엇 |
|---|---|
| 월·토 14:00 | `fetch_bus_times.py` 정류장별 공식 첫차·막차 (평일·토요일) |
| 수·금 22:50 | `collect_night_bus.py` 심야버스 실제 통과 시각 |

공휴일 값이 필요하면 일요일에 `fetch_bus_times.py`를 한 번 돌린다. 새 파일이 생기면 API 서버가 다음 요청 때 노선망을 다시 읽는다.

## 코드 업데이트

```
cd ~/MOVA && git pull && .venv/bin/pip install -r requirements.txt && sudo systemctl restart mova
```

## 문제 확인

```
sudo systemctl status mova          # 서비스 상태
journalctl -u mova -n 100           # 최근 로그
sudo systemctl status caddy         # HTTPS
crontab -l                          # 정기 수집
```
