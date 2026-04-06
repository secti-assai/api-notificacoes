# Central de Notificacoes API (Node.js)

API leve em Node.js para receber notificacoes de multiplos sistemas e enviar por
WhatsApp ou E-mail de forma agendada.

## Stack

- Express.js (API HTTP)
- SQLite (fila, status e API keys)
- node-cron (worker a cada minuto)
- nodemailer (SMTP gratuito, ex: Gmail/Outlook)
- whatsapp-web.js (automacao via QR Code)

## Requisitos

- Node.js 18+
- NPM

## Documentacao

- Guia tecnico de desenvolvimento: `docs/DEVELOPER_GUIDE.md`
- Guia de deploy em producao: `docs/DEPLOYMENT_GUIDE.md`
- Guia de integracao para sistemas externos: `docs/INTEGRATION_GUIDE.md`

## Como rodar

1. Instale as dependencias:

```bash
npm install
```

2. Revise as variaveis no arquivo `.env`.

3. Gere uma chave de API para chamadas protegidas:

```bash
npm run generate:api-key -- "sistema-principal"
```

4. Inicie a API:

```bash
npm start
```

A API sobe na porta definida em `PORT` (padrao `3000`).

## Testes automatizados

Rode a suite local:

```bash
npm test
```

Os testes cobrem autenticacao, enfileiramento, consulta de status, rota admin e
worker com retry/falha sem depender de credenciais reais de SMTP/WhatsApp.

## Teste de carga (fila)

Execute um teste de volume para validar enfileiramento:

```bash
npm run test:load
```

Variaveis opcionais para ajustar o volume:

- `LOAD_TOTAL` (padrao `1000`)
- `LOAD_CONCURRENCY` (padrao `50`)
- `LOAD_SCHEDULE_OFFSET_MINUTES` (padrao `60`)

## Endpoints

### GET /health

Endpoint de saude (nao exige API key).

### POST /notify

Enfileira notificacoes agendadas. Exige header `x-api-key`.

Header opcional para idempotencia:

- `Idempotency-Key: <valor-unico>`

Comportamento de idempotencia:

- Mesmo `Idempotency-Key` + mesmo payload: retorna o mesmo registro (status HTTP `200`)
- Mesmo `Idempotency-Key` + payload diferente: rejeita com `422`
- Sem replay: enfileira normalmente (status HTTP `202`)

Body JSON:

```json
{
  "type": "whatsapp",
  "to": "5511999998888",
  "subject": "Lembrete",
  "body": "Sua reuniao comeca em 30 minutos.",
  "schedule_at": "2026-04-06T18:00:00.000Z"
}
```

Campos:

- `type`: `whatsapp` ou `email`
- `to`: numero (whatsapp) ou endereco de e-mail
- `subject`: assunto/texto de cabecalho
- `body`: conteudo da mensagem
- `schedule_at`: timestamp futuro (ISO, unix segundos ou unix ms)

### GET /notifications/:id

Consulta status de uma notificacao. Exige `x-api-key`.

### GET /notifications

Lista notificacoes com paginacao e filtro por status. Exige `x-api-key`.

Query params:

- `status`: `pending`, `sent` ou `failed` (opcional)
- `page`: inteiro positivo (padrao `1`)
- `page_size`: inteiro positivo ate `100` (padrao `20`)

### POST /admin/api-keys

Cria nova API key via rota protegida por token admin.

- Header obrigatorio: `x-admin-token: <ADMIN_TOKEN>`
- Body opcional: `{ "label": "nome-do-sistema" }`

## Worker interno

- Roda com `node-cron` a cada minuto (`WORKER_CRON=* * * * *`)
- Busca registros com `status = pending` e `schedule_at <= agora`
- Atualiza status para:
  - `sent` quando envio conclui
  - `pending` para retry
  - `failed` ao ultrapassar `WORKER_MAX_ATTEMPTS`
- Ao atingir `failed`, a notificacao e copiada para a DLQ (`dead_letter_notifications`)

## Configuracao SMTP

Voce pode usar `SMTP_SERVICE=Gmail` ou `SMTP_SERVICE=Hotmail/Outlook`.

Exemplo para Gmail:

- `SMTP_SERVICE=Gmail`
- `SMTP_USER=seu-email@gmail.com`
- `SMTP_PASS=<senha de app>`
- `SMTP_FROM=Central Notificacoes <seu-email@gmail.com>`

## Configuracao WhatsApp

Para habilitar:

- `WHATSAPP_ENABLED=true`
- `WHATSAPP_DEFAULT_COUNTRY_CODE=55` (usado quando o numero vier sem DDI)

Na primeira execucao, o cliente exibira o QR no log para autenticacao.
A sessao fica salva em `.wwebjs_auth`.

Formatos aceitos para `to` (WhatsApp):

- `+55 (43) 99116-9431`
- `55 43 99116-9431`
- `5543991169431`

A API remove simbolos automaticamente e resolve o JID antes do envio.

## Exemplo de chamada (PowerShell)

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "x-api-key" = "SUA_API_KEY"
}

$body = @{
  type = "email"
  to = "destino@exemplo.com"
  subject = "Teste"
  body = "Mensagem agendada"
  schedule_at = (Get-Date).AddMinutes(1).ToString("o")
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/notify" -Headers $headers -Body $body
```
