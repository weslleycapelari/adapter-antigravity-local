/home/weslleycapelari/projects/adapter-antigravity-local
├── src
│   ├── cli
│   │   ├── format-event.ts        # Formatador visual do stdout/stream (adaptado para o output do agy)
│   │   └── index.ts
│   ├── server
│   │   ├── execute.remote.test.ts # Testes de ambiente remoto/SSH
│   │   ├── execute.ts             # Core: Spawn do processo `agy`, args, env vars e bridging
│   │   ├── index.ts               # Codecs de sessão e exports do servidor
│   │   ├── parse.test.ts          # Testes para cobrir o novo formato JSONL do Antigravity
│   │   ├── parse.ts               # Parser do stdout, erros e metadados de tokens do Antigravity
│   │   ├── skills.ts              # Gerenciador de injeção de skills (novo path de plugins do agy)
│   │   ├── test.ts                # Probes de ambiente (instalação do agy, verificação de auth)
│   │   └── utils.ts
│   ├── ui
│   │   ├── build-config.ts        # Definição dos campos de configuração na interface do Paperclip
│   │   ├── index.ts
│   │   ├── parse-stdout.test.ts
│   │   └── parse-stdout.ts        # Mapeamento do JSON do agy para TranscriptEntries do Paperclip
│   └── index.ts                   # Entrypoint do Adapter: Definição de IDs, modelos e docs
├── package.json
└── tsconfig.json


Isso é um cenário perfeito. Ter o `agy` já rodando na sua máquina corta 80% do nosso trabalho de adivinhação, porque você pode ser os nossos "olhos" para capturar exatamente o que a nova engine cospe no terminal.

Para que a migração seja sólida e a gente não quebre dependências circulares do Paperclip, a melhor ordem de implementação é de "fora para dentro" — ou seja, começamos configurando como o adapter é visto pela plataforma e terminamos no miolo que processa os dados do Antigravity.

Aqui está a ordem de ataque que sugiro para gerarmos e substituirmos os arquivos:

### FASE 1: Fundações e Configuração

Esses arquivos são estáticos e definem a "cara" do adapter para o Paperclip.

1. `src/index.ts` *(Já definimos no passo anterior)*
2. `src/ui/build-config.ts` *(Mapeia as variáveis de ambiente e argumentos para a UI do Paperclip)*
3. `src/ui/index.ts` e `src/cli/index.ts` *(Apenas arquivos de exportação limpos)*

### FASE 2: O Motor de Execução

Aqui é onde o processo Node.js invoca o seu binário local do `agy`.
4.  `src/server/utils.ts` *(Funções de apoio estáticas)*
5.  `src/server/execute.ts` *(O coração do adapter: monta os argumentos, injeta as env vars como `ANTIGRAVITY_API_KEY` e faz o spawn do processo)*
6.  `src/server/index.ts` *(Define o Codec de sessão, ou seja, como o adapter lembra do contexto de uma conversa para a outra)*

### FASE 3: Parsers e Formatadores (Missão Crítica)

É aqui que vamos precisar da sua ajuda com o console local. Precisamos traduzir a saída bruta do Antigravity para a linguagem do Paperclip.
7.  `src/server/parse.ts` *(Lê o JSONL do `agy` e extrai tokens, erros e o resumo da mensagem)*
8.  `src/ui/parse-stdout.ts` *(Gera a transcrição em tempo real para a interface gráfica)*
9.  `src/cli/format-event.ts` *(Pinta o terminal com cores usando `picocolors` quando rodado via CLI)*

### FASE 4: Ambiente e Plugins

10. `src/server/skills.ts` *(A nova lógica de injeção de plugins/skills do Antigravity)*
11. `src/server/test.ts` *(O probe que roda no início para garantir que o `agy` está instalado e autenticado)*

### FASE 5: Testes Unitários

12. Arquivos `.test.ts` *(Vamos atualizar os mocks e testes no final, quando o novo schema JSON estiver validado)*

---

### Onde preciso da sua ajuda agora (Para a Fase 3)

Como o `agy` é novo, preciso ter certeza de qual é o schema exato do JSON que ele joga no `stdout`. No `gemini-cli`, a gente usava `--output-format stream-json`.

Você poderia rodar um teste básico no seu terminal e me mandar a saída completa? Tente rodar algo assim (ajuste a flag de formato se o `agy` usar um padrão diferente, talvez dê um `agy --help` rápido se o comando abaixo falhar):

```bash
agy "Apenas diga ola e nada mais" --output-format=stream-json

```

Me manda o JSON exato que ele retornar. Isso vai garantir que os nossos arquivos `parse.ts` (Fase 3) não quebrem na hora de ler mensagens, roles e contagem de tokens. Quer que eu já te mande o código da FASE 1 e FASE 2 enquanto você faz esse teste?