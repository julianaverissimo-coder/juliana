// ═══════════════════════════════════════════════════════════════
//  Apps Script — Agente de IA Conexa Saúde
//  Cole em: Planilha → Extensões → Apps Script
//  Implante como: App da Web | Qualquer pessoa | Executar como: Eu mesmo
// ═══════════════════════════════════════════════════════════════

const ABA_NOME    = 'PAINEL';
const LINHA_INI   = 4;   // dados começam na linha 4 (1-3 são cabeçalhos)
const NUM_COLUNAS = 20;

// Índices 0-based (igual ao executar.js)
const CI = {
  NOME: 2, EMAIL: 4, TIPO: 7, DESC: 8,
  DATA: 9, HINI: 10, HFIM: 11, REPOS: 12,
  STATUS: 13, ANALISTA: 14,
};

// ── GET: lê pendentes (sem param) ou escreve/envia (com param dados) ──
function doGet(e) {
  try {
    const dadosStr = e && e.parameter && e.parameter.dados;

    // Sem parâmetro → retorna linhas pendentes
    if (!dadosStr) {
      const ss   = SpreadsheetApp.getActiveSpreadsheet();
      const aba  = ss.getSheetByName(ABA_NOME) || ss.getActiveSheet();
      const ult  = aba.getLastRow();
      if (ult < LINHA_INI) return json({ ok: true, pendentes: [] });

      const vals  = aba.getRange(LINHA_INI, 1, ult - LINHA_INI + 1, NUM_COLUNAS).getValues();
      const tipos = ['fechamento de agenda com reposição','fechamento de agenda sem reposição','abertura de horário extra'];
      const pend  = [];
      const fmt   = (v, tipo) => {
        if (!v) return '';
        if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', tipo === 'data' ? 'dd/MM/yyyy' : 'HH:mm');
        return String(v);
      };
      vals.forEach((row, idx) => {
        const status = String(row[CI.STATUS] || '').trim();
        if (status !== '' && status !== '~') return;
        const tipo  = String(row[CI.TIPO]  || '').trim();
        if (!tipos.some(t => tipo.toLowerCase().includes(t))) return;
        const email = String(row[CI.EMAIL] || '').trim();
        if (!email) return;
        pend.push({ row: LINHA_INI + idx, nome: String(row[CI.NOME]||''), email, tipo,
          desc: String(row[CI.DESC]||''), data: fmt(row[CI.DATA],'data'),
          hora_ini: fmt(row[CI.HINI],'hora'), hora_fim: fmt(row[CI.HFIM],'hora'),
          reposicao: String(row[CI.REPOS]||'') });
      });
      return json({ ok: true, pendentes: pend });
    }

    const dados = JSON.parse(decodeURIComponent(dadosStr));

    if (dados.acao === 'email') {
      GmailApp.sendEmail(dados.para, dados.assunto, dados.mensagem);
      return json({ ok: true, msg: 'E-mail enviado' });
    }

    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA_NOME) || ss.getActiveSheet();
    const row = parseInt(dados.row);

    for (const [colIndex, valor] of Object.entries(dados.colunas)) {
      aba.getRange(row, parseInt(colIndex) + 1).setValue(valor);
    }

    return json({ ok: true, msg: `Linha ${row} atualizada` });

  } catch(ex) {
    return json({ ok: false, msg: ex.message });
  }
}

// ── Função antiga de leitura (não usada, mantida para referência) ──
function doGet_leitura_antiga(e) {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA_NOME) || ss.getActiveSheet();
    const ultima = aba.getLastRow();

    if (ultima < LINHA_INI) return json({ ok: true, pendentes: [] });

    const valores = aba.getRange(LINHA_INI, 1, ultima - LINHA_INI + 1, NUM_COLUNAS).getValues();
    const tipos   = [
      'fechamento de agenda com reposição',
      'fechamento de agenda sem reposição',
      'abertura de horário extra',
    ];
    const pendentes = [];

    valores.forEach((row, idx) => {
      const status = String(row[CI.STATUS] || '').trim();
      if (status !== '' && status !== '~') return;

      const tipo  = String(row[CI.TIPO]  || '').trim();
      if (!tipos.some(t => tipo.toLowerCase().includes(t))) return;

      const email = String(row[CI.EMAIL] || '').trim();
      if (!email) return;

      const fmtData = (v) => {
        if (!v) return '';
        if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'dd/MM/yyyy');
        return String(v);
      };
      const fmtHora = (v) => {
        if (!v) return '';
        if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'HH:mm');
        return String(v);
      };

      pendentes.push({
        row:       LINHA_INI + idx,
        nome:      String(row[CI.NOME]  || ''),
        email:     email,
        tipo:      tipo,
        desc:      String(row[CI.DESC]  || ''),
        data:      fmtData(row[CI.DATA]),
        hora_ini:  fmtHora(row[CI.HINI]),
        hora_fim:  fmtHora(row[CI.HFIM]),
        reposicao: String(row[CI.REPOS] || ''),
      });
    });

    return json({ ok: true, pendentes });

  } catch (ex) {
    return json({ ok: false, msg: ex.message });
  }
}

// ── POST: atualiza células ou envia e-mail ────────────────────
function doPost(e) {
  try {
    const dados = JSON.parse(e.postData.contents);

    if (dados.acao === 'email') {
      GmailApp.sendEmail(dados.para, dados.assunto, dados.mensagem);
      return json({ ok: true, msg: 'E-mail enviado' });
    }

    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA_NOME) || ss.getActiveSheet();
    const row = parseInt(dados.row);

    for (const [colIndex, valor] of Object.entries(dados.colunas)) {
      aba.getRange(row, parseInt(colIndex) + 1).setValue(valor);
    }

    return json({ ok: true, msg: `Linha ${row} atualizada` });

  } catch (ex) {
    return json({ ok: false, msg: ex.message });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
