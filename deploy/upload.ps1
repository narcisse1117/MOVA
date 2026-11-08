# 이 컴퓨터(Windows) → EC2로 데이터·키 올리기. 레포 최상위에서 PowerShell로 실행
#   .\deploy\upload.ps1 -Ip 3.38.12.34 -Key C:\Users\osh\.ssh\mova.pem
# GitHub에 없는 것만 올린다: prep/out 결과, 공식 버스 시각, 인증키
param(
    [Parameter(Mandatory = $true)][string]$Ip,
    [Parameter(Mandatory = $true)][string]$Key
)
$ErrorActionPreference = "Stop"
$dest = "ubuntu@${Ip}:/home/ubuntu/MOVA"

ssh -i $Key "ubuntu@$Ip" "mkdir -p /home/ubuntu/MOVA/prep/out /home/ubuntu/MOVA/데이터"

$out = @("stop_times.csv", "stations.csv", "name_aliases.csv", "bus_routes.csv", "bus_stops.csv",
         "bus_route_stops.csv", "bus_segments.csv", "transfers.csv") | ForEach-Object { "prep\out\$_" }
scp -i $Key $out "$dest/prep/out/"

$data = @(Get-ChildItem "데이터\bus_stop_times_*.csv" | ForEach-Object { $_.FullName })
$data += @("데이터\naver_key.txt", "데이터\seoul_key2.txt", "데이터\seoul_key.txt") | Where-Object { Test-Path $_ }
scp -i $Key $data "$dest/데이터/"

Write-Host "올림 끝. 서버에서: cd ~/MOVA && bash deploy/setup.sh $Ip.sslip.io"
