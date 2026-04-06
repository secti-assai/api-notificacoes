# Central de Notificacoes - Guia de Integracao

Este guia descreve como integrar sistemas externos com a API Central de Notificacoes.

## 1. Visao geral

- Base URL local: `http://notificacoes.assai.pr.gov.br`
- Content-Type esperado: `application/json`
- Autenticacao principal: header `x-api-key`

Fluxo padrao de integracao:

1. Gerar uma API key.
2. Validar disponibilidade da API em `GET /health`.
3. Enviar notificacoes em `POST /notify`.
4. Consultar status em `GET /notifications/:id` ou listagem em `GET /notifications`.

## 2. Autenticacao

### 2.1 Header obrigatorio para rotas de negocio

Use sempre:

```http
x-api-key: SUA_CHAVE
```

Sem esse header, a API retorna `401 Missing x-api-key header`.

Se a chave nao existir/estiver inativa, retorna `403 Invalid API key`.

### 2.2 Header para rotas admin

Para rotas administrativas (criacao de chave via endpoint), use:

```http
x-admin-token: TOKEN_ADMIN
```

Esse token vem da variavel `ADMIN_TOKEN`.

## 3. Geracao de API key

Existem 2 formas oficiais.

### 3.1 Via script CLI (recomendado para operacao)

Comando:

```bash
npm run generate:api-key -- "nome-do-sistema"
```

Exemplo de saida:

```text
API key created successfully.
Label: nome-do-sistema
x-api-key: nfy_...
```

Observacoes:

- A chave real com prefixo `nfy_` aparece somente na geracao.
- No banco, a chave e armazenada em hash SHA-256.
- Guarde a chave em cofre seguro (Vault/Secrets Manager).

### 3.2 Via endpoint admin

`POST /admin/api-keys`

Headers:

- `Content-Type: application/json`
- `x-admin-token: <ADMIN_TOKEN>`

Body (opcional):

```json
{
  "label": "erp-backoffice"
}
```

Resposta `201`:

```json
{
  "message": "API key created",
  "api_key": "nfy_...",
  "label": "erp-backoffice"
}
```

## 4. Endpoints de integracao

### 4.1 GET /health

Uso: health check da API.

Autenticacao: nao exige `x-api-key`.

Resposta `200`:

```json
{
  "status": "ok",
  "timestamp": "2026-04-06T12:00:00.000Z",
  "whatsapp": "disabled"
}
```

Campo `whatsapp` pode ser:

- `disabled`
- `initializing`
- `ready`

### 4.2 POST /notify

Uso: enfileirar notificacao para envio futuro/imediato.

Autenticacao: exige `x-api-key`.

Headers opcionais de idempotencia (use um deles):

- `Idempotency-Key: <valor-unico>`
- `x-idempotency-key: <valor-unico>`

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

Campos obrigatorios:

- `type`: `email` ou `whatsapp`
- `to`: destino (email ou numero WhatsApp)
- `subject`: titulo da mensagem
- `body`: conteudo
- `schedule_at`: data/hora de agendamento

Formatos aceitos para `schedule_at`:

- ISO 8601 (`2026-04-06T18:00:00.000Z`)
- Unix timestamp em segundos (`1712426400`)
- Unix timestamp em milissegundos (`1712426400000`)

Respostas:

- `202 Notification accepted`: enfileirado normalmente
- `200 Notification replayed from idempotency cache`: chave idempotente repetida com mesmo payload
- `400`: erro de validacao de payload
- `401`: sem `x-api-key`
- `403`: chave invalida
- `422`: `Idempotency-Key` reutilizada com payload diferente

Resposta exemplo (`202`):

```json
{
  "message": "Notification accepted",
  "notification": {
    "id": 123,
    "type": "whatsapp",
    "recipient": "5511999998888",
    "to": "5511999998888",
    "subject": "Lembrete",
    "body": "Sua reuniao comeca em 30 minutos.",
    "schedule_at": "2026-04-06T18:00:00.000Z",
    "status": "pending",
    "attempts": 0,
    "last_error": null,
    "idempotency_key": null,
    "created_at": "2026-04-06 17:58:00",
    "sent_at": null,
    "idempotency_replayed": false
  }
}
```

### 4.3 GET /notifications/:id

Uso: consultar uma notificacao por ID.

Autenticacao: exige `x-api-key`.

Respostas:

- `200`: encontrado
- `400`: id invalido (nao numerico)
- `404`: nao encontrado

Resposta `200` (exemplo):

```json
{
  "id": 123,
  "type": "email",
  "recipient": "destino@empresa.com",
  "to": "destino@empresa.com",
  "subject": "Teste",
  "body": "Mensagem",
  "schedule_at": "2026-04-06T18:00:00.000Z",
  "status": "sent",
  "attempts": 1,
  "last_error": null,
  "idempotency_key": "evt-2026-04-06-1",
  "created_at": "2026-04-06 17:58:00",
  "sent_at": "2026-04-06T18:00:10.123Z"
}
```

### 4.4 GET /notifications

Uso: listagem com paginacao e filtro por status.

Autenticacao: exige `x-api-key`.

Query params:

- `status`: `pending`, `sent`, `failed` (opcional)
- `page`: inteiro positivo (padrao `1`)
- `page_size`: inteiro positivo ate `100` (padrao `20`)

Resposta `200`:

```json
{
  "items": [
    {
      "id": 123,
      "type": "email",
      "recipient": "destino@empresa.com",
      "to": "destino@empresa.com",
      "subject": "Teste",
      "body": "Mensagem",
      "schedule_at": "2026-04-06T18:00:00.000Z",
      "status": "pending",
      "attempts": 0,
      "last_error": null,
      "idempotency_key": null,
      "created_at": "2026-04-06 17:58:00",
      "sent_at": null
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 1,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "filters": {
    "status": "pending"
  }
}
```

### 4.5 POST /admin/api-keys

Uso: gerar API key por endpoint administrativo.

Autenticacao: exige `x-admin-token`.

Body opcional:

```json
{
  "label": "nome-do-cliente"
}
```

Respostas:

- `201`: chave criada
- `401`: token admin ausente ou invalido
- `503`: `ADMIN_TOKEN` nao configurado

## 5. Exemplos de integracao

### 5.1 cURL - enfileirar notificacao

```bash
curl -X POST "http://localhost:3000/notify" \
  -H "Content-Type: application/json" \
  -H "x-api-key: SUA_CHAVE" \
  -H "Idempotency-Key: pedido-123" \
  -d '{
    "type": "email",
    "to": "destino@empresa.com",
    "subject": "Pedido aprovado",
    "body": "Seu pedido foi aprovado.",
    "schedule_at": "2026-04-06T18:00:00.000Z"
  }'
```

### 5.2 cURL - consultar status por id

```bash
curl "http://localhost:3000/notifications/123" \
  -H "x-api-key: SUA_CHAVE"
```

### 5.3 JavaScript (Node.js 18+)

```js
const baseUrl = "http://localhost:3000";
const apiKey = process.env.NOTIFICATIONS_API_KEY;

async function enqueue() {
  const response = await fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "Idempotency-Key": "erp-order-001"
    },
    body: JSON.stringify({
      type: "whatsapp",
      to: "5511999998888",
      subject: "Atualizacao",
      body: "Seu pedido saiu para entrega.",
      schedule_at: new Date(Date.now() + 60_000).toISOString()
    })
  });

  const payload = await response.json();
  console.log(response.status, payload);
}

void enqueue();
```

## 6. Boas praticas de integracao

1. Sempre envie `Idempotency-Key` para operacoes sujeitas a retry de rede.
2. Armazene o `notification.id` retornado no seu sistema para rastreabilidade.
3. Trate `202` como aceito em fila (nao como enviado).
4. Consulte periodicamente o status em `GET /notifications/:id` quando precisar confirmacao.
5. Proteja `x-api-key` e `x-admin-token` em secrets do ambiente, nunca em codigo fonte.

## 7. Erros comuns

- `401 Missing x-api-key header`: header de autenticacao ausente.
- `403 Invalid API key`: chave invalida/inativa.
- `400 Field 'schedule_at' is required`: payload sem agendamento.
- `400 Field 'schedule_at' must be a valid timestamp`: formato invalido de data.
- `422 Idempotency-Key already used with different payload`: chave idempotente reutilizada com body diferente.
- `503 ADMIN_TOKEN is not configured`: rota admin usada sem configurar `ADMIN_TOKEN`.
