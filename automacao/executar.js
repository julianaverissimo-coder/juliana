const { chromium } = require('playwright');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── CONFIGURAÇÕES ────────────────────────────────────────────────────────────
const LOGIN = {
  email: 'juliana.verissimo@conexasaude.com.br',
  senha: '74b225df2',
};

const PLANILHA_CSV = 'https://docs.google.com/spreadsheets/d/1bDn7ShNSWvcE6_DIjPUs1swrM7aGuuEFz413tvrI3O8/gviz/tq?tqx=out:csv&gid=1722470876';
const BACKOFFICE_URL = 'https://backoffice.conexasaude.com.br/usuario/profissionais';
const PROCESSADOS_FILE = path.join(__dirname, 'processados.json');
const INTERVALO_MS = 5 * 60 * 1000; // 5 minutos

// ─── LOG ──────────────────────────────────────────────────────────────────────
const ok    = (m) => console.log(`\x1b[32m✓ ${m}\x1b[0m`);
const err   = (m) => console.log(`\x1b[31m✗ ${m}\x1b[0m`);
const inf   = (m) => console.log(`\x1b[36mℹ ${m}\x1b[0m`);
const aviso = (m) => console.log(`\x1b[33m⚠ ${m}\x1b[0m`);
const sep   = ()  => console.log('\x1b[90m─────────────────────────────────────\x1b[0m');

// ─── HORÁRIO COMERCIAL (seg-sex 07h-17h, Brasília UTC-3) ─────────────────────
function dentroDoHorario() {
  const agora = new Date();
  const brasiliaOffset = -3 * 60;
  const utcMs = agora.getTime() + agora.getTimezoneOffset() * 60000;
  const brasilia = new Date(utcMs + brasiliaOffset * 60000);
  const dia = brasilia.getDay(); // 0=dom, 6=sab
  const hora = brasilia.getHours();
  return dia >= 1 && dia <= 5 && hora >= 7 && hora < 17;
}

function agoraFormatado() {
  const agora = new Date();
  const brasiliaOffset = -3 * 60;
  const utcMs = agora.getTime() + agora.getTimezoneOffset() * 60000;
  const brasilia = new Date(utcMs + brasiliaOffset * 60000);
  return brasilia.toLocaleString('pt-BR');
}

// ─── PROCESSADOS (persistência local) ────────────────────────────────────────
function carregarProcessados() {
  try {
    if (fs.existsSync(PROCESSADOS_FILE))
      return JSON.parse(fs.readFileSync(PROCESSADOS_FILE, 'utf8'));
  } catch {}
  return {};
}

function salvarProcessado(chave, dados) {
  const p = carregarProcessados();
  p[chave] = { ...dados, executadoEm: agoraFormatado() };
  fs.writeFileSync(PROCESSADOS_FILE, JSON.stringify(p, null, 2));
}

// ─── PARSE CSV ────────────────────────────────────────────────────────────────
function parseCSV(texto) {
  const linhas = [];
  let dentro = false, campo = '', linha = [];
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') {
      dentro = !dentro;
    } else if (c === ',' && !dentro) {
      linha.push(campo.trim());
      campo = '';
    } else if ((c === '\n' || c === '\r') && !dentro) {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo.trim());
      linhas.push(linha);
      linha = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo || linha.length) { linha.push(campo.trim()); linhas.push(linha); }
  return linhas;
}

// ─── BAIXA CSV ────────────────────────────────────────────────────────────────
function baixarCSV(url) {
  return new Promise((resolve, reject) => {
    const get = (u, redir) => {
      https.get(u, { rejectUnauthorized: false }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redir > 5) return reject(new Error('Muitos redirecionamentos'));
          return get(res.headers.location, redir + 1);
        }
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    };
    get(url, 0);
  });
}

// ─── ENCONTRA COLUNA POR NOME ─────────────────────────────────────────────────
function encontrarColuna(headers, nomes) {
  for (const nome of nomes) {
    const idx = headers.findIndex(h => h.includes(nome.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function limparCPF(v) {
  return (v || '').replace(/\D/g, '').trim();
}

// ─── LÊ E FILTRA PLANILHA ─────────────────────────────────────────────────────
async function lerSolicitacoesPendentes() {
  inf('Verificando planilha...');
  const csv = await baixarCSV(PLANILHA_CSV);
  const linhas = parseCSV(csv);
  if (linhas.length < 2) { aviso('Planilha vazia ou sem dados'); return []; }

  const headers = linhas[0].map(h => h.toLowerCase().trim());

  const idx = {
    medico:   encontrarColuna(headers, ['nome do médico', 'nome do profissional', 'médico', 'medico', 'nome completo do médico']),
    cpf:      encontrarColuna(headers, ['cpf', 'cpf do médico', 'cpf do profissional']),
    data:     encontrarColuna(headers, ['data', 'data do horário', 'data do horario', 'data de abertura']),
    hora_ini: encontrarColuna(headers, ['hora inicial', 'hora de início', 'hora inicio', 'início', 'inicio']),
    hora_fim: encontrarColuna(headers, ['hora final', 'hora fim', 'término', 'termino', 'fim']),
    duracao:  encontrarColuna(headers, ['duração', 'duracao', 'tempo', 'minutos', 'tempo de atendimento']),
    paciente: encontrarColuna(headers, ['paciente', 'nome do paciente', 'paciente específico', 'paciente especifico']),
    aprovado: encontrarColuna(headers, ['aprovado pela gestão médica', 'aprovado pela gestao medica', 'aprovado', 'gestão médica', 'sim/não', 'sim/nao']),
    status:   encontrarColuna(headers, ['status', 'situação', 'situacao']),
  };

  // Na primeira execução, imprime o mapeamento de colunas
  sep();
  inf('Mapeamento de colunas detectado:');
  for (const [k, v] of Object.entries(idx)) {
    if (v >= 0) inf(`  ${k.padEnd(10)} → col ${String(v).padStart(2)} ("${headers[v]}")`);
    else aviso(`  ${k.padEnd(10)} → não encontrado`);
  }
  sep();

  if (idx.cpf < 0 || idx.aprovado < 0) {
    err('Colunas obrigatórias (CPF e Aprovado) não encontradas. Verifique os cabeçalhos da planilha.');
    return [];
  }

  const processados = carregarProcessados();
  const pendentes = [];

  for (let i = 1; i < linhas.length; i++) {
    const row = linhas[i];
    if (!row || row.length < 3) continue;

    const aprovado = (row[idx.aprovado] || '').trim().toUpperCase();
    if (aprovado !== 'SIM') continue;

    const cpf      = limparCPF(row[idx.cpf]);
    const data     = idx.data     >= 0 ? (row[idx.data]     || '').trim() : '';
    const hora_ini = idx.hora_ini >= 0 ? (row[idx.hora_ini] || '').trim() : '';
    const hora_fim = idx.hora_fim >= 0 ? (row[idx.hora_fim] || '').trim() : '';
    const medico   = idx.medico   >= 0 ? (row[idx.medico]   || '').trim() : '';
    const duracao  = idx.duracao  >= 0 ? (row[idx.duracao]  || '20').trim() : '20';
    const paciente = idx.paciente >= 0 ? (row[idx.paciente] || '').trim() : '';
    const status   = idx.status   >= 0 ? (row[idx.status]   || '').trim().toUpperCase() : '';

    if (!cpf || !data || !hora_ini) continue;

    // Ignora se tem paciente específico
    if (paciente) {
      inf(`Linha ${i + 1}: ignorada — paciente específico preenchido ("${paciente}")`);
      continue;
    }

    // Ignora se já aprovado na planilha
    if (status === 'APROVADO') continue;

    const chave = `${cpf}_${data}_${hora_ini}`;
    if (processados[chave]) {
      inf(`Linha ${i + 1}: já executada em ${processados[chave].executadoEm}`);
      continue;
    }

    pendentes.push({ linha: i + 1, cpf, medico, data, hora_ini, hora_fim, duracao, chave });
  }

  ok(`${pendentes.length} solicitação(ões) pendente(s)`);
  return pendentes;
}

// ─── EXECUTA ABERTURA DE HORÁRIO ──────────────────────────────────────────────
async function executarAbertura(sol) {
  sep();
  inf(`EXECUTANDO: ${sol.medico || sol.cpf}`);
  inf(`CPF    : ${sol.cpf}`);
  inf(`Data   : ${sol.data}  ${sol.hora_ini} → ${sol.hora_fim}`);
  inf(`Duração: ${sol.duracao} minutos`);
  sep();

  let context;
  try {
    const browser = await chromium.launch({
      headless: false,
      slowMo: 600,
      channel: 'chrome',
      args: ['--no-sandbox'],
    });
    context = await browser.newContext();
  } catch (e) {
    err(`Não conseguiu abrir o Chrome: ${e.message}`);
    return false;
  }

  const page = await context.newPage();
  try {
    inf('Abrindo Backoffice...');
    await page.goto(BACKOFFICE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Login automático se necessário
    const ehLogin = page.url().includes('login') || page.url().includes('auth') || page.url().includes('signin')
      || await page.locator('input[type="email"], input[placeholder*="mail"]').isVisible().catch(() => false);

    if (ehLogin) {
      inf('Login detectado — preenchendo credenciais...');
      await page.locator('input[type="email"], input[name*="email"], input[placeholder*="mail"], input[placeholder*="E-mail"]').first().fill(LOGIN.email);
      await page.waitForTimeout(400);
      await page.locator('input[type="password"]').first().fill(LOGIN.senha);
      await page.waitForTimeout(400);
      await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login"), button:has-text("Acessar")').first().click();
      await page.waitForTimeout(3000);
      ok('Login realizado');
      await page.goto(BACKOFFICE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    }
    ok('Backoffice carregado');

    // Busca CPF
    inf(`Buscando CPF ${sol.cpf}...`);
    const busca = page.locator('input[type="search"]')
      .or(page.locator('input[placeholder*="uscar"]'))
      .or(page.locator('input[placeholder*="CPF"]'))
      .or(page.locator('input[placeholder*="ome"]'))
      .first();
    await busca.waitFor({ timeout: 10000 });
    await busca.clear();
    await busca.fill(sol.cpf);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    ok('Busca realizada');

    // Verifica perfis ativos
    const ativos = await page.locator('text=Ativo').count();
    if (ativos === 0) {
      err('Nenhum perfil ativo → PENDENTE');
      await page.waitForTimeout(4000);
      await context.close();
      return false;
    }
    if (ativos > 1) {
      err(`${ativos} perfis ativos → PENDENTE para revisão manual`);
      await page.waitForTimeout(4000);
      await context.close();
      return false;
    }
    ok(`${ativos} perfil ativo — prosseguindo`);

    // Menu ⋮ → Agenda
    inf('Abrindo menu ⋮...');
    const linhaAtiva = page.locator('tr').filter({ hasText: 'Ativo' }).last();
    await linhaAtiva.locator('button').last().click();
    await page.waitForTimeout(1000);
    inf('Clicando em Agenda...');
    await page.locator('[role="menuitem"]:has-text("Agenda"), li:has-text("Agenda"), a:has-text("Agenda")').last().click();
    await page.waitForTimeout(2500);
    ok('Agenda aberta');

    // Aba Horário adicional
    inf('Clicando em "Horário adicional"...');
    await page.locator('text=Horário adicional').click();
    await page.waitForTimeout(1500);
    ok('Aba ativa');

    // Tempo de atendimento
    const selectTempo = page.locator('select').first().or(page.locator('[role="combobox"]').first());
    try { await selectTempo.selectOption({ label: `${sol.duracao} minutos` }); }
    catch { await selectTempo.selectOption(sol.duracao); }
    ok(`Tempo: ${sol.duracao} minutos`);
    await page.waitForTimeout(500);

    // Antecedência 00:00
    const inputs = await page.locator('input[placeholder*="hh:mm"], input[placeholder*="00:00"]').all();
    if (inputs[0]) { await inputs[0].fill('00:00'); ok('Antecedência: 00:00'); }

    // Data
    const inputData = page.locator('input[placeholder*="DD/MM"], input[placeholder*="dd/mm"], input[type="date"]').first();
    await inputData.fill(sol.data);
    await page.keyboard.press('Tab');
    ok(`Data: ${sol.data}`);
    await page.waitForTimeout(300);

    // Horas
    const horaInputs = await page.locator('input[placeholder*="hh:mm"], input[placeholder*="HH:MM"]').all();
    if (horaInputs[1]) { await horaInputs[1].fill(sol.hora_ini); ok(`Hora inicial: ${sol.hora_ini}`); }
    await page.waitForTimeout(300);
    if (horaInputs[2]) { await horaInputs[2].fill(sol.hora_fim); ok(`Hora final: ${sol.hora_fim}`); }

    // Programar
    await page.waitForTimeout(500);
    inf('Clicando em Programar...');
    await page.locator('button:has-text("Programar")').click();
    await page.waitForTimeout(3000);

    sep();
    ok(`SUCESSO! Horário ${sol.hora_ini}–${sol.hora_fim} de ${sol.data} programado!`);
    ok(`Médico: ${sol.medico || sol.cpf}`);
    sep();
    aviso('👉 Vá à planilha e preencha a coluna AO com "Aprovado"');
    sep();

    await page.waitForTimeout(5000);
    await context.close();
    return true;

  } catch (e) {
    err(`Erro durante execução: ${e.message}`);
    await page.waitForTimeout(4000);
    await context.close();
    return false;
  }
}

// ─── CICLO PRINCIPAL ──────────────────────────────────────────────────────────
async function ciclo() {
  const agora = agoraFormatado();

  if (!dentroDoHorario()) {
    aviso(`[${agora}] Fora do horário comercial (seg-sex 07h–17h). Próxima verificação em 5 min.`);
    return;
  }

  inf(`[${agora}] Verificando novas solicitações...`);

  let pendentes;
  try {
    pendentes = await lerSolicitacoesPendentes();
  } catch (e) {
    err(`Erro ao ler planilha: ${e.message}`);
    return;
  }

  for (const sol of pendentes) {
    inf(`Processando linha ${sol.linha}: ${sol.medico || sol.cpf}`);
    const sucesso = await executarAbertura(sol);
    if (sucesso) {
      salvarProcessado(sol.chave, { medico: sol.medico, cpf: sol.cpf, data: sol.data, hora_ini: sol.hora_ini });
      ok(`Linha ${sol.linha} marcada como processada.`);
    } else {
      aviso(`Linha ${sol.linha} não processada — tentará novamente no próximo ciclo.`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

async function iniciar() {
  console.log('\x1b[32m');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   AUTOMAÇÃO AGENDA — CONEXA SAÚDE            ║');
  console.log('║   Modo: Tempo Real  |  Polling: 5 minutos    ║');
  console.log('║   Horário: seg–sex  07h–17h  (Brasília)      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\x1b[0m');
  inf('Iniciando monitoramento... pressione Ctrl+C para parar.');
  sep();

  await ciclo();
  setInterval(ciclo, INTERVALO_MS);
}

iniciar();
