const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════════

const LOGIN_BACKOFFICE = {
  email: 'juliana.verissimo@conexasaude.com.br',
  senha: '74b225df2JUJU*',
};

const EMAIL_ALERTA     = 'juliana.verissimo@conexasaude.com.br';
const PLANILHA_CSV     = 'https://docs.google.com/spreadsheets/d/1bDn7ShNSWvcE6_DIjPUs1swrM7aGuuEFz413tvrI3O8/gviz/tq?tqx=out:csv&gid=1809280439';
const BACKOFFICE_URL   = 'https://backoffice.conexasaude.com.br/usuario/profissionais';
const APPS_SCRIPT_URL  = 'https://script.google.com/a/macros/conexasaude.com.br/s/AKfycbzY_GdqVG7mlv0MPyZnlxXPcYo9yLsZReDU6TvBr1ecmQ5LWlL8DoXeVeWTN0pamgY/exec';
const PROFILE_DIR      = path.join(__dirname, 'chrome_profile'); // sessão salva aqui
const PROCESSADOS_FILE = path.join(__dirname, 'processados.json');
const LOG_FILE         = path.join(__dirname, 'log.txt');
const INTERVALO_MS     = 30 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════
//  COLUNAS DA ABA PAINEL (índice 0 = coluna A)
// ═══════════════════════════════════════════════════════════════════
const COL = {
  NOME:       2,   // C
  EMAIL:      4,   // E
  TIPO:       7,   // H
  DESCRICAO:  8,   // I
  DATA:       9,   // J
  HORA_INI:   10,  // K
  HORA_FIM:   11,  // L
  REPOSICAO:  12,  // M
  STATUS:     13,  // N
  ANALISTA:   14,  // O
  DATA_EXEC:  16,  // Q
  HORA_EXEC:  17,  // R
  AGENTE:     18,  // S
  OBSERVACAO: 19,  // T
};

// ═══════════════════════════════════════════════════════════════════
//  LOG
// ═══════════════════════════════════════════════════════════════════
const ok    = (m) => { console.log(`\x1b[32m✓ ${m}\x1b[0m`);  gravar(`OK    | ${m}`); };
const err   = (m) => { console.log(`\x1b[31m✗ ${m}\x1b[0m`);  gravar(`ERRO  | ${m}`); };
const inf   = (m) => { console.log(`\x1b[36mℹ ${m}\x1b[0m`);  gravar(`INFO  | ${m}`); };
const aviso = (m) => { console.log(`\x1b[33m⚠ ${m}\x1b[0m`);  gravar(`AVISO | ${m}`); };
const sep   = ()  =>   console.log('\x1b[90m─────────────────────────────────────────\x1b[0m');

function gravar(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${agoraFormatado()}] ${msg}\n`); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
//  DATA/HORA (Brasília)
// ═══════════════════════════════════════════════════════════════════
function agora() {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() - 180) * -60000);
}
function agoraFormatado() { return agora().toLocaleString('pt-BR'); }
function agoraData()      { return agora().toLocaleDateString('pt-BR'); }
function agoraHorario()   { return agora().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

// ═══════════════════════════════════════════════════════════════════
//  PROCESSADOS
// ═══════════════════════════════════════════════════════════════════
function carregarProcessados() {
  try { if (fs.existsSync(PROCESSADOS_FILE)) return JSON.parse(fs.readFileSync(PROCESSADOS_FILE, 'utf8')); }
  catch {}
  return {};
}
function salvarProcessado(chave, dados) {
  const p = carregarProcessados();
  p[chave] = { ...dados, executadoEm: agoraFormatado() };
  fs.writeFileSync(PROCESSADOS_FILE, JSON.stringify(p, null, 2));
}

// ═══════════════════════════════════════════════════════════════════
//  NAVEGADOR — perfil persistente (sessão Google salva entre execuções)
// ═══════════════════════════════════════════════════════════════════
let _ctx  = null;
let _page = null; // aba de fundo (planilha + Apps Script)

async function garantirNavegador() {
  if (_ctx) return;
  inf('Abrindo Chrome com perfil salvo...');
  _ctx  = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--no-sandbox'],
  });
  _page = await _ctx.newPage();
  ok('Chrome pronto');
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE CSV
// ═══════════════════════════════════════════════════════════════════
function parseCSV(texto) {
  const linhas = [];
  let dentro = false, campo = '', linha = [];
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') { dentro = !dentro; }
    else if (c === ',' && !dentro) { linha.push(campo.trim()); campo = ''; }
    else if ((c === '\n' || c === '\r') && !dentro) {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo.trim()); linhas.push(linha); linha = []; campo = '';
    } else { campo += c; }
  }
  if (campo || linha.length) { linha.push(campo.trim()); linhas.push(linha); }
  return linhas;
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE DESCRIÇÃO (extrai datas/horas do texto livre)
// ═══════════════════════════════════════════════════════════════════
function parsearDescricao(texto) {
  if (!texto) return null;
  const regex = /(\d{2}\/\d{2}\/\d{4})\s+(?:das?|de)\s+(\d{2}:\d{2})\s+(?:às?|a)\s+(\d{2}:\d{2})/gi;
  const matches = [...texto.matchAll(regex)];
  if (!matches.length) return null;
  const b = matches[0], r = matches[1] || null;
  return {
    data_ini: b[1], hora_ini: b[2], data_fim: b[1], hora_fim: b[3],
    rep_data: r ? r[1] : null, rep_hora_ini: r ? r[2] : null, rep_hora_fim: r ? r[3] : null,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  PROCESSA CSV E RETORNA PENDENTES
// ═══════════════════════════════════════════════════════════════════
function _processarCSV(csv) {
  const linhas = parseCSV(csv);
  if (linhas.length < 2) { aviso('Planilha sem dados'); return []; }

  const processados  = carregarProcessados();
  const pendentes    = [];
  const tiposValidos = [
    'fechamento de agenda com reposição',
    'fechamento de agenda sem reposição',
    'abertura de horário extra',
  ];

  for (let i = 1; i < linhas.length; i++) {
    const row = linhas[i];
    if (!row || row.length < 10) continue;
    const status = (row[COL.STATUS] || '').trim();
    if (status !== '' && status !== '~') continue;
    const tipo  = (row[COL.TIPO]  || '').trim();
    const email = (row[COL.EMAIL] || '').trim().toLowerCase();
    if (!tiposValidos.some(t => tipo.toLowerCase().includes(t))) continue;
    if (!email) continue;
    const data  = (row[COL.DATA] || '').trim();
    const chave = `${email}_${data}_${tipo}`.replace(/\s+/g, '_').toLowerCase();
    if (processados[chave]) continue;
    pendentes.push({ rowIndex: i, row, chave, email,
      nome: (row[COL.NOME] || '').trim(), tipo,
      desc: (row[COL.DESCRICAO] || '').trim(), data });
  }

  pendentes.sort((a, b) => {
    const td = s => { if (!s) return 0; const [d,m,y] = s.split('/'); return new Date(`${y}-${m}-${d}`); };
    return td(a.data) - td(b.data);
  });

  ok(`${pendentes.length} solicitação(ões) pendente(s)`);
  return pendentes;
}

// ═══════════════════════════════════════════════════════════════════
//  LÊ PLANILHA via Chrome autenticado (navega para URL CSV)
// ═══════════════════════════════════════════════════════════════════
async function lerPendentes() {
  inf('Verificando planilha (aba PAINEL)...');
  await garantirNavegador();

  try {
    // Navega para o Apps Script URL — Chrome autenticado como Trabalho acessa diretamente
    await _page.goto(APPS_SCRIPT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await _page.waitForTimeout(1500);

    const corpo = await _page.locator('body').innerText({ timeout: 10000 });

    if (!corpo || corpo.startsWith('<')) {
      err('Apps Script retornou HTML — verifique se o Chrome está logado');
      return [];
    }

    let dados;
    try { dados = JSON.parse(corpo); }
    catch { err('Resposta inválida: ' + corpo.substring(0, 100)); return []; }

    if (!dados.ok) { err('Apps Script: ' + dados.msg); return []; }

    const processados = carregarProcessados();
    const pendentes   = (dados.pendentes || []).filter(sol => {
      const chave = `${sol.email}_${sol.data}_${sol.tipo}`.replace(/\s+/g, '_').toLowerCase();
      if (processados[chave]) return false;
      sol.chave    = chave;
      sol.rowIndex = sol.row;
      sol.row      = sol; // compatibilidade com executarAbertura
      return true;
    });

    pendentes.sort((a, b) => {
      const td = s => { if (!s) return 0; const [d,m,y] = (s||'').split('/'); return new Date(`${y}-${m}-${d}`); };
      return td(a.data) - td(b.data);
    });

    ok(`${pendentes.length} solicitação(ões) pendente(s)`);
    return pendentes;

  } catch(e) {
    err('Erro ao ler planilha: ' + e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ESCREVE NA PLANILHA via Apps Script (navegação autenticada)
// ═══════════════════════════════════════════════════════════════════
async function atualizarPlanilha(rowNum, colunas) {
  try {
    // Navega para o Apps Script com os dados como query param
    const params = encodeURIComponent(JSON.stringify({ row: rowNum, colunas }));
    const url = `${APPS_SCRIPT_URL}?dados=${params}`;
    await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await _page.waitForTimeout(1000);
    const resp = await _page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const r = JSON.parse(resp);
    if (r.ok) { ok(`Planilha atualizada: linha ${rowNum}`); return true; }
    err('Apps Script: ' + r.msg);
  } catch(e) {
    err('Erro ao atualizar planilha: ' + e.message);
  }
  return false;
}

async function registrarSucesso(rowNum, sol) {
  await atualizarPlanilha(rowNum, {
    [COL.STATUS]:    'Aprovado',
    [COL.ANALISTA]:  'AGENTE DE IA',
    [COL.DATA_EXEC]: agoraData(),
    [COL.HORA_EXEC]: agoraHorario(),
    [COL.AGENTE]:    'REALIZADO',
  });
}

async function registrarFalha(rowNum, sol, motivo, detalhe = '') {
  await atualizarPlanilha(rowNum, {
    [COL.AGENTE]:     `NÃO REALIZADO - ${motivo}`,
    [COL.OBSERVACAO]: detalhe || motivo,
  });
  // Envia e-mail de alerta via Apps Script
  try {
    const emailParams = encodeURIComponent(JSON.stringify({
      acao: 'email', para: EMAIL_ALERTA,
      assunto: `[AGENTE IA] NÃO REALIZADO — ${sol.nome || sol.email}`,
      mensagem: `Médico: ${sol.nome || '-'}\nE-mail: ${sol.email}\nTipo: ${sol.tipo}\nMotivo: ${motivo}\nDetalhe: ${detalhe}\nHorário: ${agoraFormatado()}`,
    }));
    await _page.goto(`${APPS_SCRIPT_URL}?dados=${emailParams}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════
//  LOGIN NO BACKOFFICE
// ═══════════════════════════════════════════════════════════════════
async function abrirBackoffice() {
  const page = await _ctx.newPage();
  inf('Abrindo Backoffice...');
  await page.goto('https://backoffice.conexasaude.com.br', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Faz login se necessário
  const ehLogin = page.url().includes('login') || page.url().includes('auth') ||
    await page.locator('input[type="email"]').isVisible().catch(() => false);

  if (ehLogin) {
    inf('Fazendo login no Backoffice...');
    await page.locator('input[type="email"], input[name*="email"]').first().fill(LOGIN_BACKOFFICE.email);
    await page.waitForTimeout(400);
    await page.locator('input[type="password"]').first().fill(LOGIN_BACKOFFICE.senha);
    await page.waitForTimeout(400);
    await page.locator('button[type="submit"], button:has-text("Entrar")').first().click();
    await page.waitForTimeout(3000);
    ok('Login realizado');
  }

  // Navega pelo menu lateral: clica em "Profissionais" (item do menu)
  inf('Clicando em Profissionais no menu...');
  await page.locator('nav a:has-text("Profissionais"), li:has-text("Profissionais")').first().click();
  await page.waitForTimeout(1000);

  // Clica no submenu "Profissionais" (segundo clique)
  const submenu = page.locator('a:has-text("Profissionais"), li:has-text("Profissionais")');
  const count = await submenu.count();
  if (count > 1) {
    await submenu.nth(1).click();
  }
  await page.waitForTimeout(2000);

  ok('Tela de Profissionais aberta');
  return page;
}

// ═══════════════════════════════════════════════════════════════════
//  BUSCA PROFISSIONAL POR E-MAIL
// ═══════════════════════════════════════════════════════════════════
async function buscarProfissional(page, email) {
  inf(`Buscando: ${email}`);

  // Aguarda qualquer campo de texto aparecer na tela
  await page.waitForTimeout(1500);

  // Tenta encontrar o campo de busca/nome
  const seletores = [
    'input[placeholder*="Escreva"]',
    'input[placeholder*="ome"]',
    'input[placeholder*="uscar"]',
    'input[placeholder*="mail"]',
    'input[placeholder*="rofissional"]',
    'input[type="search"]',
    'input[type="text"]',
  ];

  let campo = null;
  for (const sel of seletores) {
    const el = page.locator(sel).first();
    const visivel = await el.isVisible().catch(() => false);
    if (visivel) { campo = el; inf(`Campo de busca: ${sel}`); break; }
  }

  if (!campo) throw new Error('Campo de busca não encontrado na tela de Profissionais');

  await campo.clear();
  await campo.fill(email);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);

  const ativos = await page.locator('text=Ativo').count();
  if (ativos === 0) return 'nao_encontrado';
  if (ativos > 1)   return 'multiplos_ativos';
  return 'ok';
}

// ═══════════════════════════════════════════════════════════════════
//  FLUXO A — FECHAMENTO (com e sem reposição)
// ═══════════════════════════════════════════════════════════════════
async function executarFechamento(page, sol, comReposicao) {
  const dados = parsearDescricao(sol.desc);
  if (!dados) throw new Error(`Não foi possível extrair datas: "${sol.desc}"`);

  inf('Abrindo menu ⋮...');
  const linhaAtiva = page.locator('tr').filter({ hasText: 'Ativo' }).last();
  await linhaAtiva.locator('button').last().click();
  await page.waitForTimeout(800);

  await page.locator('[role="menuitem"]:has-text("Agenda"), li:has-text("Agenda"), a:has-text("Agenda")').last().click();
  await page.waitForTimeout(2000);

  await page.locator('text=Ausências').click();
  await page.waitForTimeout(1500);

  await page.locator('input[placeholder*="motivo"], input[placeholder*="evento"]').first().fill('FORMS');

  const camposData = await page.locator('input[placeholder*="DD/MM"], input[placeholder*="dd/mm"], input[type="date"]').all();
  if (camposData[0]) { await camposData[0].fill(dados.data_ini); await page.keyboard.press('Tab'); }

  const camposHora = await page.locator('input[placeholder*="HH:MM"], input[placeholder*="hh:mm"]').all();
  if (camposHora[0]) await camposHora[0].fill(dados.hora_ini);
  if (camposData[1]) { await camposData[1].fill(dados.data_fim); await page.keyboard.press('Tab'); }
  if (camposHora[1]) await camposHora[1].fill(dados.hora_fim);

  await page.locator('label:has-text("Reagendar"), input[type="radio"] + label:has-text("Reagendar")').first().click().catch(() => {});

  if (comReposicao && dados.rep_data) {
    await page.locator('button:has-text("Adicionar período"), button:has-text("Adicionar")').first().click();
    await page.waitForTimeout(1000);
    const repData = await page.locator('input[placeholder*="DD/MM"], input[placeholder*="dd/mm"]').all();
    if (repData[repData.length - 1]) { await repData[repData.length - 1].fill(dados.rep_data); await page.keyboard.press('Tab'); }
    const repHora = await page.locator('input[placeholder*="HH:MM"], input[placeholder*="hh:mm"]').all();
    if (repHora[repHora.length - 2]) await repHora[repHora.length - 2].fill(dados.rep_hora_ini);
    if (repHora[repHora.length - 1]) await repHora[repHora.length - 1].fill(dados.rep_hora_fim);
    ok(`Reposição: ${dados.rep_data} ${dados.rep_hora_ini}–${dados.rep_hora_fim}`);
  }

  await page.waitForTimeout(500);
  await page.locator('button:has-text("Programar")').click();
  await page.waitForTimeout(3000);
  ok(`Fechamento programado — ${sol.nome || sol.email}`);
}

// ═══════════════════════════════════════════════════════════════════
//  FLUXO B — ABERTURA DE HORÁRIO EXTRA
// ═══════════════════════════════════════════════════════════════════
async function executarAbertura(page, sol) {
  const data     = (sol.row[COL.DATA]     || '').trim();
  const hora_ini = (sol.row[COL.HORA_INI] || '').trim();
  const hora_fim = (sol.row[COL.HORA_FIM] || '').trim();
  if (!data) throw new Error('Data não encontrada na planilha');

  const linhaAtiva = page.locator('tr').filter({ hasText: 'Ativo' }).last();
  await linhaAtiva.locator('button').last().click();
  await page.waitForTimeout(800);
  await page.locator('[role="menuitem"]:has-text("Agenda"), li:has-text("Agenda")').last().click();
  await page.waitForTimeout(2000);
  await page.locator('text=Horário adicional').click();
  await page.waitForTimeout(1500);

  const matchDur = (sol.desc || '').match(/(\d+)\s*min/i);
  const duracao  = matchDur ? matchDur[1] : '20';
  await page.locator('select, [role="combobox"]').first().selectOption({ label: `${duracao} minutos` }).catch(
    () => page.locator('select').first().selectOption(duracao).catch(() => {})
  );

  const inputsHora = await page.locator('input[placeholder*="hh:mm"], input[placeholder*="00:00"]').all();
  if (inputsHora[0]) await inputsHora[0].fill('00:00');

  await page.locator('input[placeholder*="DD/MM"], input[type="date"]').first().fill(data);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);

  const horaInputs = await page.locator('input[placeholder*="hh:mm"], input[placeholder*="HH:MM"]').all();
  if (horaInputs[1]) await horaInputs[1].fill(hora_ini);
  if (horaInputs[2]) await horaInputs[2].fill(hora_fim);

  await page.waitForTimeout(500);
  await page.locator('button:has-text("Programar")').click();
  await page.waitForTimeout(3000);
  ok(`Abertura programada — ${sol.nome || sol.email}`);
}

// ═══════════════════════════════════════════════════════════════════
//  PROCESSA UMA SOLICITAÇÃO
// ═══════════════════════════════════════════════════════════════════
async function processarSolicitacao(sol) {
  sep();
  inf(`PROCESSANDO: ${sol.nome || sol.email}`);
  inf(`Tipo  : ${sol.tipo}`);
  inf(`Linha : ${sol.rowIndex + 1}`);
  sep();

  let page;
  try {
    page = await abrirBackoffice();
    const resultado = await buscarProfissional(page, sol.email);

    if (resultado === 'nao_encontrado') {
      await page.close();
      await registrarFalha(sol.rowIndex + 1, sol, 'Médico não encontrado', `E-mail: ${sol.email}`);
      return false;
    }
    if (resultado === 'multiplos_ativos') {
      await page.close();
      await registrarFalha(sol.rowIndex + 1, sol, '2 perfis ativos', 'Verificar manualmente');
      return false;
    }

    ok('1 perfil ativo');
    const tipo = sol.tipo.toLowerCase();

    if (tipo.includes('fechamento') && !tipo.includes('sem reposição')) {
      await executarFechamento(page, sol, true);
    } else if (tipo.includes('fechamento') && tipo.includes('sem reposição')) {
      await executarFechamento(page, sol, false);
    } else if (tipo.includes('abertura')) {
      await executarAbertura(page, sol);
    } else {
      await page.close();
      await registrarFalha(sol.rowIndex + 1, sol, 'Tipo não reconhecido', sol.tipo);
      return false;
    }

    await page.waitForTimeout(2000);
    await page.close();
    await registrarSucesso(sol.rowIndex + 1, sol);
    salvarProcessado(sol.chave, { nome: sol.nome, email: sol.email, tipo: sol.tipo, data: sol.data });
    return true;

  } catch(e) {
    err(`Erro: ${e.message}`);
    if (page) await page.close().catch(() => {});
    await registrarFalha(sol.rowIndex + 1, sol, 'Erro técnico', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CICLO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════
async function ciclo() {
  inf(`[${agoraFormatado()}] Iniciando ciclo de verificação...`);
  let pendentes;
  try { pendentes = await lerPendentes(); }
  catch(e) { err('Erro ao ler planilha: ' + e.message); return; }

  for (const sol of pendentes) {
    const ok_ = await processarSolicitacao(sol);
    if (ok_) ok(`Linha ${sol.rowIndex + 1} processada.`);
    else aviso(`Linha ${sol.rowIndex + 1} não processada — time notificado.`);
    await new Promise(r => setTimeout(r, 3000));
  }
  inf('Próxima verificação em 30 minutos.');
}

// ═══════════════════════════════════════════════════════════════════
//  INÍCIO
// ═══════════════════════════════════════════════════════════════════
async function iniciar() {
  console.log('\x1b[35m');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   AGENTE DE IA — AUTOMAÇÃO AGENDA CONEXA         ║');
  console.log('║   Polling: 30 min  |  Sem restrição de horário   ║');
  console.log('║   Fluxos: Fechamento (c/s reposição) + Abertura  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\x1b[0m');
  inf('Monitorando... pressione Ctrl+C para parar.');
  gravar('=== AGENTE INICIADO ===');
  sep();
  await garantirNavegador();
  await ciclo();
  setInterval(ciclo, INTERVALO_MS);
}

iniciar();
