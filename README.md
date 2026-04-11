# Açaí Beleza — Servidor Backend

Servidor Node.js com Express, Firebase Admin e Mercado Pago.  
Pronto para deploy no **Render.com**.

---

## Rotas disponíveis

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/` | — | Health check |
| GET | `/pedidos` | Admin | Lista todos os pedidos |
| GET | `/pedidos/:id` | Admin | Busca um pedido |
| POST | `/pedidos` | — | Cria pedido (chamado pelo site) |
| PATCH | `/pedidos/:id` | Admin | Atualiza status/itens |
| DELETE | `/pedidos/:id` | Admin | Marca como deletado |
| GET | `/menu` | — | Retorna o cardápio |
| PUT | `/menu` | Admin | Atualiza cardápio |
| GET | `/cupons/:codigo` | — | Valida cupom |
| GET | `/cupons` | Admin | Lista cupons |
| POST | `/cupons` | Admin | Cria cupom |
| PATCH | `/cupons/:id` | Admin | Edita cupom |
| DELETE | `/cupons/:id` | Admin | Remove cupom |
| POST | `/pagamento/pix` | — | Gera QR Code Pix (MP) |
| GET | `/pagamento/:id/status` | — | Consulta status do pagamento |
| POST | `/webhook/mercadopago` | — | Recebe notificações do MP |
| GET | `/relatorio` | Admin | Relatório de vendas |

**Auth Admin:** header `x-admin-token: acai2024`

---

## Deploy no Render — Passo a passo

### 1. Suba para o GitHub

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/acai-beleza-server.git
git push -u origin main
```

### 2. Crie o serviço no Render

1. Acesse [render.com](https://render.com) → **New → Web Service**
2. Conecte seu repositório GitHub
3. Configure:
   - **Name:** `acai-beleza-server`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free

### 3. Configure as variáveis de ambiente no Render

No painel do serviço → **Environment** → adicione:

| Chave | Valor |
|-------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON completo da service account (veja abaixo) |
| `FIREBASE_DATABASE_URL` | `https://acai-beleza-default-rtdb.firebaseio.com` |
| `MP_ACCESS_TOKEN` | `APP_USR-7406212380952607-...` |
| `MP_PUBLIC_KEY` | `APP_USR-1978b500-...` |
| `ADMIN_PASS` | `acai2024` |
| `SECRET_KEY` | qualquer string aleatória longa |
| `SERVER_URL` | URL do seu serviço no Render (após deploy) |

### 4. Como obter a Service Account do Firebase

1. Firebase Console → ⚙️ Configurações do projeto
2. Aba **Contas de serviço**
3. Clique em **Gerar nova chave privada**
4. Baixa o arquivo `.json`
5. Abre o arquivo, copia o conteúdo **inteiro** (é um JSON grande)
6. Cola na variável `FIREBASE_SERVICE_ACCOUNT` no Render

### 5. Configure o Webhook do Mercado Pago

Após o deploy, pegue a URL do servidor (ex: `https://acai-beleza-server.onrender.com`) e registre o webhook:

```
URL do Webhook: https://acai-beleza-server.onrender.com/webhook/mercadopago
Eventos: payment
```

No painel do Mercado Pago → Seu negócio → Configurações → Webhooks.

---

## Cupons — Estrutura no Firebase

Crie manualmente no Firebase Console em `cupons/`:

```json
{
  "PROMO10": {
    "codigo": "PROMO10",
    "tipo": "porcentagem",
    "valor_desconto": 10,
    "validade": "2025-12-31",
    "ativo": true
  },
  "DESC5": {
    "codigo": "DESC5",
    "tipo": "fixo",
    "valor_desconto": 5,
    "validade": null,
    "ativo": true
  }
}
```

---

## Teste local

```bash
# Instalar dependências
npm install

# Copiar e preencher variáveis
cp .env.example .env
# edite o .env com suas chaves reais

# Rodar em desenvolvimento
npm run dev

# Testar health check
curl http://localhost:3000/
```
