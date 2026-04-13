// ============================================================
//  Açaí Beleza — Backend v3
//  Node.js + Express + Firebase Admin + Mercado Pago
// ============================================================

require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const admin   = require('firebase-admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
//  CORS MANUAL — antes de tudo
//  Sem usar o pacote cors para ter controle total
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,x-admin-token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200); // responde preflight imediatamente
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

// ─────────────────────────────────────────────
//  LOG DE TODA REQUISIÇÃO
//  Se não aparecer aqui, o problema é antes do servidor
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────
//  FIREBASE ADMIN — robusto para Render
//  O JSON no Render às vezes tem \n escapado no private_key
// ─────────────────────────────────────────────
let db = null;
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT não definida');

  // Render pode guardar com \n literal — corrige antes de parsear
  const cleaned = raw.replace(/\\n/g, '\n');
  const sa = JSON.parse(cleaned);

  const dbURL = process.env.FIREBASE_DATABASE_URL
    || `https://${sa.project_id}-default-rtdb.firebaseio.com`;

  admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: dbURL });
  db = admin.database();
  console.log('✅ Firebase conectado:', dbURL);
} catch (err) {
  console.error('⚠️  Firebase DESABILITADO:', err.message);
  console.error('    → pedidos serão aceitos mas NÃO salvos até corrigir a Service Account');
}

const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_BASE  = 'https://api.mercadopago.com';
const ADMIN_PW = process.env.ADMIN_PASS || 'acai2024';

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function fbRef(path) {
  if (!db) throw new Error('Firebase não inicializado — configure FIREBASE_SERVICE_ACCOUNT');
  return db.ref(path);
}

function mpHead(key = '') {
  return {
    Authorization:       `Bearer ${MP_TOKEN}`,
    'Content-Type':      'application/json',
    'X-Idempotency-Key': key,
  };
}

function adminOnly(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_PW)
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  next();
}

// ─────────────────────────────────────────────
//  HEALTH — GET /
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:      'online',
    service:     'Açaí Beleza Server v3',
    firebase:    db ? 'ok' : 'desabilitado',
    mercadopago: MP_TOKEN ? 'token presente' : 'SEM TOKEN',
    timestamp:   new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
//  DIAGNÓSTICO — GET /diagnostico (admin)
// ─────────────────────────────────────────────
app.get('/diagnostico', adminOnly, async (req, res) => {
  const out = { firebase: 'n/a', mercadopago: 'n/a' };

  // Firebase
  if (db) {
    try {
      await fbRef('_ping').set({ ts: Date.now() });
      out.firebase = 'ok — escrita funcionando';
    } catch (e) { out.firebase = 'erro: ' + e.message; }
  } else {
    out.firebase = 'desabilitado (verifique FIREBASE_SERVICE_ACCOUNT)';
  }

  // Mercado Pago
  if (MP_TOKEN) {
    try {
      const r = await axios.get(`${MP_BASE}/v1/payment_methods`, {
        headers: mpHead(), timeout: 8000,
      });
      out.mercadopago = r.status === 200 ? 'ok — API acessível' : 'status ' + r.status;
    } catch (e) {
      out.mercadopago = 'erro: ' + (e.response?.data?.message || e.message);
    }
  } else {
    out.mercadopago = 'sem token — configure MP_ACCESS_TOKEN';
  }

  res.json({ ok: true, ...out });
});

// ─────────────────────────────────────────────
//  MENU
// ─────────────────────────────────────────────
app.get('/menu', async (req, res) => {
  try {
    const snap = await fbRef('menu').once('value');
    res.json({ ok: true, menu: snap.val() });
  } catch (e) {
    console.error('GET /menu:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/menu', adminOnly, async (req, res) => {
  try {
    await fbRef('menu').set(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────
//  PEDIDOS
// ─────────────────────────────────────────────
app.get('/pedidos', adminOnly, async (req, res) => {
  try {
    const snap  = await fbRef('pedidos').once('value');
    const lista = Object.entries(snap.val() || {})
      .map(([id, v]) => ({ id, ...v }))
      .filter(p => p.status !== 'deletado')
      .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    res.json({ ok: true, pedidos: lista });
  } catch (e) {
    console.error('GET /pedidos:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/pedidos', async (req, res) => {
  try {
    const ref = await fbRef('pedidos').push({
      ...req.body,
      criadoEm:    new Date().toISOString(),
      criadoEmStr: new Date().toLocaleString('pt-BR'),
    });
    console.log('📦 Pedido criado:', ref.key, '—', req.body.nome);
    res.json({ ok: true, id: ref.key });
  } catch (e) {
    console.error('POST /pedidos:', e.message);
    // Retorna ok mesmo sem Firebase para não travar o fluxo de Pix
    res.json({ ok: true, id: null, aviso: 'Pedido não salvo no banco: ' + e.message });
  }
});

app.patch('/pedidos/:id', adminOnly, async (req, res) => {
  try {
    await fbRef(`pedidos/${req.params.id}`).update({ ...req.body, atualizadoEm: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/pedidos/:id', adminOnly, async (req, res) => {
  try {
    await fbRef(`pedidos/${req.params.id}`).update({ status: 'deletado', deletadoEm: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─────────────────────────────────────────────
//  CUPONS
// ─────────────────────────────────────────────
app.get('/cupons/:codigo', async (req, res) => {
  try {
    const snap  = await fbRef('cupons').once('value');
    const cod   = req.params.codigo.toUpperCase().trim();
    const found = Object.entries(snap.val() || {})
      .map(([id, v]) => ({ id, ...v }))
      .find(c => c.codigo?.toUpperCase() === cod && c.ativo === true);
    if (!found) return res.status(404).json({ ok: false, error: 'Cupom inválido ou inativo' });
    if (found.validade) {
      const exp = new Date(found.validade); exp.setHours(23, 59, 59);
      if (new Date() > exp) return res.status(400).json({ ok: false, error: 'Cupom expirado' });
    }
    res.json({ ok: true, cupom: { codigo: found.codigo, tipo: found.tipo, valor_desconto: found.valor_desconto, validade: found.validade || null } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/cupons', adminOnly, async (req, res) => {
  try {
    const snap = await fbRef('cupons').once('value');
    res.json({ ok: true, cupons: Object.entries(snap.val() || {}).map(([id, v]) => ({ id, ...v })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/cupons', adminOnly, async (req, res) => {
  try {
    const { codigo, valor_desconto, tipo, validade, ativo } = req.body;
    if (!codigo || !valor_desconto || !tipo) return res.status(400).json({ ok: false, error: 'codigo, valor_desconto e tipo são obrigatórios' });
    const ref = await fbRef('cupons').push({ codigo: codigo.toUpperCase().trim(), valor_desconto: Number(valor_desconto), tipo, validade: validade || null, ativo: ativo !== false, criadoEm: new Date().toISOString() });
    res.json({ ok: true, id: ref.key });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.patch('/cupons/:id', adminOnly, async (req, res) => {
  try { await fbRef(`cupons/${req.params.id}`).update(req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/cupons/:id', adminOnly, async (req, res) => {
  try { await fbRef(`cupons/${req.params.id}`).remove(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─────────────────────────────────────────────
//  PIX — gerar pagamento
// ─────────────────────────────────────────────
app.post('/pagamento/pix', async (req, res) => {
  const { total, nome, email, cpf, pedido_id, descricao } = req.body;
  console.log(`💳 PIX requisitado | valor: R$${total} | nome: ${nome} | cpf: ${cpf}`);

  // Validações básicas
  if (!total || !nome) {
    return res.status(400).json({ ok: false, error: 'total e nome são obrigatórios' });
  }
  if (!MP_TOKEN) {
    console.error('❌ MP_ACCESS_TOKEN não configurado no Render!');
    return res.status(500).json({ ok: false, error: 'Servidor sem token do Mercado Pago. Configure MP_ACCESS_TOKEN no Render.' });
  }

  const cpfLimpo = String(cpf || '').replace(/\D/g, '');
  if (cpfLimpo.length !== 11) {
    console.warn('⚠️  CPF inválido:', cpf);
    return res.status(400).json({ ok: false, error: `CPF inválido: precisa ter 11 dígitos (recebido: "${cpf}")` });
  }

  const valor = Math.round(Number(total) * 100) / 100;
  if (!valor || valor < 0.01) {
    return res.status(400).json({ ok: false, error: 'Valor inválido: ' + total });
  }

  const iKey = `acai-${pedido_id || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    transaction_amount: valor,
    description:        String(descricao || `Açaí Beleza — ${nome}`).slice(0, 255),
    payment_method_id:  'pix',
    payer: {
      email:      String(email || `${cpfLimpo}@acaibeleza.com`),
      first_name: nome.split(' ')[0],
      last_name:  nome.split(' ').slice(1).join(' ') || 'Cliente',
      identification: { type: 'CPF', number: cpfLimpo },
    },
  };

  console.log('📡 Enviando para Mercado Pago...', JSON.stringify({ valor, cpf: cpfLimpo, email: payload.payer.email }));

  try {
    const r = await axios.post(`${MP_BASE}/v1/payments`, payload, {
      headers: mpHead(iKey),
      timeout: 20000,
    });

    const pix = r.data.point_of_interaction?.transaction_data;
    console.log(`✅ PIX gerado | payment_id: ${r.data.id} | status: ${r.data.status} | tem_qr: ${!!pix?.qr_code}`);

    // Atualiza pedido no Firebase (sem bloquear resposta)
    if (pedido_id && db) {
      fbRef(`pedidos/${pedido_id}`).update({
        mp_payment_id:  r.data.id,
        mp_status:      r.data.status,
        pix_copia_cola: pix?.qr_code || null,
      }).catch(e => console.warn('Firebase update pedido:', e.message));
    }

    return res.json({
      ok:             true,
      payment_id:     r.data.id,
      status:         r.data.status,
      qr_code_base64: pix?.qr_code_base64 || null,
      qr_code:        pix?.qr_code || null,
      expiracao:      pix?.expiration_date || null,
    });

  } catch (err) {
    const status  = err.response?.status || 500;
    const mpErr   = err.response?.data;
    const mensagem = mpErr?.message || mpErr?.cause?.[0]?.description || err.message || 'Erro desconhecido';
    console.error(`❌ Erro Mercado Pago (${status}):`, JSON.stringify(mpErr || err.message));
    return res.status(status).json({
      ok:    false,
      error: mensagem,
      detalhes: mpErr || null,
    });
  }
});

// ─────────────────────────────────────────────
//  PIX — consultar status
// ─────────────────────────────────────────────
app.get('/pagamento/:pid/status', async (req, res) => {
  try {
    const r      = await axios.get(`${MP_BASE}/v1/payments/${req.params.pid}`, { headers: mpHead(), timeout: 8000 });
    const status = r.data.status;
    console.log(`🔍 Status ${req.params.pid}: ${status}`);
    if (status === 'approved' && req.query.pedido_id && db) {
      fbRef(`pedidos/${req.query.pedido_id}`).update({ status: 'pago', mp_status: 'approved', pagoEm: new Date().toISOString(), pagoEmStr: new Date().toLocaleString('pt-BR') })
        .catch(e => console.warn('Firebase pago:', e.message));
    }
    res.json({ ok: true, status, payment_id: r.data.id });
  } catch (e) {
    res.status(e.response?.status || 500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────
//  WEBHOOK Mercado Pago
// ─────────────────────────────────────────────
app.post('/webhook/mercadopago', async (req, res) => {
  res.sendStatus(200);
  try {
    const { type, data } = req.body;
    if (type !== 'payment' || !data?.id) return;
    const r = await axios.get(`${MP_BASE}/v1/payments/${data.id}`, { headers: mpHead(), timeout: 8000 });
    if (r.data.status !== 'approved') return;
    if (!db) return;
    const snap = await fbRef('pedidos').once('value');
    const entry = Object.entries(snap.val() || {}).find(([, v]) => String(v.mp_payment_id) === String(data.id));
    if (entry) {
      await fbRef(`pedidos/${entry[0]}`).update({ status: 'pago', mp_status: 'approved', pagoEm: new Date().toISOString(), pagoEmStr: new Date().toLocaleString('pt-BR') });
      console.log('✅ Webhook: pedido', entry[0], 'marcado PAGO');
    }
  } catch (e) { console.error('Webhook:', e.message); }
});

// ─────────────────────────────────────────────
//  RELATÓRIO
// ─────────────────────────────────────────────
app.get('/relatorio', adminOnly, async (req, res) => {
  try {
    const snap   = await fbRef('pedidos').once('value');
    const validos = Object.entries(snap.val() || {})
      .map(([id, v]) => ({ id, ...v }))
      .filter(p => !['deletado', 'cancelado'].includes(p.status));
    const pagos   = validos.filter(p => p.status === 'pago');
    const hoje    = new Date().toLocaleDateString('pt-BR');
    const hjPed   = validos.filter(p => { try { return new Date(p.criadoEm).toLocaleDateString('pt-BR') === hoje; } catch { return false; } });
    const szCount = {};
    validos.forEach(p => {
      const t = p.tamanho || p.itens?.[0]?.tamanho;
      if (t) { const k = t + 'ml'; szCount[k] = (szCount[k] || 0) + 1; }
    });
    res.json({ ok: true, relatorio: {
      total_pedidos:     validos.length,
      pedidos_pagos:     pagos.length,
      pedidos_hoje:      hjPed.length,
      faturamento_total: pagos.reduce((a, p) => a + Number(p.total || 0), 0),
      faturamento_hoje:  hjPed.filter(p => p.status === 'pago').reduce((a, p) => a + Number(p.total || 0), 0),
      ranking_tamanhos:  Object.entries(szCount).sort((a, b) => b[1] - a[1]),
    }});
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🚀 Açaí Beleza Server v3 — porta ${PORT}`);
  console.log(`🔥 Firebase:      ${db ? 'CONECTADO' : 'DESABILITADO'}`);
  console.log(`💳 Mercado Pago:  ${MP_TOKEN ? 'token OK (' + MP_TOKEN.slice(0,20) + '...)' : '⚠️  SEM TOKEN'}`);
  console.log(`🔑 Admin pass:    ${ADMIN_PW}`);
  console.log('='.repeat(50));
});

