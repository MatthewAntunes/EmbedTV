# Documentação do EmbedTV Ao Vivo para Nuvio

## Visão geral

Este projeto é um **addon HTTP para o Nuvio**, construído em Node.js com
Express. Embora seja comum chamá-lo informalmente de "plugin", tecnicamente ele
funciona como um servidor de addon: o Nuvio acessa endpoints públicos para
obter o manifest, os catálogos, os dados dos canais e as opções de reprodução.

O projeto não armazena vídeos nem cria transmissões. Ele consulta a API pública
da EmbedTV, organiza os canais em categorias e tenta resolver a transmissão no
momento em que o usuário escolhe um canal.

Endereço atualmente usado pelo Nuvio:

```text
https://embedtv-nuvio.onrender.com/manifest.json
```

Repositório do código:

```text
https://github.com/MatthewAntunes/EmbedTV
```

## O que o addon faz

- Consulta `https://embedtv.lat/api/channels` para obter os canais disponíveis.
- Converte os canais para o formato de catálogo reconhecido pelo Nuvio.
- Organiza os resultados em categorias como Globo, Band, Premiere, Telecine,
  HBO, ESPN, SporTV, notícias, esportes, infantil e outras.
- Fornece nome, logo, descrição, gênero e identificador de cada canal.
- Aceita a busca enviada pelo Nuvio nos endpoints de catálogo.
- Tenta localizar a playlist HLS do canal somente quando a reprodução é
  solicitada.
- Quando encontra uma playlist, gera uma URL temporária e assinada para o proxy.
- Reescreve playlists HLS para que segmentos e playlists secundárias continuem
  passando pelo servidor.
- Oferece como alternativa o endereço do player original da EmbedTV.

A quantidade e a disponibilidade dos canais não são fixas. Elas dependem da
resposta atual da API da EmbedTV.

## Como o fluxo funciona

O funcionamento normal acontece nesta ordem:

1. O Nuvio lê `/manifest.json` e identifica os recursos e catálogos oferecidos.
2. Ao abrir uma categoria, o Nuvio consulta `/catalog/tv/:catalogId.json`.
3. O servidor busca os canais da API da EmbedTV, aplica a categoria e devolve
   os resultados no formato esperado pelo Nuvio.
4. Ao abrir um canal, o Nuvio pode consultar `/meta/tv/:channelId.json`.
5. Ao pressionar reproduzir, o Nuvio chama `/stream/tv/:channelId.json`.
6. O servidor tenta resolver o endereço HLS real do canal.
7. Se a resolução funcionar, o servidor entrega uma URL `/proxy/:token` para
   reprodução dentro do Nuvio.
8. O proxy valida a assinatura, baixa a playlist ou segmento e o retransmite ao
   aplicativo.

As URLs do proxy têm validade limitada e não devem ser salvas como links
permanentes. O canal deve ser resolvido novamente em cada reprodução.

## Arquivos principais

### `server.js`

É o servidor do addon. Contém:

- consulta e cache do catálogo remoto;
- regras das categorias;
- endpoints do protocolo usado pelo Nuvio;
- resolução do stream;
- assinatura e validação das URLs temporárias;
- proxy e reescrita das playlists HLS;
- validações contra destinos locais ou privados.

### `manifest.json`

É a apresentação do addon para o Nuvio. Declara nome, identificador, versão,
tipos, recursos e catálogos disponíveis. Esse arquivo **não executa código e não
transmite vídeos**; ele apenas informa ao aplicativo quais endpoints existem.

### `package.json`

Define o projeto Node.js, suas dependências e os comandos `npm start` e
`npm run check`.

### `README.md`

Contém as instruções resumidas de instalação, execução e publicação.

## Endpoints disponíveis

| Caminho | Função |
| --- | --- |
| `/manifest.json` | Descreve o addon para o Nuvio. |
| `/health` | Verifica o servidor e consulta a quantidade atual de canais. |
| `/catalog/tv/:catalogId.json` | Retorna os canais de uma categoria. |
| `/meta/tv/:channelId.json` | Retorna os detalhes de um canal. |
| `/stream/tv/:channelId.json` | Tenta resolver as opções de reprodução. |
| `/proxy/:token` | Retransmite uma playlist ou um segmento autorizado. |

## Reprodução interna e player externo

Para tocar dentro do Nuvio, o aplicativo precisa receber uma URL direta de
mídia, normalmente uma playlist `.m3u8`. Uma página HTML com um player não é
uma mídia reproduzível diretamente pelo player interno.

O addon atualmente pode devolver duas opções:

- `url`: endereço do proxy para tentar reproduzir o HLS dentro do Nuvio;
- `externalUrl`: página original do canal, aberta fora do player interno.

O `externalUrl` existe como alternativa porque a hospedagem atual do Render
fica fora do Brasil e algumas origens utilizadas pela EmbedTV não respondem ou
não resolvem corretamente nesse datacenter. Quando isso acontece, o catálogo e
os metadados aparecem normalmente, mas o servidor não consegue entregar os
segmentos de vídeo ao Nuvio.

Reescrever somente o `manifest.json` não corrige esse bloqueio. O manifest não
resolve a mídia e o GitHub não funciona como proxy de vídeo.

## GitHub e hospedagem

O GitHub guarda e versiona o código-fonte. O Render está conectado ao
repositório e executa o servidor Node.js publicado nele.

O fluxo de atualização é:

1. Alterar e testar os arquivos localmente.
2. Conferir as mudanças com `git status` e `git diff`.
3. Criar um commit com `git add` e `git commit`.
4. Enviar o commit com `git push origin main`.
5. Aguardar o Render detectar o commit e concluir o novo deploy.
6. Validar `/health`, `/manifest.json` e um canal no Nuvio.

Exemplo:

```bash
git status
git add server.js manifest.json README.md DOCUMENTACAO.md
git commit -m "Descrever a alteração"
git push origin main
```

O endereço abaixo mostra apenas o conteúdo estático do manifest salvo no
GitHub:

```text
https://raw.githubusercontent.com/MatthewAntunes/EmbedTV/refs/heads/main/manifest.json
```

Ele não inicia o Express, não oferece os endpoints de catálogo e stream e não
executa `server.js`. Por isso, o endereço que deve ser instalado no Nuvio é o do
servidor no Render, e não o endereço `raw.githubusercontent.com`.

## Execução local

Requisitos: Node.js 18 ou mais recente e NPM.

```bash
git clone https://github.com/MatthewAntunes/EmbedTV.git
cd EmbedTV
npm install
npm start
```

O servidor ficará disponível em:

```text
http://localhost:3100
```

Manifest local:

```text
http://localhost:3100/manifest.json
```

Teste básico:

```text
http://localhost:3100/health
```

O endereço `localhost` só funciona para programas que conseguem acessar o mesmo
computador. Para outros aparelhos, é necessário um endereço público HTTPS ou
um endereço da rede local que seja alcançável por eles.

## Configuração do Render

Configuração usada pelo serviço:

```text
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

Variáveis recomendadas:

```text
NODE_ENV=production
PUBLIC_URL=https://embedtv-nuvio.onrender.com
PROXY_SECRET=UM_SEGREDO_LONGO_E_ALEATORIO
REQUEST_TIMEOUT_MS=10000
```

O valor real de `PROXY_SECRET` deve permanecer apenas nas variáveis privadas do
Render. Ele nunca deve ser incluído no GitHub.

## Segurança e limites

- O proxy aceita somente tokens assinados pelo servidor.
- URLs com credenciais e destinos locais ou privados são rejeitados.
- Todo o tráfego reproduzido pelo proxy consome banda da hospedagem.
- A disponibilidade depende da API e dos servidores externos da EmbedTV.
- Alterações feitas pela origem podem interromper a resolução sem que o addon
  tenha sido alterado.
- O serviço deve ser usado somente com conteúdo cuja reprodução e distribuição
  estejam autorizadas.

## Diagnóstico rápido

Se os canais não aparecerem, verificar:

- se `/health` responde;
- se a API da EmbedTV está disponível;
- se o deploy mais recente do Render terminou sem erro;
- se o manifest instalado é o endereço público correto.

Se os canais aparecerem, mas não reproduzirem internamente, verificar:

- a resposta de `/stream/tv/:channelId.json`;
- os logs de resolução e proxy no Render;
- se o host do HLS pode ser resolvido e acessado pelo datacenter do Render;
- se a origem exige cabeçalhos, cookies, região ou sessão específica.

Se a opção “Abrir player original” funcionar, mas o stream interno não, isso
indica que a página pública está acessível, porém a mídia direta não pôde ser
entregue pelo servidor hospedado.
