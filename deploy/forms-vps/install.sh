#!/bin/bash
# Run from this directory as root. No package installation, no deletion.
set -euo pipefail
cd -- "$(dirname -- "$0")"
node_bin=$(command -v node)
"$node_bin" --input-type=module -e 'if(Number(process.versions.node.split(".")[0])<18)throw Error("Нужен Node.js 18+. Ничего не установлено.")'
command -v nginx >/dev/null
command -v python3 >/dev/null
command -v curl >/dev/null
command -v systemctl >/dev/null
[ "$(id -u)" = 0 ] || { echo 'Запустите от root'; exit 1; }
[ -x /usr/bin/node ] || { echo 'Нужен системный /usr/bin/node; установку Node не выполняем.'; exit 1; }
/usr/bin/node --input-type=module -e 'if(Number(process.versions.node.split(".")[0])<18)throw Error("/usr/bin/node должен быть версии 18+")'
config=/etc/nginx/sites-enabled/sbor-otzyvov
html=/var/www/siyai-main/dist/client/index.html
[ -f "$config" ] && [ -f "$html" ]
for item in /opt/siyai-forms /etc/siyai-forms.env /etc/systemd/system/siyai-forms.service /etc/nginx/snippets/siyai-forms.conf; do
 [ ! -e "$item" ] || { echo "Уже существует: $item. Остановка без перезаписи."; exit 1; }
done
if ss -lntH 'sport = :3001' | grep -q .; then echo 'Порт 3001 занят'; exit 1; fi
nginx -t
python3 - "$config" "$html" <<'PY'
import sys
from pathlib import Path
c=Path(sys.argv[1]).read_text();h=Path(sys.argv[2]).read_text()
assert c.count('root /var/www/siyai-main/dist/client;')==1, 'Неожиданная конфигурация root'
assert 'server_name 185.219.43.207;' in c, 'Неожиданный server_name'
assert '/api/' not in c, 'Уже есть настройки API — нужна ручная проверка'
assert "endpoint: '/api/forms'" in h, 'Неожиданная версия интерфейса'
assert 'crypto.randomUUID()' in h, 'Нужна ручная проверка генерации ID'
PY
backup=$(mktemp -d /var/backups/siyai-forms-XXXXXXXX)
cp -aL "$config" "$backup/nginx.conf"
cp -a "$html" "$backup/index.html"
echo "Резервная копия: $backup"
install -d -m 755 /opt/siyai-forms
install -m 644 server.mjs /opt/siyai-forms/server.mjs
install -d -o www-data -g www-data -m 700 /var/lib/siyai-forms
python3 - <<'PY'
import secrets,os
fd=os.open('/etc/siyai-forms.env',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:
 f.write('PUBLIC_ORIGIN=http://185.219.43.207\nPORT=3001\nDATA_FILE=/var/lib/siyai-forms/messages.jsonl\nFORMS_SECRET='+secrets.token_hex(32)+'\n')
PY
cat > /etc/systemd/system/siyai-forms.service <<'UNIT'
[Unit]
Description=Siyai persistent forms API
After=network.target
[Service]
Type=simple
User=www-data
Group=www-data
EnvironmentFile=/etc/siyai-forms.env
ExecStart=/usr/bin/node /opt/siyai-forms/server.mjs
WorkingDirectory=/opt/siyai-forms
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/siyai-forms
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now siyai-forms
for attempt in 1 2 3 4 5; do
 if curl -fsS --max-time 2 http://127.0.0.1:3001/health >/dev/null; then break; fi
 sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:3001/health >/dev/null
install -m 644 nginx.conf /etc/nginx/snippets/siyai-forms.conf
python3 - "$config" "$html" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);c=p.read_text();p.write_text(c.replace('root /var/www/siyai-main/dist/client;', 'include /etc/nginx/snippets/siyai-forms.conf;\n    root /var/www/siyai-main/dist/client;'))
p=Path(sys.argv[2]);s=p.read_text()
fallback="(typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)))"
p.write_text(s.replace('crypto.randomUUID()',fallback))
PY
if ! nginx -t; then
 cp "$backup/nginx.conf" "$config"
 cp "$backup/index.html" "$html"
 echo 'Проверка не пройдена: настройки и HTML восстановлены. Новый сервис оставлен для диагностики.'
 exit 1
fi
if ! systemctl reload nginx; then
 cp "$backup/nginx.conf" "$config"
 cp "$backup/index.html" "$html"
 nginx -t && systemctl reload nginx
 echo 'Перезагрузка не прошла: настройки и HTML восстановлены.'
 exit 1
fi
curl -fsS --max-time 5 -H 'Host: 185.219.43.207' -H 'Origin: http://185.219.43.207' http://127.0.0.1/api/forms/challenge >/dev/null
echo 'Обработчик подключён. Обновите браузер Ctrl+F5 и отправьте пробный отзыв.'
echo 'Просмотр сообщений: sudo /usr/bin/node /opt/siyai-forms/server.mjs --list'
echo "Откат: cp '$backup/nginx.conf' '$config'; cp '$backup/index.html' '$html'; nginx -t && systemctl reload nginx; systemctl disable --now siyai-forms"
