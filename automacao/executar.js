const { chromium } = require('playwright');

// ─── DADOS DA SOLICITAÇÃO (lidos da planilha) ─────────────────────────────────
const SOLICITACAO = {
  medico:      'Alberto Tavares de Araújo Freitas',
  cpf:         '09910245752',
  duracao_min: '20',
  data:        '01/06/2026',
  hora_ini:    '17:00',
  hora_fim:    '19:00',
};

const BACKOFFICE_URL = 'https://backoffice.conexasaude.com.br/usuario/profissionais';

// ─── CORES NO TERMINAL ────────────────────────────────────────────────────────
const ok  = (msg) => console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
const err = (msg) => console.log(`\x1b[31m✗ ${msg}\x1b[0m`);
const inf = (msg) => console.log(`\x1b[36mℹ ${msg}\x1b[0m`);

async function executar() {
  inf(`Iniciando automação para: ${SOLICITACAO.medico} (CPF: ${SOLICITACAO.cpf})`);

  // Abre o navegador visível para você acompanhar
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    // ── PASSO 1: Abre o Backoffice ──────────────────────────────────────────
    inf('Abrindo Backoffice...');
    await page.goto(BACKOFFICE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Se cair na tela de login, pausa para você logar
    if (page.url().includes('login') || page.url().includes('auth')) {
      inf('Tela de login detectada. Faça o login manualmente e pressione ENTER aqui para continuar...');
      await new Promise(resolve => process.stdin.once('data', resolve));
      await page.goto(BACKOFFICE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    }

    ok('Backoffice aberto');

    // ── PASSO 2: Busca pelo CPF ─────────────────────────────────────────────
    inf(`Buscando CPF: ${SOLICITACAO.cpf}...`);
    const campoBusca = page.locator('input[type="search"], input[placeholder*="busca"], input[placeholder*="Busca"], input[placeholder*="CPF"], input[placeholder*="Nome"]').first();
    await campoBusca.waitFor({ timeout: 10000 });
    await campoBusca.fill(SOLICITACAO.cpf);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    ok(`CPF ${SOLICITACAO.cpf} buscado`);

    // ── PASSO 3: Verifica resultados ────────────────────────────────────────
    inf('Verificando perfis ativos...');
    await page.waitForTimeout(1500);

    // Conta linhas com badge "Ativo"
    const badges = await page.locator('text=Ativo').all();
    const ativos = badges.length;

    if (ativos === 0) {
      err('Nenhum perfil ativo encontrado. Solicitação marcada como PENDENTE.');
      await browser.close();
      return;
    }
    if (ativos > 1) {
      err(`${ativos} perfis ativos encontrados. Não executar — PENDENTE para revisão manual.`);
      await browser.close();
      return;
    }

    ok('1 perfil ativo encontrado — prosseguindo');

    // ── PASSO 4: Clica nos 3 pontinhos ─────────────────────────────────────
    inf('Abrindo menu de ações...');
    const menuBtn = page.locator('button[aria-label*="ação"], button:has(svg), [data-testid="menu"]').first();
    // Tenta clicar no botão de 3 pontinhos da linha ativa
    const linhaAtiva = page.locator('tr, [role="row"]').filter({ hasText: 'Ativo' }).last();
    const btnAcoes   = linhaAtiva.locator('button').last();
    await btnAcoes.click();
    await page.waitForTimeout(1000);

    ok('Menu aberto');

    // ── PASSO 5: Clica em "Agenda" ──────────────────────────────────────────
    inf('Clicando em Agenda...');
    await page.locator('text=Agenda').last().click();
    await page.waitForTimeout(2000);

    ok('Página de Agenda aberta');

    // ── PASSO 6: Aba "Horário adicional" ────────────────────────────────────
    inf('Clicando em Horário adicional...');
    await page.locator('text=Horário adicional').click();
    await page.waitForTimeout(1500);

    ok('Aba Horário adicional selecionada');

    // ── PASSO 7: Preenche os campos ─────────────────────────────────────────
    inf('Preenchendo campos...');

    // Tempo de atendimento (select)
    await page.locator('select, [role="combobox"]').first().selectOption({ label: `${SOLICITACAO.duracao_min} minutos` }).catch(async () => {
      // Tenta por valor numérico se label não funcionar
      await page.locator('select, [role="combobox"]').first().selectOption(SOLICITACAO.duracao_min);
    });
    ok(`Tempo de atendimento: ${SOLICITACAO.duracao_min} minutos`);

    // Antecedência: 00:00
    const campoAntecedencia = page.locator('input[placeholder*="00:00"], input[placeholder*="hh:mm"]').first();
    await campoAntecedencia.fill('00:00');
    ok('Antecedência: 00:00');

    // Data
    const campoData = page.locator('input[placeholder*="DD/MM"], input[type="date"], input[placeholder*="data"]').first();
    await campoData.fill(SOLICITACAO.data);
    ok(`Data: ${SOLICITACAO.data}`);

    // Hora inicial
    const camposHora = await page.locator('input[placeholder*="hh:mm"]').all();
    if (camposHora.length >= 2) {
      await camposHora[1].fill(SOLICITACAO.hora_ini);
      ok(`Hora inicial: ${SOLICITACAO.hora_ini}`);
    }

    // Hora final
    if (camposHora.length >= 3) {
      await camposHora[2].fill(SOLICITACAO.hora_fim);
      ok(`Hora final: ${SOLICITACAO.hora_fim}`);
    }

    // ── PASSO 8: Clica em Programar ─────────────────────────────────────────
    inf('Clicando em Programar...');
    await page.locator('button:has-text("Programar")').click();
    await page.waitForTimeout(3000);

    ok('Horário programado!');

    // ── PASSO 9: Confirma na lista ───────────────────────────────────────────
    const confirmado = await page.locator('text=Horários programados').isVisible();
    if (confirmado) {
      ok('Horário confirmado na lista "Horários programados"');
    }

    inf('');
    inf('══════════════════════════════════════════');
    ok(`SUCESSO! Horário ${SOLICITACAO.hora_ini}–${SOLICITACAO.hora_fim} em ${SOLICITACAO.data} programado para ${SOLICITACAO.medico}`);
    inf('Agora acesse a planilha e preencha coluna AO com "Aprovado"');
    inf('══════════════════════════════════════════');

    // Mantém navegador aberto para conferência
    inf('Navegador mantido aberto para você conferir. Feche quando quiser.');
    await page.waitForTimeout(15000);

  } catch (e) {
    err(`Erro durante execução: ${e.message}`);
    inf('O navegador ficará aberto para você verificar o estado atual.');
    await page.waitForTimeout(20000);
  } finally {
    await browser.close();
  }
}

executar();
