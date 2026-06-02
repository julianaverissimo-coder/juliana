const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');

// ─── CREDENCIAIS DO BACKOFFICE ────────────────────────────────────────────────
const LOGIN = {
  email: 'juliana.verissimo@conexasaude.com.br',
  senha: '74b225df2',
};

// ─── SOLICITAÇÃO (Alberto Tavares — planilha 01/06/2026) ──────────────────────
const SOLICITACAO = {
  medico:      'Alberto Tavares de Araújo Freitas',
  cpf:         '09910245752',
  duracao_min: '20',
  data:        '01/06/2026',
  hora_ini:    '17:00',
  hora_fim:    '19:00',
};

const BACKOFFICE_URL = 'https://backoffice.conexasaude.com.br/usuario/profissionais';

// ─── PERFIL DO CHROME (usa sessão já logada) ──────────────────────────────────
function chromePerfil() {
  const u = os.homedir();
  if (process.platform === 'win32')
    return path.join(u, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
  if (process.platform === 'darwin')
    return path.join(u, 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(u, '.config', 'google-chrome');
}

// ─── LOG COLORIDO ─────────────────────────────────────────────────────────────
const ok  = (m) => console.log(`\x1b[32m✓ ${m}\x1b[0m`);
const err = (m) => console.log(`\x1b[31m✗ ${m}\x1b[0m`);
const inf = (m) => console.log(`\x1b[36mℹ ${m}\x1b[0m`);
const sep = ()  => console.log('\x1b[90m─────────────────────────────────────\x1b[0m');

async function executar() {
  sep();
  inf(`Médico : ${SOLICITACAO.medico}`);
  inf(`CPF    : ${SOLICITACAO.cpf}`);
  inf(`Data   : ${SOLICITACAO.data}  ${SOLICITACAO.hora_ini} → ${SOLICITACAO.hora_fim}`);
  inf(`Duração: ${SOLICITACAO.duracao_min} minutos`);
  sep();

  // Usa o Chrome instalado no Windows
  let context;
  try {
    inf('Abrindo Chrome...');
    const browser = await chromium.launch({
      headless: false,
      slowMo: 600,
      channel: 'chrome',
      args: ['--no-sandbox'],
    });
    context = await browser.newContext();
  } catch (e) {
    err(`Não conseguiu abrir o Chrome: ${e.message}`);
    process.exit(1);
  }

  const page = await context.newPage();

  try {
    // ── PASSO 1: Abre o Backoffice ────────────────────────────────────────────
    inf('Abrindo Backoffice...');
    await page.goto(BACKOFFICE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Se cair no login, preenche automaticamente
    if (page.url().includes('login') || page.url().includes('auth') || page.url().includes('signin') || await page.locator('input[type="email"], input[type="text"][name*="email"], input[placeholder*="mail"]').isVisible().catch(() => false)) {
      inf('Tela de login detectada — fazendo login automaticamente...');
      await page.locator('input[type="email"], input[name*="email"], input[placeholder*="mail"], input[placeholder*="E-mail"]').first().fill(LOGIN.email);
      await page.waitForTimeout(400);
      await page.locator('input[type="password"]').first().fill(LOGIN.senha);
      await page.waitForTimeout(400);
      await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login"), button:has-text("Acessar")').first().click();
      await page.waitForTimeout(3000);
      ok('Login realizado');
      // Navega para a página de profissionais
      await page.goto(BACKOFFICE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    }
    ok('Backoffice carregado');

    // ── PASSO 2: Busca pelo CPF ───────────────────────────────────────────────
    inf(`Buscando CPF ${SOLICITACAO.cpf}...`);
    const busca = page.locator('input').filter({ hasAttr: 'type', attrValue: 'search' })
      .or(page.locator('input[placeholder*="uscar"]'))
      .or(page.locator('input[placeholder*="CPF"]'))
      .or(page.locator('input[placeholder*="ome"]'))
      .first();

    await busca.waitFor({ timeout: 10000 });
    await busca.clear();
    await busca.fill(SOLICITACAO.cpf);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    ok('Busca realizada');

    // ── PASSO 3: Verifica perfis ativos ──────────────────────────────────────
    inf('Verificando perfis ativos...');
    await page.waitForTimeout(1000);
    const ativos = await page.locator('text=Ativo').count();

    if (ativos === 0) {
      err('Nenhum perfil ativo. Solicitação → PENDENTE.');
      await page.waitForTimeout(8000);
      await context.close();
      return;
    }
    if (ativos > 1) {
      err(`${ativos} perfis ativos encontrados → PENDENTE para revisão manual.`);
      await page.waitForTimeout(8000);
      await context.close();
      return;
    }
    ok(`${ativos} perfil ativo — prosseguindo`);

    // ── PASSO 4: Abre menu ⋮ e clica em Agenda ────────────────────────────────
    inf('Abrindo menu de ações...');
    const linhaAtiva = page.locator('tr').filter({ hasText: 'Ativo' }).last();
    const botaoMenu  = linhaAtiva.locator('button').last();
    await botaoMenu.click();
    await page.waitForTimeout(1000);
    ok('Menu aberto');

    inf('Clicando em Agenda...');
    await page.locator('[role="menuitem"]:has-text("Agenda"), li:has-text("Agenda"), a:has-text("Agenda")').last().click();
    await page.waitForTimeout(2500);
    ok('Página Agenda aberta');

    // ── PASSO 5: Aba Horário adicional ────────────────────────────────────────
    inf('Clicando em "Horário adicional"...');
    await page.locator('text=Horário adicional').click();
    await page.waitForTimeout(1500);
    ok('Aba Horário adicional ativa');

    // ── PASSO 6: Preenche campos ──────────────────────────────────────────────
    inf('Preenchendo campos...');

    // Tempo de atendimento (select/combobox)
    const selectTempo = page.locator('select').first()
      .or(page.locator('[role="combobox"]').first());
    try {
      await selectTempo.selectOption({ label: `${SOLICITACAO.duracao_min} minutos` });
    } catch {
      await selectTempo.selectOption(SOLICITACAO.duracao_min);
    }
    ok(`Tempo: ${SOLICITACAO.duracao_min} minutos`);

    await page.waitForTimeout(500);

    // Antecedência: 00:00
    const inputs = await page.locator('input[placeholder*="hh:mm"], input[placeholder*="00:00"]').all();
    if (inputs[0]) { await inputs[0].fill('00:00'); ok('Antecedência: 00:00'); }

    // Data
    const inputData = page.locator('input[placeholder*="DD/MM"], input[placeholder*="dd/mm"], input[type="date"]').first();
    await inputData.fill(SOLICITACAO.data);
    await page.keyboard.press('Tab');
    ok(`Data: ${SOLICITACAO.data}`);
    await page.waitForTimeout(300);

    // Hora inicial e final
    const horaInputs = await page.locator('input[placeholder*="hh:mm"], input[placeholder*="HH:MM"]').all();
    if (horaInputs[1]) { await horaInputs[1].fill(SOLICITACAO.hora_ini); ok(`Hora inicial: ${SOLICITACAO.hora_ini}`); }
    await page.waitForTimeout(300);
    if (horaInputs[2]) { await horaInputs[2].fill(SOLICITACAO.hora_fim); ok(`Hora final: ${SOLICITACAO.hora_fim}`); }

    // ── PASSO 7: Clica em Programar ───────────────────────────────────────────
    await page.waitForTimeout(500);
    inf('Clicando em Programar...');
    await page.locator('button:has-text("Programar")').click();
    await page.waitForTimeout(3000);

    sep();
    ok(`SUCESSO! Horário ${SOLICITACAO.hora_ini}–${SOLICITACAO.hora_fim} de ${SOLICITACAO.data} programado!`);
    ok(`Médico: ${SOLICITACAO.medico}`);
    sep();
    inf('👉 Agora vá à planilha e preencha a coluna AO com "Aprovado"');
    sep();

    await page.waitForTimeout(20000); // mantém aberto 20s para conferência

  } catch (e) {
    err(`Erro: ${e.message}`);
    inf('Navegador mantido aberto para verificação. Feche manualmente.');
    await page.waitForTimeout(30000);
  } finally {
    await context.close();
  }
}

executar();
