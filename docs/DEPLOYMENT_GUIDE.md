# Central de Notificacoes - Guia de Deploy

Este documento descreve um caminho recomendado para deploy em producao usando:

- Linux (Ubuntu)
- Node.js 18+
- PM2 (process manager)
- Nginx (reverse proxy)
- SQLite com arquivos persistentes

## 1. Observacoes importantes

- Esta API e stateful por usar SQLite local e sessao do WhatsApp em disco.
- Evite plataformas serverless para este servico.
- Em producao, mantenha persistentes os diretorios:
  - `data/`
  - `.wwebjs_auth/`
  - `logs/`

## 2. Requisitos de servidor

- Ubuntu 22.04+ (ou distribuicao Linux equivalente)
- 2 vCPU, 2 GB RAM (minimo recomendado)
- Node.js 18+
- NPM
- Nginx

Pacotes de sistema recomendados:

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 make g++ nginx
```

Dependencias de runtime do Chrome/Puppeteer (obrigatorio para WhatsApp):

```bash
sudo apt update
sudo apt install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  xdg-utils
```

Nota para Ubuntu 24+: em alguns ambientes o pacote pode ser `libasound2t64`.

## 3. Instalar Node.js 18+

Exemplo com NodeSource (Node 20 LTS):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 4. Preparar aplicacao

```bash
sudo mkdir -p /opt/central-notificacoes
sudo chown -R $USER:$USER /opt/central-notificacoes
cd /opt/central-notificacoes

git clone <URL_DO_REPOSITORIO> .
npm ci --omit=dev
```

Criar diretorios necessarios:

```bash
mkdir -p data logs .wwebjs_auth
```

## 5. Configurar ambiente (.env)

Crie o arquivo `.env` com base no `.env.example`:

```bash
cp .env.example .env
```

Valores recomendados para producao:

```env
NODE_ENV=production
PORT=3000

SQLITE_FILE=./data/notifications.sqlite3
LOG_FILE=./logs/processing.log

WORKER_CRON=* * * * *
WORKER_BATCH_SIZE=50
WORKER_MAX_ATTEMPTS=3

ADMIN_TOKEN=<TOKEN_FORTE>

SMTP_SERVICE=Gmail
SMTP_USER=<EMAIL>
SMTP_PASS=<SENHA_APP>
SMTP_FROM=Central Notificacoes <email@dominio.com>

WHATSAPP_ENABLED=true
WHATSAPP_AUTH_PATH=./.wwebjs_auth
WHATSAPP_CLIENT_ID=central-notificacoes
WHATSAPP_DEFAULT_COUNTRY_CODE=55
WHATSAPP_EXECUTABLE_PATH=
WHATSAPP_HEADLESS=true
WHATSAPP_NO_SANDBOX=true
```

Opcional (recomendado em producao): instalar o Chromium do sistema e apontar o executavel.

```bash
sudo apt install -y chromium-browser || sudo apt install -y chromium
```

Depois, configure no `.env` (um dos caminhos abaixo):

```env
WHATSAPP_EXECUTABLE_PATH=/usr/bin/chromium-browser
# ou
WHATSAPP_EXECUTABLE_PATH=/usr/bin/chromium
```

## 6. Primeira inicializacao (WhatsApp)

Se `WHATSAPP_ENABLED=true`, e necessario autenticar a sessao:

```bash
npm start
```

Escaneie o QR Code exibido no terminal.

Depois de autenticar e ver "Cliente pronto para envio", encerre o processo (`Ctrl+C`).

## 7. Rodar em background com PM2

Instalar PM2:

```bash
sudo npm install -g pm2
```

Subir aplicacao:

```bash
cd /opt/central-notificacoes
pm2 start src/index.js --name central-notificacoes
pm2 save
pm2 startup
```

Comandos uteis:

```bash
pm2 status
pm2 logs central-notificacoes
pm2 restart central-notificacoes
pm2 stop central-notificacoes
```

## 8. Configurar Nginx (reverse proxy)

Arquivo `/etc/nginx/sites-available/central-notificacoes`:

```nginx
server {
    listen 80;
    server_name api.seudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ativar site:

```bash
sudo ln -s /etc/nginx/sites-available/central-notificacoes /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 9. HTTPS com Certbot (recomendado)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.seudominio.com
```

## 10. Validacao pos-deploy

Health check:

```bash
curl -s http://127.0.0.1:3000/health
```

Logs em arquivo:

```bash
tail -f /opt/central-notificacoes/logs/processing.log
```

## 11. Rotina de atualizacao

```bash
cd /opt/central-notificacoes
git pull
npm ci --omit=dev
pm2 restart central-notificacoes
```

## 12. Backup e recuperacao

Recomenda-se backup periodico de:

- `data/notifications.sqlite3`
- `.wwebjs_auth/`
- `.env`

Exemplo simples:

```bash
mkdir -p /opt/backups/central-notificacoes
cp data/notifications.sqlite3 /opt/backups/central-notificacoes/notifications-$(date +%F-%H%M%S).sqlite3
```

## 13. Troubleshooting rapido

- Porta em uso: verifique processos com `lsof -i :3000`.
- WhatsApp sem enviar: confira estado em `/health` e logs em `logs/processing.log`.
- Erro de sessao do browser: garanta somente 1 instancia da API rodando.
- Falha de email: valide `SMTP_USER`, `SMTP_PASS` e senha de app do provedor.

### Erro: `Failed to launch the browser process` + `libatk-1.0.so.0`

Esse erro indica dependencia nativa faltando no Linux para o Chrome do Puppeteer.

1. Instale as dependencias de runtime do Chrome (secao 2).
2. Opcionalmente instale Chromium do sistema e configure `WHATSAPP_EXECUTABLE_PATH`.
3. Reinicie o processo:

```bash
pm2 restart central-notificacoes
```

4. Se ainda falhar, identifique bibliotecas faltantes:

```bash
ldd ~/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome | grep 'not found'
```

