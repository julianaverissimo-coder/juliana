const { chromium } = require('playwright');
const fs      = require('fs');
const path    = require('path');
const readline = require('readline');

// ═══════════════════════════════════════════════════════════════════
//  CONFIGURAÇÕES
// ═══════════════════════════════════════════════════════════════════

const LOGIN_BACKOFFICE = {
  email: 'juliana.verissimo@conexasaude.com.br',
  senha: '74b225df2JUJU*',
};

const EMAIL_ALERTA     = 'juliana.verissimo@conexasaude.com.br';
const PLANILHA_URL     = 'https://docs.google.com/spreadsheets/d/1bDn7ShNSWvcE6_DIjPUs1swrM7aGuuEFz413tvrI3O8/edit#gid=1809280439';
const PLANILHA_CSV     = 'https://docs.google.com/spreadsheets/d/1bDn7ShNSWvcE6_DIjPUs1swrM7aGuuEFz413tvrI3O8/gviz/tq?tqx=out:csv&gid=1809280439';
const BACKOFFICE_URL   = 'https://backoffice.conexasaude.com.br/profissional/consulta';
const PROFILE_DIR      = path.join(__dirname, 'chrome_profile');
const PROCESSADOS_FILE = path.join(__dirname, 'processados.json');
const LOG_FILE         = path.join(__dirname, 'log.txt');
const INTERVALO_MS     = 15 * 60 * 1000;

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
//  VALORES FIXOS DAS LISTAS SUSPENSAS DA PLANILHA
//  (coluna N = Status, coluna S = AGENTE DE IA — precisam bater exato)
// ═══════════════════════════════════════════════════════════════════
const STATUS = {
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
};

// Coluna S (AGENTE DE IA) só tem 2 opções reais na lista suspensa
const AGENTE = {
  REALIZADO: 'REALIZADO',
  ERRO:      'ERRO',
};

// Motivo detalhado vai na coluna T (observação, texto livre) — não é lista suspensa
const MOTIVO = {
  DOIS_PERFIS_ATIVOS:     '2 perfis ativos encontrados',
  MEDICO_NAO_ENCONTRADO:  'Médico não encontrado',
  PERFIL_INATIVO:         'Perfil inativo',
  ERRO_TECNICO:           'Erro técnico',
  TELA_INESPERADA:        'Tela inesperada',
  NAO_AUTORIZADO_GESTAO:  'Não autorizado pela gestão médica',
  AGENDA_QUINZENAL:       'Não realizamos agenda quinzenal',
  JA_REALIZADA_ANTES:     'Ação já realizada antes',
  SEM_INFORMACOES:        'Sem informações necessárias',
  FORA_DO_PRAZO:          'Fora do prazo',
};

// Colunas que são LISTA SUSPENSA — precisam ser marcadas (clicadas), nunca digitadas
const COLUNAS_LISTA = new Set([COL.STATUS, COL.ANALISTA, COL.AGENTE]);

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

function dataJaPassou(dataStr) {
  if (!dataStr) return false;
  const [d, m, y] = dataStr.split('/');
  if (!d || !m || !y) return false;
  const dataAlvo = new Date(`${y}-${m}-${d}T23:59:59`);
  return dataAlvo.getTime() < agora().getTime();
}

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

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
//  NAVEGADOR — perfil persistente (sessão Google e Backoffice salvas)
// ═══════════════════════════════════════════════════════════════════
let _ctx          = null;
let _planilhaPage = null;  // aba da planilha Google Sheets

async function garantirNavegador() {
  if (_ctx) {
    try { await _ctx.pages(); return; } catch { _ctx = null; _planilhaPage = null; }
  }
  inf('Abrindo Chrome com perfil salvo...');
  _ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    slowMo: 900,
    permissions: ['clipboard-read', 'clipboard-write'],
    args: ['--no-sandbox', '--start-maximized'],
  });
  ok('Chrome pronto');
}

// ═══════════════════════════════════════════════════════════════════
//  PLANILHA — abre e mantém a aba do Google Sheets
// ═══════════════════════════════════════════════════════════════════
// Desenha um contorno colorido ao redor do elemento por um instante, para acompanhar visualmente
async function destacar(locator) {
  try { await locator.highlight(); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
//  CURSOR VISUAL — desenha uma setinha na tela e move ela de verdade
//  até cada campo/botão, para dar a sensação de alguém usando o mouse
// ═══════════════════════════════════════════════════════════════════
const _cursorPos = new WeakMap();

async function injetarCursor(page) {
  await page.addInitScript(() => {
    function criar() {
      if (document.getElementById('agente-cursor-ia')) return;
      const el = document.createElement('div');
      el.id = 'agente-cursor-ia';
      el.style.position = 'fixed';
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.zIndex = '2147483647';
      el.style.pointerEvents = 'none';
      el.style.transform = 'translate(-2px, -2px)';
      el.style.transition = 'left 0.05s linear, top 0.05s linear';
      el.innerHTML = '<svg width="30" height="30" viewBox="0 0 30 30" style="filter:drop-shadow(1px 2px 3px rgba(0,0,0,.6))"><path d="M3 2 L3 24 L9.5 18.5 L13 27 L17 25.3 L13.5 17 L23 17 Z" fill="#FF2D6B" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.body.appendChild(el);
    }
    window.__moverCursorAgente = (x, y) => {
      criar();
      const el = document.getElementById('agente-cursor-ia');
      if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
    };
    if (document.readyState !== 'loading') criar();
    else document.addEventListener('DOMContentLoaded', criar);
  });
  await page.evaluate(() => {
    if (window.__moverCursorAgente) window.__moverCursorAgente(20, 20);
  }).catch(() => {});
}

// Move o cursor visual (e o mouse real) suavemente até o elemento, depois destaca e retorna o locator
async function apontarPara(page, locator) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) { await destacar(locator); return locator; }

  const alvoX = box.x + box.width / 2;
  const alvoY = box.y + box.height / 2;
  const origem = _cursorPos.get(page) || { x: alvoX, y: alvoY };
  const passos = 14;

  for (let i = 1; i <= passos; i++) {
    const x = origem.x + (alvoX - origem.x) * (i / passos);
    const y = origem.y + (alvoY - origem.y) * (i / passos);
    await page.mouse.move(x, y).catch(() => {});
    await page.evaluate(([x, y]) => window.__moverCursorAgente && window.__moverCursorAgente(x, y), [x, y]).catch(() => {});
    await page.waitForTimeout(25);
  }
  _cursorPos.set(page, { x: alvoX, y: alvoY });
  await destacar(locator);
  return locator;
}

function aguardarEnter(mensagem) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(mensagem, () => { rl.close(); resolve(); });
  });
}

async function abrirPlanilha() {
  await garantirNavegador();

  // Verifica se a aba da planilha ainda está de fato utilizável (não só "não fechada")
  try {
    if (_planilhaPage && !_planilhaPage.isClosed()) {
      const url = _planilhaPage.url();
      if (url.includes('docs.google.com/spreadsheets')) return _planilhaPage;
    }
  } catch {
    aviso('Aba da planilha parou de responder — abrindo uma nova.');
    _planilhaPage = null;
  }

  _planilhaPage = await _ctx.newPage();
  await injetarCursor(_planilhaPage);
  inf('Abrindo planilha no Chrome...');
  await _planilhaPage.goto(PLANILHA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await _planilhaPage.waitForTimeout(3000);

  // Detecta se caiu na tela de login do Google — pausa e espera confirmação manual
  const precisaLogin = _planilhaPage.url().includes('accounts.google.com') ||
    await _planilhaPage.locator('input[type="email"]').first().isVisible().catch(() => false);

  if (precisaLogin) {
    aviso('Login do Google necessário — faça login na janela do Chrome que abriu.');
    await aguardarEnter('>>> Depois de logar no Google (e confirmar a verificação em 2 etapas se pedir), pressione ENTER aqui para continuar... ');
    await _planilhaPage.goto(PLANILHA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await _planilhaPage.waitForTimeout(3000);
  }

  ok('Planilha aberta');
  return _planilhaPage;
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE CSV
// ═══════════════════════════════════════════════════════════════════
// Parser de CSV correto (RFC 4180): trata aspas DUPLICADAS ("") dentro de um campo
// como uma aspas literal, sem desligar o estado "dentro de campo com aspas" no meio
// do caminho. O bug anterior tratava toda aspas isoladamente, e um texto digitado
// por um médico contendo aspas (ex: 12") desalinhava a contagem de linhas dali em diante.
function parseCSV(texto) {
  const linhas = [];
  let campo = '', linha = [], dentro = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (dentro) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } // aspas literal escapada
        else { dentro = false; }                          // fecha o campo com aspas
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') { dentro = true; }
    else if (c === ',') { linha.push(campo.trim()); campo = ''; }
    else if (c === '\r') { /* ignora, tratado junto com \n abaixo */ }
    else if (c === '\n') { linha.push(campo.trim()); linhas.push(linha); linha = []; campo = ''; }
    else { campo += c; }
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
  // FASE 1: apenas fechamento sem reposição, para validar o fluxo com casos reais
  const tiposValidos = [
    'fechamento de agenda sem reposição',
  ];

  for (let i = 1; i < linhas.length; i++) {
    const row = linhas[i];
    if (!row || row.length < 10) continue;
    const status = (row[COL.STATUS] || '').trim();
    if (status !== '' && status !== '~') continue;
    // Status fica em branco mesmo após erro (decisão do gestor) — usa a coluna Agente para não reprocessar
    const agenteIA = (row[COL.AGENTE] || '').trim().toUpperCase();
    if (agenteIA === 'ERRO' || agenteIA === 'REALIZADO') continue;
    const tipo  = (row[COL.TIPO]  || '').trim();
    const email = (row[COL.EMAIL] || '').trim().toLowerCase();
    if (!tiposValidos.some(t => tipo.toLowerCase().includes(t))) continue;
    if (!email) continue;
    const data  = (row[COL.DATA] || '').trim();

    // Regra: data já passada — não processa, deixa para humano, pula a linha inteira
    if (dataJaPassou(data)) {
      aviso(`Linha ${i + 1} ignorada — data (${data}) já passou. Deixado para análise humana.`);
      continue;
    }

    const chave = `${email}_${data}_${tipo}`.replace(/\s+/g, '_').toLowerCase();
    pendentes.push({
      rowIndex: i,  // 0-based CSV index; rowIndex+1 = número real da linha na planilha
      row,
      chave,
      email,
      nome:  (row[COL.NOME]      || '').trim(),
      tipo,
      desc:  (row[COL.DESCRICAO] || '').trim(),
      data,
      hora_ini: (row[COL.HORA_INI] || '').trim(),
      hora_fim: (row[COL.HORA_FIM] || '').trim(),
      // Já tentado antes (ex: crash no meio da execução anterior) — registrar em vez de ignorar
      jaProcessadoAntes: !!processados[chave],
    });
  }

  pendentes.sort((a, b) => {
    const td = s => { if (!s) return 0; const [d,m,y] = s.split('/'); return new Date(`${y}-${m}-${d}`); };
    return td(a.data) - td(b.data);
  });

  ok(`${pendentes.length} solicitação(ões) pendente(s)`);
  return pendentes;
}

// ═══════════════════════════════════════════════════════════════════
//  LÊ PLANILHA — abre no Chrome e faz fetch autenticado do CSV
// ═══════════════════════════════════════════════════════════════════
async function lerPendentes() {
  inf('Verificando planilha (aba PAINEL)...');
  const planilha = await abrirPlanilha();

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const csv = await planilha.evaluate(async (url) => {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }, PLANILHA_CSV);

      return _processarCSV(csv);
    } catch(e) {
      if (tentativa < 2) {
        aviso(`Falha temporária ao ler planilha (tentativa ${tentativa}): ${e.message} — tentando de novo...`);
        await planilha.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await planilha.waitForTimeout(3000);
      } else {
        err('Erro ao ler planilha: ' + e.message);
        return [];
      }
    }
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════
//  ESCREVE NA PLANILHA — navega até a célula e digita o valor
// ═══════════════════════════════════════════════════════════════════
// Retorna a referência de célula que a Caixa de Nome está mostrando agora (ex: "N3618")
// #t-name-box é o id real e estável da Caixa de Nome do Google Sheets — não usar seletores "chutados"
async function celulaAtual(planilha) {
  return await planilha.locator('#t-name-box').first().inputValue()
    .then(v => v.trim().toUpperCase()).catch(() => null);
}

// Navega até a célula e CONFIRMA (com foco real + valor real) que chegou lá antes de deixar escrever
async function navegarParaCelula(planilha, letra, row) {
  const alvo = `${letra}${row}`.toUpperCase();

  await planilha.bringToFront();
  await planilha.keyboard.press('Escape');
  await planilha.waitForTimeout(300);

  const caixaNome = planilha.locator('#t-name-box');
  const visivel = await caixaNome.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visivel) {
    throw new Error(`Caixa de Nome (#t-name-box) não está visível na tela (destino: ${alvo}) — não vou adivinhar outro lugar para clicar.`);
  }

  inf(`  → navegando para a célula ${alvo}...`);
  await apontarPara(planilha, caixaNome);
  await caixaNome.click();

  // Confirma que o FOCO realmente foi para a Caixa de Nome antes de digitar qualquer coisa
  const focado = await planilha.evaluate(() => document.activeElement && document.activeElement.id === 't-name-box').catch(() => false);
  if (!focado) {
    throw new Error(`Cliquei na Caixa de Nome mas o foco não foi para ela (destino: ${alvo}) — abortando, algo bloqueou o clique.`);
  }

  await planilha.keyboard.press('Control+a');
  await planilha.keyboard.type(alvo, { delay: 60 });
  await planilha.keyboard.press('Enter');
  await planilha.waitForTimeout(800);

  // Confirmação real: a Caixa de Nome precisa mostrar exatamente a célula pedida
  const atual = await celulaAtual(planilha);
  if (atual !== alvo) {
    throw new Error(`Navegação para célula falhou — pedido ${alvo}, caixa de nome mostra "${atual}". Abortando escrita para não gravar em lugar errado.`);
  }
  ok(`  ✓ na célula ${alvo}`);
}

// Só para colunas de TEXTO LIVRE (ex: coluna T - observação). Nunca usar em coluna com lista suspensa.
async function escreverNaCelula(letra, row, valor) {
  const planilha = await abrirPlanilha();
  await navegarParaCelula(planilha, letra, row); // lança erro se não confirmar a célula certa
  inf(`  ✎ digitando "${valor}" em ${letra}${row}...`);
  await planilha.keyboard.type(String(valor), { delay: 60 });
  await planilha.waitForTimeout(400);
  await planilha.keyboard.press('Tab');
  await planilha.waitForTimeout(500);
  ok(`  ✎ ${letra}${row} = "${valor}"`);
}

// Lê o conteúdo atual da célula selecionada via copiar/colar (não depende de aparência visual)
async function lerCelulaAtual(planilha) {
  await planilha.keyboard.press('Control+c');
  await planilha.waitForTimeout(200);
  // Nunca deixa travar para sempre: se a leitura do clipboard não responder em 3s, desiste
  const resultado = await Promise.race([
    planilha.evaluate(() => navigator.clipboard.readText()).catch(() => null),
    new Promise(resolve => setTimeout(() => resolve('__TIMEOUT__'), 3000)),
  ]);
  return resultado === '__TIMEOUT__' ? null : resultado;
}

// Para colunas com LISTA SUSPENSA (Status, Analista, Agente de IA): abre a lista e CLICA na opção.
// Nunca digita. Se a opção não aparecer, lança erro em vez de inventar/forçar algo.
async function selecionarNaLista(letra, row, opcaoTexto) {
  const planilha = await abrirPlanilha();
  await navegarParaCelula(planilha, letra, row); // já confirma que está na célula certa

  inf(`  ▾ abrindo lista suspensa em ${letra}${row}...`);
  await planilha.keyboard.press('Enter');
  await planilha.waitForTimeout(600);

  const opcao = planilha.getByText(opcaoTexto, { exact: true }).last();
  const apareceu = await opcao.isVisible({ timeout: 3000 }).catch(() => false);

  if (!apareceu) {
    await planilha.keyboard.press('Escape');
    throw new Error(`Opção "${opcaoTexto}" não apareceu na lista suspensa de ${letra}${row} — não vou inventar, abortando.`);
  }

  await apontarPara(planilha, opcao);
  await opcao.click();
  await planilha.waitForTimeout(500);

  // Verifica de verdade o que ficou gravado na célula (não confia só no clique)
  const gravado = (await lerCelulaAtual(planilha) || '').trim();
  if (gravado !== opcaoTexto) {
    throw new Error(`Depois de marcar "${opcaoTexto}" em ${letra}${row}, a célula ficou com "${gravado}" — não confere. Abortando.`);
  }

  ok(`  ✓ ${letra}${row} marcado como "${opcaoTexto}"`);
}

function colLetra(idx) {
  return String.fromCharCode(65 + parseInt(idx));
}

async function atualizarPlanilha(rowNum, colunas) {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      for (const [colIdx, valor] of Object.entries(colunas)) {
        const idx = parseInt(colIdx);
        if (COLUNAS_LISTA.has(idx)) {
          await selecionarNaLista(colLetra(idx), rowNum, valor);
        } else {
          await escreverNaCelula(colLetra(idx), rowNum, valor);
        }
      }
      // Salva com Ctrl+S
      const planilha = await abrirPlanilha();
      await planilha.keyboard.press('Control+s');
      await planilha.waitForTimeout(500);
      ok(`Planilha atualizada: linha ${rowNum}`);
      return true;
    } catch(e) {
      const problemaRecurso = /closed|Target page|context or browser/i.test(e.message || '');
      if (problemaRecurso && tentativa < 2) {
        aviso(`Falha ao escrever na planilha (${e.message}) — reabrindo aba e tentando de novo...`);
        _planilhaPage = null;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      err('Erro ao atualizar planilha: ' + e.message);
      return false;
    }
  }
  return false;
}

async function registrarSucesso(rowNum, sol) {
  inf('Registrando sucesso na planilha...');
  await atualizarPlanilha(rowNum, {
    [COL.STATUS]:    STATUS.APROVADO,
    [COL.ANALISTA]:  'AGENTE DE IA',
    [COL.DATA_EXEC]: agoraData(),
    [COL.HORA_EXEC]: agoraHorario(),
    [COL.AGENTE]:    AGENTE.REALIZADO,
  });
}

// motivo deve ser um dos valores de MOTIVO (vai como texto livre na coluna T)
// NUNCA marca Status (N) — isso fica em branco para o gestor decidir. Só registra o erro na coluna S/T.
async function registrarFalha(rowNum, sol, motivo, detalhe = '') {
  inf('Registrando falha na planilha...');
  const detalheCurto = String(detalhe ? `${motivo} — ${detalhe}` : motivo).substring(0, 200);
  await atualizarPlanilha(rowNum, {
    [COL.ANALISTA]:   'AGENTE DE IA',
    [COL.DATA_EXEC]:  agoraData(),
    [COL.HORA_EXEC]:  agoraHorario(),
    [COL.AGENTE]:     AGENTE.ERRO,
    [COL.OBSERVACAO]: detalheCurto,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  BACKOFFICE — abre em aba separada
// ═══════════════════════════════════════════════════════════════════
async function abrirBackoffice() {
  // O Chrome pode "descartar" a aba (ou o navegador inteiro ficar sem recurso para abrir
  // abas novas) mesmo com a janela continuando aberta. Por isso, a cada tentativa, garante
  // que o navegador está de verdade utilizável — reiniciando o Chrome inteiro se preciso.
  for (let recriacoes = 1; recriacoes <= 2; recriacoes++) {
    let page;
    try {
      await garantirNavegador();
      page = await _ctx.newPage();
      await injetarCursor(page);
      inf('Abrindo Backoffice...');
      await page.goto(BACKOFFICE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

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

      // Garante que está na tela de consulta de profissionais, com o campo de busca visível
      // (o conteúdo real fica dentro de um iframe — precisa aguardar ele existir e carregar)
      let apareceu = false;

      for (let tentativa = 1; tentativa <= 3 && !apareceu; tentativa++) {
        await page.goto(BACKOFFICE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500); // dá tempo do iframe ser criado

        const frameConteudo = obterFrameConteudo(page);
        const campoBusca = frameConteudo.locator('input').first();
        apareceu = await campoBusca.waitFor({ state: 'visible', timeout: 60000 }).then(() => true).catch(() => false);

        if (!apareceu) {
          // Diagnóstico real: o que existe de fato na página/iframe nesse momento?
          const urlAtual      = page.url();
          const totalInputs   = await frameConteudo.locator('input').count().catch(() => -1);
          const totalIframes  = page.frames().length - 1; // -1 porque a página principal também conta como "frame"
          const temTextoBusca = await frameConteudo.getByText('profissional', { exact: false }).count().catch(() => -1);
          aviso(`Campo de busca não apareceu (tentativa ${tentativa}/3). URL: ${urlAtual} | inputs no frame: ${totalInputs} | iframes: ${totalIframes} | ocorrências do texto "profissional": ${temTextoBusca}`);
        }
      }

      if (!apareceu) {
        const caminho = path.join(__dirname, `diagnostico_backoffice_${Date.now()}.png`);
        await page.screenshot({ path: caminho, fullPage: true }).catch(() => {});
        throw new Error(`Campo de busca da tela de Profissionais não apareceu depois de 3 tentativas. Print salvo em: ${caminho}`);
      }

      ok('Tela de Profissionais aberta');
      return { page, frame: obterFrameConteudo(page) };

    } catch (e) {
      const problemaRecurso = /closed|Target page|context or browser|createTarget|Failed to open a new tab|Protocol error/i.test(e.message || '');
      if (problemaRecurso && recriacoes < 2) {
        aviso(`Problema de recurso no Chrome (${e.message}) — reiniciando o navegador inteiro (tentativa ${recriacoes + 1}/2)...`);
        await page?.close().catch(() => {});
        try { await _ctx?.close(); } catch {} // força reiniciar o Chrome do zero, não só a aba
        _ctx = null;
        _planilhaPage = null;
        await new Promise(r => setTimeout(r, 3000)); // dá um tempo pro Windows liberar memória
        continue;
      }
      throw e; // erro diferente, ou já tentamos recriar — deixa subir normalmente
    }
  }
}

// O conteúdo real do Backoffice fica dentro de um iframe — os elementos (campos, botões, tabela)
// precisam ser buscados aqui, nunca na página principal (que fica vazia).
function obterFrameConteudo(page) {
  const filho = page.frames().find(f => f !== page.mainFrame());
  return filho || page; // se não tiver iframe (outra tela), usa a própria página
}

// ═══════════════════════════════════════════════════════════════════
//  BUSCA PROFISSIONAL POR E-MAIL
// ═══════════════════════════════════════════════════════════════════
async function buscarProfissional(page, frame, email) {
  inf(`Buscando: ${email}`);

  if (!emailValido(email)) {
    aviso('E-mail com formato inválido.');
    return 'sem_informacoes';
  }

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);

  const campo = frame.locator('input').first();
  await campo.waitFor({ state: 'visible', timeout: 10000 });
  await apontarPara(page, campo);
  await campo.clear();
  await campo.fill(email);
  await page.waitForTimeout(300);

  // Botão de busca (lupa roxa) — fica logo ao lado do campo, não usar Enter
  const botaoBusca = campo.locator('xpath=following::button[1]');
  await apontarPara(page, botaoBusca);
  await botaoBusca.click({ timeout: 5000 }).catch(async () => {
    await page.keyboard.press('Enter'); // fallback caso o botão não seja localizado
  });
  await page.waitForTimeout(2500);

  // Conta quantas linhas de resultado existem na tabela
  const linhas = frame.locator('table tbody tr, [role="row"]').filter({ hasNotText: 'ID Profissional' });
  const totalLinhas = await linhas.count();

  if (totalLinhas === 0) {
    return 'nao_encontrado';
  }
  if (totalLinhas > 1) {
    aviso(`${totalLinhas} resultados encontrados para o e-mail — ambíguo.`);
    return 'sem_informacoes';
  }

  // Exatamente 1 linha — verifica o status dela
  const statusTexto = (await linhas.first().locator('text=/Ativo|Inativo|Bloqueado/i').first().innerText().catch(() => '')).trim();
  if (/ativo/i.test(statusTexto) && !/inativo/i.test(statusTexto)) {
    return 'ok';
  }
  aviso(`Perfil encontrado, mas status é "${statusTexto || 'desconhecido'}" (não Ativo).`);
  return 'perfil_inativo';
}

// ═══════════════════════════════════════════════════════════════════
//  FLUXO A — FECHAMENTO (com e sem reposição)
// ═══════════════════════════════════════════════════════════════════
async function executarFechamento(page, frame, sol, comReposicao) {
  const dados = parsearDescricao(sol.desc);
  if (!dados) throw new Error(`Não foi possível extrair datas: "${sol.desc}"`);

  inf('Abrindo menu ⋮...');
  const linhaAtiva = frame.locator('table tbody tr, [role="row"]').filter({ hasText: 'Ativo' }).last();

  // O ⋮ pode não ser um <button> de verdade — tenta várias possibilidades antes de desistir
  const candidatosMenu = ['button', '[role="button"]', 'svg', 'a'];
  let botaoMenu = null;
  for (const sel of candidatosMenu) {
    const cand = linhaAtiva.locator(sel).last();
    if (await cand.isVisible({ timeout: 3000 }).catch(() => false)) { botaoMenu = cand; break; }
  }

  if (!botaoMenu) {
    const totalCelulas = await linhaAtiva.locator('*').count().catch(() => -1);
    throw new Error(`Botão de menu (⋮) não encontrado na linha do profissional. Elementos na linha: ${totalCelulas}`);
  }

  await apontarPara(page, botaoMenu);
  await botaoMenu.click();
  await page.waitForTimeout(800);

  const itemAgenda = frame.locator('[role="menuitem"]:has-text("Agenda"), li:has-text("Agenda"), a:has-text("Agenda")').last();
  await apontarPara(page, itemAgenda);
  await itemAgenda.click();
  await page.waitForTimeout(2000);

  const abaAusencias = frame.locator('text=Ausências');
  await apontarPara(page, abaAusencias);
  await abaAusencias.click();
  await page.waitForTimeout(1500);

  // Campos confirmados na tela real de "Programação de ausência"
  inf(`Preenchendo: FORMS | ${dados.data_ini} ${dados.hora_ini} até ${dados.data_fim} ${dados.hora_fim}`);
  const campoNome = frame.getByLabel('Nome do evento');
  await apontarPara(page, campoNome); await campoNome.fill('FORMS');

  const campoDataIni = frame.getByLabel('Data inicial');
  await apontarPara(page, campoDataIni); await campoDataIni.fill(dados.data_ini);

  const campoHoraIni = frame.getByLabel('Hora inicial');
  await apontarPara(page, campoHoraIni); await campoHoraIni.fill(dados.hora_ini);

  const campoDataFim = frame.getByLabel('Data final');
  await apontarPara(page, campoDataFim); await campoDataFim.fill(dados.data_fim);

  const campoHoraFim = frame.getByLabel('Hora final');
  await apontarPara(page, campoHoraFim); await campoHoraFim.fill(dados.hora_fim);

  if (comReposicao) {
    // FASE 1 ainda não cobre o fluxo COM reposição — implementar quando validado
    throw new Error('Fluxo com reposição ainda não validado nesta fase');
  }

  // Fase 1: fechamento SEM reposição — marca "Reagendar atendimento conflitante" (confirmado com a Juliana)
  const opcaoReagendar = frame.getByText('Reagendar atendimento conflitante');
  await apontarPara(page, opcaoReagendar);
  await opcaoReagendar.click();

  await page.waitForTimeout(500);
  const botaoProgramar = frame.locator('button:has-text("Programar")');
  await apontarPara(page, botaoProgramar);
  await botaoProgramar.click();
  await page.waitForTimeout(1000);

  // Modal de confirmação: "Programar ausência?" → "Sim, programar"
  const modalConfirmar = frame.getByRole('button', { name: 'Sim, programar' });
  const apareceuModal  = await modalConfirmar.isVisible({ timeout: 5000 }).catch(() => false);
  if (!apareceuModal) {
    throw new Error('Modal de confirmação "Programar ausência?" não apareceu — tela inesperada');
  }
  await modalConfirmar.click();
  await page.waitForTimeout(2000);

  // Validação real de sucesso: o modal deve fechar sem erro visível
  const modalAindaAberto = await modalConfirmar.isVisible().catch(() => false);
  if (modalAindaAberto) {
    throw new Error('Modal não fechou após confirmar — possível erro do sistema');
  }

  ok(`Fechamento programado e confirmado — ${sol.nome || sol.email}`);
}

// ═══════════════════════════════════════════════════════════════════
//  FLUXO B — ABERTURA DE HORÁRIO EXTRA
// ═══════════════════════════════════════════════════════════════════
async function executarAbertura(page, sol) {
  const data     = sol.hora_ini ? sol.data     : (sol.row[COL.DATA]     || '').trim();
  const hora_ini = sol.hora_ini || (sol.row[COL.HORA_INI] || '').trim();
  const hora_fim = sol.hora_fim || (sol.row[COL.HORA_FIM] || '').trim();
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

  // Já tentado antes (ex: crash na execução anterior deixou o Status em branco de novo)
  if (sol.jaProcessadoAntes) {
    await registrarFalha(sol.rowIndex + 1, sol, MOTIVO.JA_REALIZADA_ANTES, 'Solicitação já havia sido processada anteriormente.');
    return false;
  }

  let page;
  try {
    let frame;
    ({ page, frame } = await abrirBackoffice());
    const resultado = await buscarProfissional(page, frame, sol.email);

    if (resultado === 'nao_encontrado') {
      await page.close();
      await registrarFalha(sol.rowIndex + 1, sol, MOTIVO.MEDICO_NAO_ENCONTRADO, `E-mail: ${sol.email}`);
      return false;
    }
    if (resultado === 'perfil_inativo') {
      await page.close();
      await registrarFalha(sol.rowIndex + 1, sol, MOTIVO.PERFIL_INATIVO, `E-mail: ${sol.email}`);
      return false;
    }
    if (resultado === 'sem_informacoes') {
      await page.close();
      await registrarFalha(sol.rowIndex + 1, sol, MOTIVO.SEM_INFORMACOES, 'Múltiplos perfis, e-mail inválido, ou caso ambíguo.');
      return false;
    }

    ok('1 perfil ativo encontrado');
    const tipo = sol.tipo.toLowerCase();

    // FASE 1: apenas fechamento sem reposição
    if (tipo.includes('fechamento') && tipo.includes('sem reposição')) {
      await executarFechamento(page, frame, sol, false);
    } else {
      await page.close();
      await registrarFalha(sol.rowIndex + 1, sol, MOTIVO.TELA_INESPERADA, `Tipo fora do escopo da Fase 1: ${sol.tipo}`);
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
    await registrarFalha(sol.rowIndex + 1, sol, MOTIVO.ERRO_TECNICO, e.message);
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
    const sucesso = await processarSolicitacao(sol);
    if (sucesso) ok(`Linha ${sol.rowIndex + 1} processada com sucesso.`);
    else aviso(`Linha ${sol.rowIndex + 1} não processada — registrado na planilha.`);
    await new Promise(r => setTimeout(r, 3000));
  }
  inf(`Próxima verificação em ${INTERVALO_MS / 60000} minutos.`);
}

// ═══════════════════════════════════════════════════════════════════
//  INÍCIO
// ═══════════════════════════════════════════════════════════════════
async function iniciar() {
  console.log('\x1b[35m');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   AGENTE DE IA — AUTOMAÇÃO AGENDA CONEXA         ║');
  console.log('║   Lê e escreve na planilha via Chrome autenticado ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  const rodarUmaVez = process.argv.includes('--once');

  await ciclo();

  if (rodarUmaVez) {
    inf('Modo --once: encerrando após um ciclo (chamado externamente, ex: n8n).');
    if (_ctx) await _ctx.close().catch(() => {});
    process.exit(0);
  }

  setInterval(ciclo, INTERVALO_MS);
}

iniciar().catch(e => { err('Falha crítica: ' + e.message); process.exit(1); });
