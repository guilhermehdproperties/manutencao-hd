# Manutenção HD Properties

Aplicação para organizar a manutenção das casas da HD Properties, pensada para o telemóvel:

- **Tarefas:** cada tarefa é atribuída a uma pessoa ou a **Todos** (qualquer pessoa da equipa), aparece no calendário (vermelho por fazer, verde feita) e conclui-se com o botão verde. Quem tem a tarefa pode mudar a data e a hora, passá-la a outra pessoa ou ficar com uma tarefa para todos; tudo fica no histórico da tarefa.
- **Orçamentos:** os orçamentos dos fornecedores ficam associados a uma casa, com o PDF ou a fotografia em anexo. Pesquisa-se pelo nome da casa, do fornecedor ou pela descrição.
- **Casas:** a lista começa vazia. Acrescentam-se em *Casas* ou diretamente no formulário de uma tarefa ou de um orçamento.
- **Notificações no telemóvel:** depois de instalada no ecrã principal, a aplicação avisa quando uma tarefa é atribuída, passada ou mudada de data (só às pessoas envolvidas) e às 8h do dia de cada tarefa por fazer. A administração recebe um aviso quando alguém conclui uma tarefa e no dia 1 de cada mês, quando o relatório do mês anterior fica pronto.
- **Relatório mensal:** por pessoa, as tarefas feitas a tempo, feitas com atraso, não feitas e por fazer, e quantas vezes adiou tarefas. Consulta-se na aplicação e descarrega-se para o Excel ou em PDF.
- **Contas por pessoa:** a administração cria as contas em *Pessoas* e envia a cada pessoa um link (válido 7 dias, de uso único) para escolher a palavra-passe.

## Quem vê o quê

| | Administração | Equipa |
|---|---|---|
| Tarefas | Todas; cria, altera e apaga | As suas e as que são para todos; muda a data, a hora e a pessoa, conclui e reabre. Cria tarefas para si, para outra pessoa ou para todos |
| Relatório mensal | Vê e descarrega | — |
| Orçamentos | Todos; altera e apaga | Todos; regista e altera os que registou |
| Casas | Cria, altera e arquiva | Vê e cria |
| Pessoas | Cria contas, envia links e desativa | — |

## Instalar no telemóvel

- **iPhone (iOS 16.4 ou mais recente):** abrir no Safari → *Partilhar* → *Adicionar ao ecrã principal*. Abrir pelo ícone e, em *Conta*, carregar em *Ativar notificações*.
- **Android:** abrir no Chrome → menu ⋮ → *Instalar aplicação*. Em *Conta*, carregar em *Ativar notificações*.

## Onde corre (custo 0 €)

Cloudflare, plano gratuito: o Worker `manutencao-hd`, a base de dados D1 `manutencao-hd`, o espaço `manutencao-hd-ficheiros` para os documentos e uma verificação de hora a hora para os avisos das 8h. Cada alteração no ramo `main` do GitHub é publicada automaticamente.

Não há segredos para configurar: o segredo das sessões e as chaves das notificações (VAPID) são criados na primeira utilização e guardados na base de dados.

### Pôr online (uma vez)

1. Na Cloudflare: **Workers & Pages → Create → Import a repository**, escolher `guilhermehdproperties/manutencao-hd` e carregar em **Deploy**.
2. A primeira conta de administração é criada diretamente na base de dados, com um link para escolher a palavra-passe. Depois, as outras contas criam-se na aplicação, em *Pessoas*.

## Segurança

- A palavra-passe é reforçada no próprio aparelho (PBKDF2) e nunca chega ao servidor; o servidor guarda só um resumo com sal.
- Sessões num cookie assinado (`HttpOnly`, `SameSite=Lax`), válidas 180 dias. Mudar a palavra-passe ou desativar a conta termina as sessões.
- Pedidos que alteram dados exigem o cabeçalho `X-Manutencao` (protege contra formulários de outros sites).
- Tentativas de entrada limitadas: 10 por conta e 30 por endereço em 15 minutos.
- As notificações só são enviadas para os serviços oficiais (Google, Apple, Mozilla, Microsoft) e vão cifradas (RFC 8291).

---

## Para programadores

```bash
npm install
echo "PUSH_ANY_ENDPOINT=1" > .dev.vars   # só nos testes locais
npm run dev     # http://localhost:8787
npm test
```

- `public/`: a aplicação no browser (HTML, CSS e módulos JavaScript, sem build). `sw.js` recebe as notificações.
- `public/js/dates.js` e `public/js/kdf.js`: usados no browser e no servidor.
- `worker/`: o servidor (`index.js` recebe os pedidos e corre a verificação de hora a hora; `api*.js` são as operações; `push.js` cifra e envia as notificações; `notify.js` decide quando avisar).
