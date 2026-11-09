# Notas para o Claude

Aplicação de tarefas de manutenção e orçamentos das casas da HD Properties, com a mesma identidade da aplicação da frota (`guilhermehdproperties/frota-hd`). Quem a pediu fala português de Portugal e não é técnico: explicar em termos simples e **falar antes de executar** passos com efeitos fora do repositório.

## Arquitetura
- Cloudflare Workers (plano gratuito): `worker/` + ecrãs estáticos em `public/`. D1 `manutencao-hd` (`DB`), KV `manutencao-hd-ficheiros` (`FILES`) para os documentos dos orçamentos, cron de hora a hora (`10 * * * *`) para os avisos das 8h. IDs em `wrangler.toml`.
- Cada push para `main` é publicado pela integração GitHub da Cloudflare (Workers Builds).
- Contas por pessoa (`users`, papéis `admin` e `equipa`). Não há segredos na Cloudflare: o segredo das sessões (`session_secret`) e as chaves VAPID (`vapid`) ficam na tabela `settings`, criados na primeira utilização.
- A palavra-passe é reforçada no browser (`public/js/kdf.js`, PBKDF2 com o nome de utilizador como sal) e o servidor só recebe essa chave; por isso o nome de utilizador não se pode mudar depois de criado.
- Convites: link `/convite#<token>` de uso único, 7 dias; na D1 guarda-se só o SHA-256 do token. Para criar a primeira conta de administração (ou recuperar o acesso se a única pessoa da administração se esquecer da palavra-passe), inserir na D1 a pessoa e um convite com o resumo de um token novo e dar o link à pessoa. Nunca escrever tokens no repositório.
- Notificações: Web Push com VAPID e cifra aes128gcm (`worker/push.js`, testada com o exemplo do RFC 8291). Só se aceitam endereços de subscrição dos serviços conhecidos (Google, Apple, Mozilla, Microsoft); `PUSH_ANY_ENDPOINT=1` só em `.dev.vars` para testes locais.

## Regras do negócio
- Tarefas: vermelho por fazer, verde feita (botão verde "Concluir"). `assignee_id` vazio = **Todos** (toda a equipa ativa vê e qualquer pessoa conclui ou "fica com ela"). A equipa vê as suas e as de todos; a administração vê todas e filtra por pessoa ou "Para todos".
- Quem vê uma tarefa aberta pode mudar a data, a hora e a pessoa (`POST /api/tasks/:id/move`); título, notas, casa e apagar só a administração ou quem a criou. Todas as mudanças ficam em `task_events` e aparecem no histórico da tarefa.
- Avisos: tarefa nova ou passada (a quem a recebe; nas de todos, à equipa), data mudada (a quem a tem), tarefas do dia às 8h de Lisboa (uma vez por tarefa, pessoa e dia), tarefa concluída (à administração e, nas de todos, ao resto da equipa), relatório pronto no dia 1 (à administração). Das mudanças, nunca se avisa quem as fez nem a administração (exceto se a tarefa for dela).
- Relatório mensal (`worker/report.js`): tarefas com data no mês; feita a tempo se concluída até ao dia marcado (Lisboa), não feita se a data passou sem estar concluída. As tarefas de uma pessoa contam para ela; as de todos para quem as fez (ou "Para todos (por concluir)"). Adiamentos = mudanças de data para um dia mais tarde, contadas para quem as fez.
- As casas começam vazias; quem usa a aplicação acrescenta-as.
- Orçamentos (pipeline, `public/js/stages.js`): `pedido` → `por_decidir` → `aprovado` → `feito` → `pago`, ou `recusado`. A equipa só passa um pedido a por decidir ("Já chegou") e um aprovado a feito ("Trabalho feito"); aprovar, recusar, pagar e corrigir a fase é da administração. Cada mudança fica em `quote_events` (histórico).
- Orçamentos do mesmo trabalho partilham `group_id` (o id do primeiro); ao aprovar um, os outros ainda em pedido ou por decidir passam a recusados. Ao aprovar pode criar-se a tarefa de acompanhar (`tasks.quote_id`).
- Fornecedores na tabela `suppliers` (nome único sem distinguir maiúsculas); `quotes.supplier` guarda também o nome. Qualquer pessoa cria e atualiza contactos; arquivar é da administração. WhatsApp só para telemóveis portugueses (9xx) ou números com indicativo.
- Gastos (só administração, `worker/spending.js`): orçamentos pagos no ano pela data do pagamento e pelo valor final (`final_amount`, ou o orçado se não houver).
- Avisos dos orçamentos: por decidir e trabalho feito (à administração); aprovado e recusado (a quem o registou); pedido há 7 dias sem resposta (uma vez, a quem o pediu). Nunca a quem fez a mudança.
- Documentos dos orçamentos (`files.kind`: orcamento, fatura, outro) no KV; qualquer pessoa junta, apagar só quem juntou, quem registou o orçamento ou a administração.
- A base de dados atualiza-se sozinha no arranque (`worker/db.js`: `migrate` e `migrateAfter`, só acrescentam colunas ou copiam dados). Nunca apagar tabelas da D1 de produção.

## Trabalhar no código
- `npm test` e `npm run dev` (com `.dev.vars`).
- Textos da interface em português de Portugal, no tom já usado, e **sem género gramatical para as pessoas** (não se sabe como cada uma prefere ser tratada): "Olá, Ana!", "Conta de administração", "recebe um aviso", em vez de "Bem-vindo", "o administrador" ou "é avisado".
- Todo o HTML do browser passa pelo `html` de `public/js/core.js` (escapa os valores automaticamente).
