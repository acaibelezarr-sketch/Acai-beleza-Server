// ============================================================
//  Açaí Beleza — Servidor Backend v2
//  Node.js + Express + Firebase Admin + Mercado Pago
// ============================================================

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const admin   = require('firebase-admin');

// ─────────────────────────────────────────────
//  FIREBASE ADMIN
// ─────────────────────────────────────────────
let db;
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT não definida');
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({
    credential:  admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  db = admin.database();
  console.log('✅ Firebase Admin conectado');
} catch (err) {
  console.error('❌ Erro Firebase:', err.message);
  // NÃO faz process.exit — deixa o servidor subir para diagnóstico
  db = null;
}

// ─────────────────────────────────────────────
//  MERCADO PAGO
// ─────────────────────────────────────────────
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_BASE  = 'https://api.mercadopago.com';

function mpHeaders(idempotencyKey = '') {
  return {
    Authorization:        `Bearer ${MP_TOKEN}`,
    'Content-Type':       'application/json',
    'X-Idempotency-Key':  idempotencyKey,
  };
}

// ─────────────────────────────────────────────
//  EXPRESS — CORS EXPLÍCITO
// ─────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// CORS: aceita qualquer origem (site estático no Netlify/GitHub Pages/etc)
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','x-admin-token'],
}));
app.options('*', cors()); // responde preflight de qualquer rota
app.use(express.json({ limit: '2mb' }));

// ─────────────────────────────────────────────
//  MIDDLEWARE ADMIN
// ─────────────────────────────────────────────
function auth(req, res, next) {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_PASS) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }
  next();
}

// ─────────────────────────────────────────────
//  FIREBASE HELPER
// ─────────────────────────────────────────────
function fbRef(path) {
  if (!db) throw new Error('Firebase não inicializado');
  return db.ref(path);
}

// ─────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:    'online',
    service:   'Açaí Beleza Server',
    firebase:  db ? 'ok' : 'erro',
    mercadopago: MP_TOKEN ? 'configurado' : 'token ausente',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
//  DIAGNÓSTICO — testa MP e Firebase ao vivo
// ─────────────────────────────────────────────
app.get('/diagnostico', auth, async (req, res) => {
  const result = { firebase: 'pendente', mercadopago: 'pendente' };

  // Testa Firebase
  try {
    await fbRef('_ping').set({ ts: Date.now() });
    result.firebase = 'ok';
  } catch (e) {
    result.firebase = 'erro: ' + e.message;
  }

  // Testa Mercado Pago (busca métodos de pagamento)
  try {
    const r = await axios.get(`${MP_BASE}/v1/payment_methods`, {
      headers: mpHeaders(),
      timeout: 8000,
    });
    result.mercadopago = r.status === 200 ? 'ok' : 'status ' + r.status;
  } catch (e) {
    result.mercadopago = 'erro: ' + (e.response?.data?.message || e.message);
  }

  res.json({ ok: true, ...result });
});

// ─────────────────────────────────────────────
//  PEDIDOS — CRUD
// ─────────────────────────────────────────────
app.get('/pedidos', auth, async (req, res) => {
  try {
    const snap = await fbRef('pedidos').once('value');
    const data = snap.val() || {};
    const lista = Object.entries(data)
      .map(([id, v]) => ({ id, ...v }))
      .filter(p => p.status !== 'deletado')
      .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    res.json({ ok: true, pedidos: lista });
  } catch (e) {
    console.error('GET /pedidos', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/pedidos/:id', auth, async (req, res) => {
  try {
    const snap = await fbRef(`pedidos/${req.params.id}`).once('value');
    if (!snap.exists()) return res.status(404).json({ ok: false, error: 'Não encontrado' });
    res.json({ ok: true, pedido: { id: req.params.id, ...snap.val() } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/pedidos', async (req, res) => {
  try {
    const pedido = {
      ...req.body,
      status:      req.body.status || 'novo',
      criadoEm:    new Date().toISOString(),
      criadoEmStr: new Date().toLocaleString('pt-BR'),
    };
    const ref = await fbRef('pedidos').push(pedido);
    console.log('📦 Novo pedido:', ref.key, pedido.nome);
    res.json({ ok: true, id: ref.key });
  } catch (e) {
    console.error('POST /pedidos', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/pedidos/:id', auth, async (req, res) => {
  try {
    await fbRef(`pedidos/${req.params.id}`).update({
      ...req.body,
      atualizadoEm: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/pedidos/:id', auth, async (req, res) => {
  try {
    await fbRef(`pedidos/${req.params.id}`).update({
      status:     'deletado',
      deletadoEm: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────
//  MENU
// ─────────────────────────────────────────────
app.get('/menu', async (req, res) => {
  try {
    const snap = await fbRef('menu').once('value');
    res.json({ ok: true, menu: snap.val() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/menu', auth, async (req, res) => {
  try {
    await fbRef('menu').set(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────
//  CUPONS
// ─────────────────────────────────────────────
app.get('/cupons', auth, async (req, res) => {
  try {
    const snap = await fbRef('cupons').once('value');
    const data = snap.val() || {};
    res.json({ ok: true, cupons: Object.entries(data).map(([id,v])=>({id,...v})) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/cupons/:codigo', async (req, res) => {
  try {
    const snap  = await fbRef('cupons').once('value');
    const todos = snap.val() || {};
    const cod   = req.params.codigo.toUpperCase().trim();
    const found = Object.entries(todos)
      .map(([id,v])=>({id,...v}))
      .find(c => c.codigo?.toUpperCase() === cod && c.ativo === true);

    if (!found) return res.status(404).json({ ok: false, error: 'Cupom inválido ou inativo' });

    if (found.validade) {
      const exp = new Date(found.validade);
      exp.setHours(23,59,59);
      if (new Date() > exp) return res.status(400).json({ ok: false, error: 'Cupom expirado' });
    }

    res.json({ ok: true, cupom: { codigo: found.codigo, tipo: found.tipo, valor_desconto: found.valor_desconto, validade: found.validade || null } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/cupons', auth, async (req, res) => {
  try {
    const { codigo, valor_desconto, tipo, validade, ativo } = req.body;
    if (!codigo || !valor_desconto || !tipo) return res.status(400).json({ ok: false, error: 'Campos obrigatórios: codigo, valor_desconto, tipo' });
    const ref = await fbRef('cupons').push({
      codigo: codigo.toUpperCase().trim(),
      valor_desconto: Number(valor_desconto),
      tipo, validade: validade || null,
      ativo: ativo !== false,
      criadoEm: new Date().toISOString(),
    });
    res.json({ ok: true, id: ref.key });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/cupons/:id', auth, async (req, res) => {
  try {
    await fbRef(`cupons/${req.params.id}`).update(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/cupons/:id', auth, async (req, res) => {
  try {
    await fbRef(`cupons/${req.params.id}`).remove();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────
//  PIX — GERAR PAGAMENTO
// ─────────────────────────────────────────────
app.post('/pagamento/pix', async (req, res) => {
  const { total, nome, email, cpf, pedido_id, descricao } = req.body;

  console.log(`💳 PIX solicitado — R$ ${total} — ${nome} — CPF: ${cpf}`);

  if (!total || !nome || !cpf) {
    return res.status(400).json({ ok: false, error: 'Campos obrigatórios: total, nome, cpf' });
  }
  if (!MP_TOKEN) {
    console.error('❌ MP_ACCESS_TOKEN não configurado');
    return res.status(500).json({ ok: false, error: 'Token do Mercado Pago não configurado no servidor' });
  }

  // Valida CPF (só dígitos, 11 chars)
  const cpfLimpo = String(cpf).replace(/\D/g, '');
  if (cpfLimpo.length !== 11) {
    return res.status(400).json({ ok: false, error: `CPF inválido: "${cpf}" — deve ter 11 dígitos` });
  }

  const valorFinal = Number(Number(total).toFixed(2));
  if (valorFinal < 0.01) {
    return res.status(400).json({ ok: false, error: 'Valor inválido' });
  }

  const idempotencyKey = `acai-${pedido_id || Date.now()}-${Math.random().toString(36).slice(2,8)}`;

  const payload = {
    transaction_amount: valorFinal,
    description:        descricao || `Açaí Beleza — ${nome}`,
    payment_method_id:  'pix',
    payer: {
      email:      email || `${cpfLimpo}@acaibeleza.com`,
      first_name: nome.split(' ')[0],
      last_name:  nome.split(' ').slice(1).join(' ') || 'Cliente',
      identification: { type: 'CPF', number: cpfLimpo },
    },
  };

  try {
    console.log('📡 Chamando API Mercado Pago...');
    const response = await axios.post(`${MP_BASE}/v1/payments`, payload, {
      headers: mpHeaders(idempotencyKey),
      timeout: 15000,
    });

    const pix = response.data.point_of_interaction?.transaction_data;
    console.log(`✅ PIX gerado — payment_id: ${response.data.id} — status: ${response.data.status}`);

    // Atualiza pedido no Firebase com referência do pagamento
    if (pedido_id && db) {
      await fbRef(`pedidos/${pedido_id}`).update({
        mp_payment_id:  response.data.id,
        mp_status:      response.data.status,
        pix_copia_cola: pix?.qr_code || null,
      }).catch(e => console.warn('Erro ao atualizar pedido com mp_id:', e.message));
    }

    res.json({
      ok:              true,
      payment_id:      response.data.id,
      status:          response.data.status,
      qr_code_base64:  pix?.qr_code_base64 || null,
      qr_code:         pix?.qr_code || null,
      expiracao:       pix?.expiration_date || null,
    });

  } catch (err) {
    const mpErr = err.response?.data;
    const status = err.response?.status || 500;
    console.error(`❌ Erro MP (${status}):`, JSON.stringify(mpErr || err.message));
    res.status(status).json({
      ok:       false,
      error:    mpErr?.message || mpErr?.cause?.[0]?.description || err.message,
      mp_error: mpErr || null,
    });
  }
});

// ─────────────────────────────────────────────
//  PIX — CONSULTAR STATUS
// ─────────────────────────────────────────────
app.get('/pagamento/:payment_id/status', async (req, res) => {
  try {
    const r = await axios.get(`${MP_BASE}/v1/payments/${req.params.payment_id}`, {
      headers: mpHeaders(),
      timeout: 8000,
    });

    const status = r.data.status;
    console.log(`🔍 Status payment ${req.params.payment_id}: ${status}`);

    // Se aprovado, atualiza Firebase
    if (status === 'approved' && req.query.pedido_id && db) {
      await fbRef(`pedidos/${req.query.pedido_id}`).update({
        status:    'pago',
        mp_status: 'approved',
        pagoEm:    new Date().toISOString(),
        pagoEmStr: new Date().toLocaleString('pt-BR'),
      }).catch(e => console.warn('Erro ao marcar pago:', e.message));
    }

    res.json({ ok: true, status, payment_id: r.data.id, valor: r.data.transaction_amount });
  } catch (e) {
    const s = e.response?.status || 500;
    console.error('Erro status MP:', e.message);
    res.status(s).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────
//  WEBHOOK — Mercado Pago
// ─────────────────────────────────────────────
app.post('/webhook/mercadopago', async (req, res) => {
  res.sendStatus(200); // responde rápido
  try {
    const { type, data } = req.body;
    if (type !== 'payment' || !data?.id) return;
    const r = await axios.get(`${MP_BASE}/v1/payments/${data.id}`, { headers: mpHeaders(), timeout: 8000 });
    if (r.data.status !== 'approved') return;
    const snap = await fbRef('pedidos').once('value');
    const todos = snap.val() || {};
    const entry = Object.entries(todos).find(([,v]) => String(v.mp_payment_id) === String(data.id));
    if (entry) {
      const [id] = entry;
      await fbRef(`pedidos/${id}`).update({ status:'pago', mp_status:'approved', pagoEm: new Date().toISOString(), pagoEmStr: new Date().toLocaleString('pt-BR') });
      console.log(`✅ Webhook: pedido ${id} marcado como PAGO`);
    }
  } catch (e) {
    console.error('Webhook erro:', e.message);
  }
});

// ─────────────────────────────────────────────
//  RELATÓRIO
// ─────────────────────────────────────────────
app.get('/relatorio', auth, async (req, res) => {
  try {
    const snap  = await fbRef('pedidos').once('value');
    const todos = snap.val() || {};
    const validos = Object.entries(todos)
      .map(([id,v])=>({id,...v}))
      .filter(p=>!['deletado','cancelado'].includes(p.status));
    const pagos   = validos.filter(p=>p.status==='pago');
    const hoje    = new Date().toLocaleDateString('pt-BR');
    const hjPed   = validos.filter(p=>{try{return new Date(p.criadoEm).toLocaleDateString('pt-BR')===hoje}catch{return false}});
    const hjFat   = hjPed.filter(p=>p.status==='pago').reduce((a,p)=>a+Number(p.total||0),0);
    const szCount = {};
    validos.forEach(p=>{const k=`${p.tamanho||((p.itens?.[0]?.tamanho)||'?')}ml`;szCount[k]=(szCount[k]||0)+1;});
    res.json({ ok: true, relatorio: {
      total_pedidos:     validos.length,
      pedidos_pagos:     pagos.length,
      pedidos_hoje:      hjPed.length,
      faturamento_total: pagos.reduce((a,p)=>a+Number(p.total||0),0),
      faturamento_hoje:  hjFat,
      ranking_tamanhos:  Object.entries(szCount).sort((a,b)=>b[1]-a[1]),
    }});
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Açaí Beleza Server — porta ${PORT}`);
  console.log(`🔥 Firebase: ${db ? 'OK' : 'ERRO'}`);
  console.log(`💳 Mercado Pago: ${MP_TOKEN ? 'token configurado' : '⚠️ SEM TOKEN'}`);
});
