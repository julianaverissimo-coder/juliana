const { chromium } = require('playwright');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════════

const LOGIN = {
  email: 'juliana.verissimo@conexasaude.com.br',
  senha: '74b225df2JUJU*',
};

const EMAIL_ALERTA    = 'juliana.verissimo@conexasaude.com.br';
const PLANILHA_CSV    = 'https://docs.google.com/spreadsheets/d/1bDn7ShNSWvcE6_DIjPUs1swrM7aGuuEFz413tvrI3O8/gviz/tq?tqx=out:csv&gid=1809280439';
const BACKOFFICE_URL  = 'https://backoffice.conexasaude.com.br/usuario/profissionais';
const PROCESSADOS_FILE = path.join(__dirname, 'processados.json');
const LOG_FILE         = path.join(__dirname, 'log.txt');
const INTERVALO_MS     = 30 * 60 * 1000; // 30 minutos

// Cole aqui a URL gerada pelo Apps Script após configurar
const APPS_SCRIPT_URL = 'https://script.google.com/a/macros/conexasaude.com.br/s/AKfycbzY_GdqVG7mlv0MPyZnlxXPcYo9yLsZReDU6TvBr1ecmQ5LWlL8DoXeVeWTN0pamgY/exec';

// ═══════════════════════════════════════════════════════════════════
//  COLUNAS DA ABA PAINEL (índice 0 = coluna A)
// ═══════════════════════════════════════════════════════════════════
const COL = {
  NOME:       2,   // C — Nome completo
  CPF:        3,   // D
  EMAIL:      4,   // E — Endereço de e-mail
  TIPO:       7,   // H — Tipo de solicitação
  DESCRICAO:  8,   // I — Descrição completa + Obs. médico
  DATA:       9,   // J — Data do evento
  HORA_INI:   10,  // K — Hr início
  HORA_FIM:   11,  // L — Hr fim
  REPOSICAO:  12,  // M — Reposição
  STATUS:     13,  // N — Status
  ANALISTA:   14,  // O — Analista Responsável
  DATA_EXEC:  16,  // Q — Data (execução)
  HORA_EXEC:  17,  // R — Horário (execução)
  AGENTE:     18,  // S — AGENTE DE IA
  OBSERVACAO: 19,  // T — observação
};

// ═══════════════════════════════════════════════════════════════════
//  LOG
// ═══════════════════════════════════════════════════════════════════
const ok    = (m) => { console.log(`\x1b[32m✓ ${m}\x1b[0m`);  gravar(`OK    | ${m}`); };
const err   = (m) => { console.log(`\x1b[31m✗ ${m}\x1b[0m`);  gravar(`ERRO  | ${m}`); };
const inf   = (m) => { console.log(`\x1b[36mℹ ${m}\x1b[0m`);  gravar(`INFO  | ${m}`); };
const aviso = (m) => { console.log(`\x1b[33m⚠ ${m}\x1b[0m`);  gravar(`AVISO | ${m}`); };
const sep   = ()  =>    console.log('\x1b[90m─────────────────────────────────────────\x1b[0m');

function gravar(msg) {
  const linha = `[${agoraFormatado()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, linha); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
//  DATA/HORA
// ═══════════════════════════════════════════════════════════════════
function agora() {
  const d = new Date();
  const off = -3 * 60;
  return new Date(d.getTime() + (d.getTimezoneOffset() + off) * 60000);
}
function agoraFormatado() {
  return agora().toLocaleString('pt-BR');
}
function agoraData()    { return agora().toLocaleDateString('pt-BR'); }
function agoraHorario() { return agora().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

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
//  HTTP HELPERS
// ═══════════════════════════════════════════════════════════════════
function httpGet(url, redir = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { rejectUnauthorized: false }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redir > 5) return reject(new Error('Muitos redirecionamentos'));
        return resolve(httpGet(res.headers.location, redir + 1));
      }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function httpPost(url, corpo) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = url.startsWith('https') ? https : http;
      const opts = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) },
        rejectUnauthorized: false,
      };
      const req = mod.request(opts, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve(data));
      });
      req.on('error', () => resolve(null));
      req.write(corpo);
      req.end();
    } catch { resolve(null); }
  });
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
//  PARSE DESCRIÇÃO (coluna I)
//  Extrai datas e horas do texto livre do formulário
// ═══════════════════════════════════════════════════════════════════
function parsearDescricao(texto) {
  if (!texto) return null;

  // Padrão: "DD/MM/YYYY das HH:MM às HH:MM" ou "DD/MM/YYYY de HH:MM a HH:MM"
  const regexBloco = /(\d{2}\/\d{2}\/\d{4})\s+(?:das?|de)\s+(\d{2}:\d{2})\s+(?:às?|a)\s+(\d{2}:\d{2})/gi;
  const matches = [...texto.matchAll(regexBloco)];

  if (matches.length === 0) return null;

  const bloqueio  = matches[0];
  const reposicao = matches[1] || null;

  return {
    data_ini:    bloqueio[1],
    hora_ini:    bloqueio[2],
    data_fim:    bloqueio[1], // mesmo dia por padrão
    hora_fim:    bloqueio[3],
    rep_data:    reposicao ? reposicao[1] : null,
    rep_hora_ini: reposicao ? reposicao[2] : null,
    rep_hora_fim: reposicao ? reposicao[3] : null,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  ATUALIZA PLANILHA via Apps Script
// ═══════════════════════════════════════════════════════════════════
async function atualizarPlanilha(rowIndex, colunas) {
  if (!APPS_SCRIPT_URL) {
    aviso('APPS_SCRIPT_URL não configurada — planilha não será atualizada automaticamente.');
    return false;
  }
  const corpo = JSON.stringify({ row: rowIndex, colunas });
  const resp  = await httpPost(APPS_SCRIPT_URL, corpo);
  if (!resp) { err('Sem resposta do Apps Script'); return false; }
  try {
    const r = JSON.parse(resp);
    if (r.ok) { ok(`Planilha atualizada: ${r.msg}`); return true; }
    err(`Apps Script: ${r.msg}`);
  } catch { err('Resposta inválida do Apps Script'); }
  return false;
}

async function registrarSucesso(rowIndex, sol) {
  await atualizarPlanilha(rowIndex, {
    [COL.STATUS]:    'Aprovado',
    [COL.ANALISTA]:  'AGENTE DE IA',
    [COL.DATA_EXEC]: agoraData(),
    [COL.HORA_EXEC]: agoraHorario(),
    [COL.AGENTE]:    'REALIZADO',
  });
}

async function registrarFalha(rowIndex, sol, motivo, detalhe = '') {
  await atualizarPlanilha(rowIndex, {
    [COL.AGENTE]:     `NÃO REALIZADO - ${motivo}`,
    [COL.OBSERVACAO]: detalhe || motivo,
  });
  await enviarEmailAlerta(sol, motivo, detalhe);
}

// ═══════════════════════════════════════════════════════════════════
//  E-MAIL DE ALERTA (via Apps Script — sem dependência extra)
// ═══════════════════════════════════════════════════════════════════
async function enviarEmailAlerta(sol, motivo, detalhe) {
  if (!APPS_SCRIPT_URL) return;
  const corpo = JSON.stringify({
    acao:     'email',
    para:     EMAIL_ALERTA,
    assunto:  `[AGENTE IA] NÃO REALIZADO — ${sol.nome || sol.email}`,
    mensagem: `Olá Juliana,\n\nO Agente de IA não conseguiu executar a solicitação abaixo:\n\nMédico: ${sol.nome || '-'}\nE-mail: ${sol.email}\nTipo: ${sol.tipo}\nMotivo: ${motivo}\nDetalhe: ${detalhe}\nData/hora: ${agoraFormatado()}\n\nAcesse a planilha para tomar as providências.\n\nAtenciosamente,\nAgente de IA — Conexa Saúde`,
  });
  await httpPost(APPS_SCRIPT_URL, corpo);
}

// ═══════════════════════════════════════════════════════════════════
//  LÊ PLANILHA VIA APPS SCRIPT (autenticado, sem precisar ser pública)
// ═══════════════════════════════════════════════════════════════════
async function lerPendentes() {
  inf('Verificando planilha (aba PAINEL)...');

  if (!APPS_SCRIPT_URL) { aviso('APPS_SCRIPT_URL não configurada'); return []; }

  const resposta = await httpGet(APPS_SCRIPT_URL);
  if (!resposta) { err('Sem resposta do Apps Script'); return []; }

  let dados;
  try { dados = JSON.parse(resposta); }
  catch { err('Resposta inválida do Apps Script: ' + resposta.substring(0, 100)); return []; }

  if (!dados.ok) { err('Apps Script erro: ' + dados.msg); return []; }

  const processados = carregarProcessados();
  const pendentes = (dados.pendentes || []).filter(sol => {
    const chave = `${sol.email}_${sol.data}_${sol.tipo}`.replace(/\s+/g, '_').toLowerCase();
    if (processados[chave]) return false;
    sol.chave    = chave;
    sol.rowIndex = sol.row; // row já é o número real da linha na planilha
    return true;
  });

  // Ordem: mais antiga primeiro
  pendentes.sort((a, b) => {
    const toDate = s => { if (!s) return 0; const [d,m,y] = (s||'').split('/'); return new Date(`${y}-${m}-${d}`); };
    return toDate(a.data) - toDate(b.data);
  });

  ok(`${pendentes.length} solicitação(ões) pendente(s)`);
  return pendentes;
}

// ═══════════════════════════════════════════════════════════════════
//  ABRE CHROME E FAZ LOGIN
// ═══════════════════════════════════════════════════════════════════
async function abrirNavegador() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 500,
    channel: 'chrome',
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext();
  const page    = await context.newPage();

  await page.goto(BACKOFFICE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const ehLogin = page.url().includes('login') || page.url().includes('auth') ||
    await page.locator('input[type="email"], input[placeholder*="mail"]').isVisible().catch(() => false);

  if (ehLogin) {
    inf('Fazendo login...');
    await page.locator('input[type="email"], input[name*="email"], input[placeholder*="E-mail"]').first().fill(LOGIN.email);
    await page.waitForTimeout(400);
    await page.locator('input[type="password"]').first().fill(LOGIN.senha);
    await page.waitForTimeout(400);
    await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")').first().click();
    await page.waitForTimeout(3000);
    ok('Login realizado');
    await page.goto(BACKOFFICE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  return { browser, context, page };
}

// ═══════════════════════════════════════════════════════════════════
//  BUSCA PROFISSIONAL POR E-MAIL
//  Retorna: 'ok' | 'nao_encontrado' | 'multiplos_ativos' | 'inativo'
// ═══════════════════════════════════════════════════════════════════
async function buscarProfissional(page, email) {
  inf(`Buscando: ${email}`);
  const campo = page.locator('input[type="search"], input[placeholder*="uscar"], input[placeholder*="mail"]').first();
  await campo.waitFor({ timeout: 10000 });
  await campo.clear();
  await campo.fill(email);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);

  const ativos = await page.locator('text=Ativo').count();
  if (ativos === 0)  return 'nao_encontrado';
  if (ativos > 1)    return 'multiplos_ativos';
  return 'ok';
}

// ═══════════════════════════════════════════════════════════════════
//  FLUXO A — FECHAMENTO (com e sem reposição)
// ═══════════════════════════════════════════════════════════════════
async function executarFechamento(page, sol, comReposicao) {
  const dados = parsearDescricao(sol.desc);
  if (!dados) throw new Error(`Não foi possível extrair datas da descrição: "${sol.desc}"`);

  inf('Abrindo menu ⋮...');
  const linhaAtiva = page.locator('tr').filter({ hasText: 'Ativo' }).last();
  await linhaAtiva.locator('button').last().click();
  await page.waitForTimeout(800);

  inf('Clicando em Agenda...');
  await page.locator('[role="menuitem"]:has-text("Agenda"), li:has-text("Agenda"), a:has-text("Agenda")').last().click();
  await page.waitForTimeout(2000);

  inf('Clicando em Ausências...');
  await page.locator('text=Ausências').click();
  await page.waitForTimeout(1500);

  // Nome do evento
  await page.locator('input[placeholder*="motivo"], input[placeholder*="evento"], textarea[placeholder*="motivo"]').first().fill('FORMS');
  ok('Nome do evento: FORMS');

  // Data inicial
  const camposData = await page.locator('input[placeholder*="DD/MM"], input[placeholder*="dd/mm"], input[type="date"]').all();
  if (camposData[0]) { await camposData[0].fill(dados.data_ini); await page.keyboard.press('Tab'); }
  ok(`Data inicial: ${dados.data_ini}`);

  // Hora inicial
  const camposHora = await page.locator('input[placeholder*="HH:MM"], input[placeholder*="hh:mm"]').all();
  if (camposHora[0]) { await camposHora[0].fill(dados.hora_ini); }
  ok(`Hora inicial: ${dados.hora_ini}`);

  // Data final
  if (camposData[1]) { await camposData[1].fill(dados.data_fim); await page.keyboard.press('Tab'); }
  ok(`Data final: ${dados.data_fim}`);

  // Hora final
  if (camposHora[1]) { await camposHora[1].fill(dados.hora_fim); }
  ok(`Hora final: ${dados.hora_fim}`);

  // Reagendamento — sempre "Reagendar atendimento conflitante"
  await page.waitForTimeout(300);
  const btnReagendar = page.locator('label:has-text("Reagendar"), input[type="radio"] + label:has-text("Reagendar")').first();
  await btnReagendar.click().catch(() => {});
  ok('Reagendamento: Reagendar atendimento conflitante');

  // Reposição (somente com reposição)
  if (comReposicao && dados.rep_data) {
    inf('Adicionando período de reposição...');
    await page.locator('button:has-text("Adicionar período"), button:has-text("Adicionar")').first().click();
    await page.waitForTimeout(1000);

    const camposRep = await page.locator('input[placeholder*="DD/MM"], input[placeholder*="dd/mm"]').all();
    const ultimoData = camposRep[camposRep.length - 1];
    if (ultimoData) { await ultimoData.fill(dados.rep_data); await page.keyboard.press('Tab'); }

    const camposRepHora = await page.locator('input[placeholder*="HH:MM"], input[placeholder*="hh:mm"]').all();
    if (camposRepHora[camposRepHora.length - 2]) await camposRepHora[camposRepHora.length - 2].fill(dados.rep_hora_ini);
    if (camposRepHora[camposRepHora.length - 1]) await camposRepHora[camposRepHora.length - 1].fill(dados.rep_hora_fim);
    ok(`Reposição: ${dados.rep_data} ${dados.rep_hora_ini}–${dados.rep_hora_fim}`);
  }

  // Programar
  await page.waitForTimeout(500);
  inf('Clicando em Programar...');
  await page.locator('button:has-text("Programar")').click();
  await page.waitForTimeout(3000);

  ok(`SUCESSO — Fechamento programado para ${sol.nome || sol.email}`);
}

// ═══════════════════════════════════════════════════════════════════
//  FLUXO B — ABERTURA DE HORÁRIO EXTRA
// ═══════════════════════════════════════════════════════════════════
async function executarAbertura(page, sol) {
  const row      = sol.row;
  const data     = (row[COL.DATA]     || '').trim();
  const hora_ini = (row[COL.HORA_INI] || '').trim();
  const hora_fim = (row[COL.HORA_FIM] || '').trim();

  if (!data || !hora_ini || !hora_fim) throw new Error('Data/hora não encontrados nas colunas J, K ou L');

  inf('Abrindo menu ⋮...');
  const linhaAtiva = page.locator('tr').filter({ hasText: 'Ativo' }).last();
  await linhaAtiva.locator('button').last().click();
  await page.waitForTimeout(800);

  inf('Clicando em Agenda...');
  await page.locator('[role="menuitem"]:has-text("Agenda"), li:has-text("Agenda"), a:has-text("Agenda")').last().click();
  await page.waitForTimeout(2000);

  inf('Clicando em Horário adicional...');
  await page.locator('text=Horário adicional').click();
  await page.waitForTimeout(1500);

  // Tempo de atendimento (tenta extrair da descrição, padrão 20min)
  const matchDuracao = (sol.desc || '').match(/(\d+)\s*min/i);
  const duracao = matchDuracao ? matchDuracao[1] : '20';
  const selectTempo = page.locator('select').first().or(page.locator('[role="combobox"]').first());
  try { await selectTempo.selectOption({ label: `${duracao} minutos` }); }
  catch { await selectTempo.selectOption(duracao).catch(() => {}); }
  ok(`Tempo: ${duracao} minutos`);

  // Antecedência 00:00
  const inputsHora = await page.locator('input[placeholder*="hh:mm"], input[placeholder*="00:00"]').all();
  if (inputsHora[0]) { await inputsHora[0].fill('00:00'); ok('Antecedência: 00:00'); }

  // Data
  const inputData = page.locator('input[placeholder*="DD/MM"], input[placeholder*="dd/mm"], input[type="date"]').first();
  await inputData.fill(data);
  await page.keyboard.press('Tab');
  ok(`Data: ${data}`);
  await page.waitForTimeout(300);

  // Hora inicial e final
  const horaInputs = await page.locator('input[placeholder*="hh:mm"], input[placeholder*="HH:MM"]').all();
  if (horaInputs[1]) { await horaInputs[1].fill(hora_ini); ok(`Hora inicial: ${hora_ini}`); }
  await page.waitForTimeout(300);
  if (horaInputs[2]) { await horaInputs[2].fill(hora_fim); ok(`Hora final: ${hora_fim}`); }

  // Programar
  await page.waitForTimeout(500);
  inf('Clicando em Programar...');
  await page.locator('button:has-text("Programar")').click();
  await page.waitForTimeout(3000);

  ok(`SUCESSO — Abertura programada para ${sol.nome || sol.email}`);
}

// ═══════════════════════════════════════════════════════════════════
//  PROCESSA UMA SOLICITAÇÃO
// ═══════════════════════════════════════════════════════════════════
async function processarSolicitacao(sol) {
  sep();
  inf(`PROCESSANDO: ${sol.nome || sol.email}`);
  inf(`Tipo   : ${sol.tipo}`);
  inf(`E-mail : ${sol.email}`);
  inf(`Linha  : ${sol.rowIndex + 1}`);
  sep();

  let context;
  try {
    const nav = await abrirNavegador();
    context   = nav.context;
    const page = nav.page;

    // Busca por e-mail
    const resultado = await buscarProfissional(page, sol.email);

    if (resultado === 'nao_encontrado') {
      err('Médico não encontrado');
      await registrarFalha(sol.rowIndex, sol, 'Médico não encontrado', `E-mail ${sol.email} não retornou resultados`);
      await context.close();
      return false;
    }
    if (resultado === 'multiplos_ativos') {
      err('2 ou mais perfis ativos encontrados');
      await registrarFalha(sol.rowIndex, sol, '2 perfis ativos', 'Verificar manualmente qual perfil usar');
      await context.close();
      return false;
    }

    ok('1 perfil ativo — prosseguindo');

    const tipo = sol.tipo.toLowerCase();

    if (tipo.includes('fechamento') && tipo.includes('reposição')) {
      await executarFechamento(page, sol, true);
    } else if (tipo.includes('fechamento') && tipo.includes('sem reposição')) {
      await executarFechamento(page, sol, false);
    } else if (tipo.includes('abertura')) {
      await executarAbertura(page, sol);
    } else {
      err(`Tipo não reconhecido: ${sol.tipo}`);
      await registrarFalha(sol.rowIndex, sol, 'Tipo não reconhecido', sol.tipo);
      await context.close();
      return false;
    }

    await page.waitForTimeout(3000);
    await context.close();

    await registrarSucesso(sol.rowIndex, sol);
    salvarProcessado(sol.chave, { nome: sol.nome, email: sol.email, tipo: sol.tipo, data: sol.data });
    return true;

  } catch (e) {
    err(`Erro durante execução: ${e.message}`);
    if (context) { try { await context.close(); } catch {} }
    await registrarFalha(sol.rowIndex, sol, 'Erro técnico', e.message);
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
  catch (e) { err(`Erro ao ler planilha: ${e.message}`); return; }

  for (const sol of pendentes) {
    const sucesso = await processarSolicitacao(sol);
    if (sucesso) ok(`Linha ${sol.rowIndex + 1} processada com sucesso.`);
    else aviso(`Linha ${sol.rowIndex + 1} não processada — time humano notificado.`);
    await new Promise(r => setTimeout(r, 3000));
  }

  inf(`Próxima verificação em 30 minutos.`);
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

  await ciclo();
  setInterval(ciclo, INTERVALO_MS);
}

iniciar();
