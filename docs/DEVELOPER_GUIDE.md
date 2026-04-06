# Central de Notificacoes - Developer Guide

Este documento explica arquitetura, fluxo interno e operacao da API para facilitar onboarding de novos desenvolvedores.

## 1. Objetivo do sistema

A API recebe requests de sistemas externos e agenda notificacoes para envio por:

- E-mail (SMTP via nodemailer)
- WhatsApp (automacao via whatsapp-web.js)

O envio e assincrono e orientado a fila persistida em SQLite.

## 2. Stack tecnica

- Runtime: Node.js 18+
- API: Express.js
- Banco local: SQLite
- Scheduler: node-cron
- E-mail: nodemailer
- WhatsApp: whatsapp-web.js

## 3. Arquitetura de modulos

- src/index.js: bootstrap da aplicacao, inicializa DB, SMTP, WhatsApp, worker e servidor HTTP.
- src/app.js: definicao de rotas e middleware global de erros.
- src/config.js: leitura e normalizacao de variaveis de ambiente.
- src/db.js: conexao SQLite e criacao de schema.
- src/middleware/apiKeyAuth.js: valida header x-api-key.
- src/middleware/adminAuth.js: protege rotas administrativas com x-admin-token.
- src/services/apiKeyService.js: gera e valida API keys (hash SHA-256 no banco).
- src/services/notificationService.js: valida payload, enfileira, consulta notificacao e processa envios pendentes.
- src/services/emailService.js: wrapper do transporte SMTP.
- src/services/whatsappService.js: ciclo de vida do cliente whatsapp-web.js.
- src/workers/notificationWorker.js: job cron que processa a fila.
- scripts/generate-api-key.js: script CLI para gerar API key.
- tests/load/queue-load.js: teste de carga para validar volume de enfileiramento.

## 4. Fluxo de notificacao (alto nivel)

1. Cliente externo chama POST /notify com x-api-key.
2. Opcionalmente envia Idempotency-Key para deduplicar retry.
3. API valida payload, calcula fingerprint e salva registro em notifications com status pending.
4. Worker roda a cada minuto (ou intervalo configurado).
5. Worker busca mensagens com schedule_at <= agora e status pending.
6. Para cada item:
   - sucesso: status sent e sent_at preenchido.
   - erro com tentativa disponivel: attempts + 1 e status pending.
   - erro no limite de tentativas: status failed + copia para dead_letter_notifications.

## 5. Banco de dados

### Tabela api_keys

- id (PK)
- key_hash (unique, SHA-256)
- label
- is_active (0/1)
- created_at

### Tabela notifications

- id (PK)
- type (email | whatsapp)
- recipient
- subject
- body
- schedule_at (ISO timestamp)
- status (pending | sent | failed)
- attempts
- last_error
- api_key_id
- idempotency_key
- payload_hash
- created_at
- sent_at

### Tabela dead_letter_notifications

- id (PK)
- notification_id (unique)
- type
- recipient
- subject
- body
- schedule_at
- attempts
- last_error
- created_at
- failed_at

## 6. Setup local

1. Instalar dependencias:

   npm install

2. Ajustar variaveis em .env (ou copiar de .env.example).

3. Gerar API key:

   npm run generate:api-key -- "sistema-a"

4. Iniciar aplicacao:

   npm start

## 7. Testes automatizados

Rodar a suite:

   npm test

Rodar teste de carga de enfileiramento:

   npm run test:load

Cobertura atual da suite:

- healthcheck
- autenticacao x-api-key
- enqueue e leitura de notificacao
- listagem paginada por status em GET /notifications
- idempotencia por Idempotency-Key (replay e conflito)
- validacao de id malformado
- criacao de API key por rota admin
- worker com retry, falha por max attempts e persistencia em DLQ

Obs: os testes nao exigem SMTP nem WhatsApp reais. Eles usam um SQLite temporario em ambiente de teste.

## 8. Configuracao de provedores

### SMTP (email)

Configurar no .env:

- SMTP_SERVICE=Gmail ou Outlook
- SMTP_USER
- SMTP_PASS (senha de app)
- SMTP_FROM

Se SMTP nao estiver completo, a API sobe normalmente, mas mensagens de email falham no worker ate configuracao ser concluida.

### WhatsApp

Configurar no .env:

- WHATSAPP_ENABLED=true
- WHATSAPP_AUTH_PATH
- WHATSAPP_CLIENT_ID

Na primeira execucao habilitada, o QR aparece no log. A sessao autenticada fica persistida no diretorio definido em WHATSAPP_AUTH_PATH.

## 9. Seguranca

- Toda rota de negocio usa x-api-key.
- API keys sao armazenadas como hash SHA-256 no SQLite.
- Rota admin usa x-admin-token separado.
- Idempotencia usa chave composta (api_key_id + idempotency_key) para isolamento por cliente.
- Limite de payload JSON em 100kb para reduzir risco de abuso.

## 10. Observabilidade e operacao

Logs importantes:

- [bootstrap] inicializacao de recursos
- [worker] resumo de processamento
- [whatsapp] estado de autenticacao/conexao
- [api] erro interno

Checklist rapido de incidentes:

1. Verificar status em GET /health
2. Consultar notificacao em GET /notifications/:id
3. Revisar last_error no banco
4. Verificar DLQ (tabela dead_letter_notifications) para falhas definitivas
5. Validar variaveis SMTP/WhatsApp no .env

## 11. Proximos passos recomendados

- Adicionar endpoint admin para listar e filtrar DLQ.
- Criar endpoint de reprocessamento de mensagens na DLQ.
- Implementar politica de expiracao para chaves de idempotencia.
- Exportar metricas de fila/worker para observabilidade externa.
