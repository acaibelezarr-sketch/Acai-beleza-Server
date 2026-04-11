// ============================================================
//  Açaí Beleza — Servidor Backend
//  Node.js + Express + Firebase Admin + Mercado Pago
//  Pronto para deploy no Render.com
// ============================================================

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const admin    = require('firebase-admin');

// ─────────────────────────────────────────────
//  FIREBASE ADMIN
// ─────────────────────────────────────────────
let db;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential:  admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  db = admin.database();
  console.log('✅ Firebase Admin conectado');
} catch (err) {
  console.error('❌ Erro ao inicializar Firebase:', err.message);
  process.exit(1);
}

// ─────────────────────────────────────────────
//  MERCADO PAGO
// ─────────────────────────────────────────────
const MP_TOKEN  = process.env.MP_ACCESS_TOKEN;
const MP_BASE   = 'https://api.mercadopago.com';
const mpHeaders = {
  Authorization:  `Bearer ${MP_TOKEN}`,
  'Content-Type': 'application/json',
  'X-Idempotency-Key': '', // preenchido por requisição
};

// ─────────────────────────────────────────────
//  EXPRESS
// ─────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
}

function fbRef(path) {
  return db.ref(path);
}

// ─────────────────────────────────────────────
//  ROTA: Health check (Render usa isso)
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Açaí Beleza Server',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
//  PEDIDOS — GET todos
// ─────────────────────────────────────────────
app.get('/pedidos', authMiddleware, async (req, res) => {
  try {
    const snap = await fbRef('pedidos').once('value');
    const data = snap.val() || {};
    // Converte objeto Firebase em array ordenado por data
    const lista = Object.entries(data)
      .map(([id, v]) => ({ id, ...v }))
      .filter(p => p.status !== 'deletado')
      .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    res.json({ ok: true, pedidos: lista });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  PEDIDOS — GET um pedido
// ─────────────────────────────────────────────
app.get('/pedidos/:id', authMiddleware, async (req, res) => {
  try {
    const snap = await fbRef(`pedidos/${req.params.id}`).once('value');
    if (!snap.exists()) return res.status(404).json({ error: 'Pedido não encontrado' });
    res.json({ ok: true, pedido: { id: req.params.id, ...snap.val() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  PEDIDOS — POST criar
// ─────────────────────────────────────────────
app.post('/pedidos', async (req, res) => {
  try {
    const pedido = {
      ...req.body,
      status:      req.body.status || 'novo',
      criadoEm:    new Date().toISOString(),
      criadoEmStr: new Date().toLocaleString('pt-BR'),
    };
    const ref  = await fbRef('pedidos').push(pedido);
    res.json({ ok: true, id: ref.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  PEDIDOS — PATCH atualizar status/itens
// ─────────────────────────────────────────────
app.patch('/pedidos/:id', authMiddleware, async (req, res) => {
  try {
    await fbRef(`pedidos/${req.params.id}`).update({
      ...req.body,
      atualizadoEm: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  PEDIDOS — DELETE (marca como deletado)
// ─────────────────────────────────────────────
app.delete('/pedidos/:id', authMiddleware, async (req, res) => {
  try {
    await fbRef(`pedidos/${req.params.id}`).update({
      status:      'deletado',
      deletadoEm:  new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  MENU — GET
// ─────────────────────────────────────────────
app.get('/menu', async (req, res) => {
  try {
    const snap = await fbRef('menu').once('value');
    res.json({ ok: true, menu: snap.val() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  MENU — PUT atualizar (admin)
// ─────────────────────────────────────────────
app.put('/menu', authMiddleware, async (req, res) => {
  try {
    await fbRef('menu').set(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  CUPONS — GET validar cupom
// ─────────────────────────────────────────────
app.get('/cupons/:codigo', async (req, res) => {
  try {
    const snap = await fbRef('cupons').once('value');
    const todos = snap.val() || {};
    const entrada = req.params.codigo.toUpperCase().trim();

    const cupom = Object.entries(todos)
      .map(([id, v]) => ({ id, ...v }))
      .find(c => c.codigo?.toUpperCase() === entrada && c.ativo === true);

    if (!cupom) {
      return res.status(404).json({ ok: false, error: 'Cupom inválido ou inativo' });
    }

    // Verifica validade
    if (cupom.validade) {
      const validade = new Date(cupom.validade);
      validade.setHours(23, 59, 59);
      if (new Date() > validade) {
        return res.status(400).json({ ok: false, error: 'Cupom expirado' });
      }
    }

    res.json({
      ok: true,
      cupom: {
        codigo:         cupom.codigo,
        tipo:           cupom.tipo,           // 'porcentagem' | 'fixo'
        valor_desconto: cupom.valor_desconto,
        validade:       cupom.validade || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  CUPONS — GET todos (admin)
// ─────────────────────────────────────────────
app.get('/cupons', authMiddleware, async (req, res) => {
  try {
    const snap = await fbRef('cupons').once('value');
    const data = snap.val() || {};
    const lista = Object.entries(data).map(([id, v]) => ({ id, ...v }));
    res.json({ ok: true, cupons: lista });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  CUPONS — POST criar (admin)
// ─────────────────────────────────────────────
app.post('/cupons', authMiddleware, async (req, res) => {
  try {
    const { codigo, valor_desconto, tipo, validade, ativo } = req.body;
    if (!codigo || !valor_desconto || !tipo) {
      return res.status(400).json({ error: 'codigo, valor_desconto e tipo são obrigatórios' });
    }
    const ref = await fbRef('cupons').push({
      codigo:         codigo.toUpperCase().trim(),
      valor_desconto: Number(valor_desconto),
      tipo,           // 'porcentagem' | 'fixo'
      validade:       validade || null,
      ativo:          ativo !== false,
      criadoEm:       new Date().toISOString(),
    });
    res.json({ ok: true, id: ref.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  CUPONS — PATCH atualizar (admin)
// ─────────────────────────────────────────────
app.patch('/cupons/:id', authMiddleware, async (req, res) => {
  try {
    await fbRef(`cupons/${req.params.id}`).update(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  CUPONS — DELETE (admin)
// ─────────────────────────────────────────────
app.delete('/cupons/:id', authMiddleware, async (req, res) => {
  try {
    await fbRef(`cupons/${req.params.id}`).remove();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  MERCADO PAGO — Criar pagamento Pix
// ─────────────────────────────────────────────
app.post('/pagamento/pix', async (req, res) => {
  try {
    const { total, nome, email, cpf, pedido_id, descricao } = req.body;

    if (!total || !nome) {
      return res.status(400).json({ error: 'total e nome são obrigatórios' });
    }

    const idempotencyKey = `acai-${pedido_id || Date.now()}-${Math.random().toString(36).slice(2)}`;

    const payload = {
      transaction_amount: Number(Number(total).toFixed(2)),
      description:        descricao || `Açaí Beleza — Pedido ${pedido_id || ''}`,
      payment_method_id:  'pix',
      payer: {
        email:           email || 'cliente@acaibeleza.com',
        first_name:      nome.split(' ')[0],
        last_name:       nome.split(' ').slice(1).join(' ') || 'Cliente',
        identification: {
          type:   'CPF',
          number: cpf || '00000000000',
        },
      },
    };

    const response = await axios.post(
      `${MP_BASE}/v1/payments`,
      payload,
      {
        headers: {
          ...mpHeaders,
          'X-Idempotency-Key': idempotencyKey,
        },
      }
    );

    const pix = response.data.point_of_interaction?.transaction_data;

    // Salva referência do pagamento no pedido
    if (pedido_id) {
      await fbRef(`pedidos/${pedido_id}`).update({
        mp_payment_id:  response.data.id,
        mp_status:      response.data.status,
        pix_copia_cola: pix?.qr_code || null,
      });
    }

    res.json({
      ok:            true,
      payment_id:    response.data.id,
      status:        response.data.status,
      qr_code_base64: pix?.qr_code_base64 || null,
      qr_code:       pix?.qr_code || null,       // copia e cola
      expiracao:     pix?.expiration_date || null,
    });

  } catch (err) {
    const mpError = err.response?.data;
    console.error('Erro MP:', mpError || err.message);
    res.status(err.response?.status || 500).json({
      error:   mpError?.message || err.message,
      detalhes: mpError || null,
    });
  }
});

// ─────────────────────────────────────────────
//  MERCADO PAGO — Consultar status do pagamento
// ─────────────────────────────────────────────
app.get('/pagamento/:payment_id/status', async (req, res) => {
  try {
    const response = await axios.get(
      `${MP_BASE}/v1/payments/${req.params.payment_id}`,
      { headers: mpHeaders }
    );

    const status = response.data.status; // approved | pending | rejected

    // Se aprovado, atualiza o pedido no Firebase
    if (status === 'approved' && req.query.pedido_id) {
      await fbRef(`pedidos/${req.query.pedido_id}`).update({
        status:          'pago',
        mp_status:       'approved',
        pagoEm:          new Date().toISOString(),
        pagoEmStr:       new Date().toLocaleString('pt-BR'),
      });
    }

    res.json({
      ok:         true,
      status,
      payment_id: response.data.id,
      valor:      response.data.transaction_amount,
    });

  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  MERCADO PAGO — Webhook (notificação automática)
// ─────────────────────────────────────────────
app.post('/webhook/mercadopago', async (req, res) => {
  // Responde 200 imediatamente (MP exige resposta rápida)
  res.sendStatus(200);

  try {
    const { type, data } = req.body;
    if (type !== 'payment' || !data?.id) return;

    // Busca detalhes do pagamento no MP
    const response = await axios.get(
      `${MP_BASE}/v1/payments/${data.id}`,
      { headers: mpHeaders }
    );

    const pagamento = response.data;
    if (pagamento.status !== 'approved') return;

    // Busca pedido pelo mp_payment_id no Firebase
    const snap = await fbRef('pedidos').once('value');
    const todos = snap.val() || {};
    const entry = Object.entries(todos).find(
      ([, v]) => String(v.mp_payment_id) === String(data.id)
    );

    if (entry) {
      const [pedidoId] = entry;
      await fbRef(`pedidos/${pedidoId}`).update({
        status:    'pago',
        mp_status: 'approved',
        pagoEm:    new Date().toISOString(),
        pagoEmStr: new Date().toLocaleString('pt-BR'),
      });
      console.log(`✅ Pedido ${pedidoId} marcado como PAGO via webhook`);
    }

  } catch (err) {
    console.error('Erro no webhook:', err.message);
  }
});

// ─────────────────────────────────────────────
//  RELATÓRIO — Vendas (ignora deletados/cancelados)
// ─────────────────────────────────────────────
app.get('/relatorio', authMiddleware, async (req, res) => {
  try {
    const snap = await fbRef('pedidos').once('value');
    const todos = snap.val() || {};

    const validos = Object.entries(todos)
      .map(([id, v]) => ({ id, ...v }))
      .filter(p => !['deletado', 'cancelado'].includes(p.status));

    const hoje = new Date().toLocaleDateString('pt-BR');

    const hojePed   = validos.filter(p => {
      try { return new Date(p.criadoEm).toLocaleDateString('pt-BR') === hoje; }
      catch { return false; }
    });

    const pagos     = validos.filter(p => p.status === 'pago');
    const faturamento = pagos.reduce((a, p) => a + Number(p.total || 0), 0);
    const hojeFat   = hojePed.filter(p => p.status === 'pago')
                              .reduce((a, p) => a + Number(p.total || 0), 0);

    // Ranking tamanhos
    const szCount = {};
    validos.forEach(p => {
      const k = `${p.tamanho}ml`;
      szCount[k] = (szCount[k] || 0) + 1;
    });

    res.json({
      ok: true,
      relatorio: {
        total_pedidos:    validos.length,
        pedidos_pagos:    pagos.length,
        pedidos_hoje:     hojePed.length,
        faturamento_total: faturamento,
        faturamento_hoje:  hojeFat,
        ranking_tamanhos:  Object.entries(szCount).sort((a, b) => b[1] - a[1]),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  INICIAR SERVIDOR
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Açaí Beleza Server rodando na porta ${PORT}`);
  console.log(`📡 Firebase: ${process.env.FIREBASE_DATABASE_URL}`);
  console.log(`💳 Mercado Pago: ${MP_TOKEN ? 'configurado' : '⚠️ token ausente'}`);
});
