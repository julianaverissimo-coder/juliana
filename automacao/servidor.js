const http = require('http');
const { exec } = require('child_process');
const path = require('path');

const PORTA = 4000;
const SCRIPT = path.join(__dirname, 'executar.js');

let rodando = false;

const servidor = http.createServer((req, res) => {
  if (req.url === '/rodar') {
    if (rodando) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, msg: 'Já existe uma execução em andamento.' }));
      return;
    }

    rodando = true;
    console.log(`[${new Date().toLocaleString('pt-BR')}] Disparo recebido — iniciando execução...`);

    exec(`node "${SCRIPT}" --once`, { cwd: __dirname }, (erro, stdout, stderr) => {
      rodando = false;
      if (erro) console.error('Erro na execução:', erro.message);
      console.log(stdout);
      if (stderr) console.error(stderr);
      console.log(`[${new Date().toLocaleString('pt-BR')}] Execução finalizada.`);
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, msg: 'Execução iniciada.' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, msg: 'Rota não encontrada. Use /rodar' }));
});

servidor.listen(PORTA, () => {
  console.log(`Servidor local pronto — aguardando chamadas em http://localhost:${PORTA}/rodar`);
});
