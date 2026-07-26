// ═══════════════════════════════════════════════════════════════
//  Apps Script — Agente de IA Conexa Saúde
//  Cole em: Planilha → Extensões → Apps Script
//  Implante como: App da Web | Qualquer pessoa | Executar como: Eu mesmo
// ═══════════════════════════════════════════════════════════════

const ABA_NOME = 'PAINEL';

function doPost(e) {
  try {
    const dados = JSON.parse(e.postData.contents);

    // Ação: enviar e-mail de alerta
    if (dados.acao === 'email') {
      GmailApp.sendEmail(dados.para, dados.assunto, dados.mensagem);
      return resposta(true, 'E-mail enviado');
    }

    // Ação padrão: atualizar células da planilha
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(ABA_NOME) || ss.getActiveSheet();

    const row     = parseInt(dados.row);   // número da linha (começa em 1)
    const colunas = dados.colunas;         // { indiceColuna: valor, ... }

    for (const [colIndex, valor] of Object.entries(colunas)) {
      const col = parseInt(colIndex) + 1;  // planilha começa em 1
      aba.getRange(row, col).setValue(valor);
    }

    return resposta(true, `Linha ${row} atualizada`);

  } catch (ex) {
    return resposta(false, ex.message);
  }
}

function resposta(ok, msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok, msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
