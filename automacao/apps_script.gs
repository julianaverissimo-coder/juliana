// Cole este código em: Planilha → Extensões → Apps Script
// Depois clique em "Implantar" → "Nova implantação" → Tipo: App da Web
// Executar como: Eu mesmo | Acesso: Qualquer pessoa
// Copie a URL gerada e cole em executar.js na variável APPS_SCRIPT_URL

const ABA_ID = 1722470876; // gid da aba

function doPost(e) {
  try {
    const dados = JSON.parse(e.postData.contents);
    const { cpf, data, hora_ini } = dados;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const abas = ss.getSheets();
    let aba = abas.find(s => s.getSheetId() === ABA_ID) || ss.getActiveSheet();

    const valores = aba.getDataRange().getValues();
    const headers = valores[0].map(h => String(h).toLowerCase().trim());

    // Encontra coluna AO (status) e CPF
    const colAO  = headers.findIndex(h => h.includes('status') || h === 'ao');
    const colCPF = headers.findIndex(h => h.includes('cpf'));
    const colData = headers.findIndex(h => h.includes('data'));
    const colHora = headers.findIndex(h => h.includes('hora') && h.includes('ini'));

    if (colAO < 0 || colCPF < 0) {
      return resposta(false, 'Colunas não encontradas');
    }

    const cpfLimpo = cpf.replace(/\D/g, '');

    for (let i = 1; i < valores.length; i++) {
      const rowCPF  = String(valores[i][colCPF] || '').replace(/\D/g, '');
      const rowData = String(valores[i][colData] || '').trim();
      const rowHora = colHora >= 0 ? String(valores[i][colHora] || '').trim() : '';

      const baterCPF  = rowCPF === cpfLimpo;
      const baterData = !data     || rowData.includes(data)     || data.includes(rowData);
      const baterHora = !hora_ini || rowHora.includes(hora_ini) || hora_ini.includes(rowHora);

      if (baterCPF && baterData && baterHora) {
        aba.getRange(i + 1, colAO + 1).setValue('Aprovado');
        return resposta(true, `Linha ${i + 1} atualizada com "Aprovado"`);
      }
    }

    return resposta(false, 'Linha não encontrada na planilha');

  } catch (ex) {
    return resposta(false, ex.message);
  }
}

function resposta(ok, msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok, msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
