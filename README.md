# EmbedTV Live para Nuvio

Servidor experimental em Node.js que transforma o catálogo da EmbedTV em um
addon de canais ao vivo compatível com o protocolo utilizado pelo Nuvio.

O servidor consulta o catálogo remoto, organiza os canais em coleções, resolve
o stream somente no momento da reprodução e entrega playlists HLS por meio de
um proxy com URLs temporárias assinadas.

## Instalar no Nuvio

Use o endereço público abaixo na área de addons do Nuvio:

```text
https://embedtv-nuvio.onrender.com/manifest.json
```

O serviço usa uma instância gratuita do Render. Após um período sem acessos, a
primeira abertura pode levar aproximadamente 50 segundos enquanto a instância
é reativada.

## Recursos

- Catálogo com 141 canais no momento da última validação.
- Logos, previews, nomes e categorias dos canais.
- Catálogos separados por gênero e por rede.
- Busca de canais pelo Nuvio.
- Resolução do stream sob demanda.
- Opção de player externo para origens que bloqueiam datacenters estrangeiros.
- Suporte a playlists HLS com extensão `.m3u8` ou `.txt`.
- Reescrita de playlists, segmentos e URLs relativas.
- Detecção de segmentos MPEG-TS com extensões não convencionais.
- Proxy protegido por assinatura HMAC e bloqueio de destinos de rede privados.
- Cache curto para reduzir chamadas repetidas ao serviço de origem.

## Catálogos

O manifest disponibiliza atualmente as seguintes coleções:

- Todos os canais
- Globo
- Band
- Premiere
- Telecine
- HBO
- ESPN
- SporTV
- CazéTV
- Discovery
- Disney
- Record
- SBT
- Esportes
- 24 Horas
- Canais abertos
- Notícias
- Infantil
- Filmes e Séries
- Documentários
- Variedades
- Portugal

Um canal pode aparecer em mais de uma coleção. A quantidade e a disponibilidade
dos canais dependem do catálogo remoto e podem mudar sem aviso.

## Requisitos

- Node.js 18 ou mais recente.
- NPM.
- Uma instalação do Nuvio compatível com addons por manifest HTTP.

## Executar localmente

```bash
git clone https://github.com/MatthewAntunes/EmbedTV.git
cd EmbedTV
npm install
npm start
```

O servidor local será iniciado em `http://localhost:3100`.

Para testar especificamente a versão local no Nuvio, use:

```text
http://localhost:3100/manifest.json
```

Para verificar o funcionamento, abra:

```text
http://localhost:3100/health
```

Resposta esperada:

```json
{
  "ok": true,
  "channels": 141,
  "categories": 9
}
```

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `PORT` | Não | `3100` | Porta HTTP utilizada pelo servidor. |
| `PUBLIC_URL` | Em produção | URL da requisição | URL pública HTTPS, sem barra no final. |
| `PROXY_SECRET` | Em produção | Temporário | Segredo longo usado para assinar as URLs do proxy. |
| `REQUEST_TIMEOUT_MS` | Não | `10000` | Timeout das consultas externas em milissegundos. |

Exemplo local com PowerShell:

```powershell
$env:PROXY_SECRET = "troque-por-um-segredo-longo-e-aleatorio"
npm start
```

Nunca salve o valor real de `PROXY_SECRET` no repositório.

## Publicar no Render

1. Crie uma conta no [Render](https://render.com/).
2. Selecione **New > Web Service**.
3. Conecte o repositório `MatthewAntunes/EmbedTV`.
4. Configure o serviço:

```text
Language: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

5. Cadastre as variáveis:

```text
NODE_ENV=production
PUBLIC_URL=https://embedtv-nuvio.onrender.com
PROXY_SECRET=UM_SEGREDO_LONGO_E_ALEATORIO
REQUEST_TIMEOUT_MS=10000
```

6. Para este deploy, o endereço de instalação no Nuvio é:

```text
https://embedtv-nuvio.onrender.com/manifest.json
```

O Render define `PORT` automaticamente. Não é necessário cadastrar essa
variável manualmente.

## Endpoints

| Endpoint | Descrição |
| --- | --- |
| `/manifest.json` | Manifest do addon. |
| `/health` | Estado do servidor e quantidade de canais. |
| `/catalog/tv/:catalogId.json` | Lista os canais de um catálogo. |
| `/meta/tv/:channelId.json` | Retorna os metadados de um canal. |
| `/stream/tv/:channelId.json` | Resolve o stream do canal. |
| `/proxy/:token` | Entrega playlists e segmentos usando um token assinado. |

Exemplos:

```text
/catalog/tv/embedtv-globo.json
/catalog/tv/embedtv-esportes.json
/meta/tv/embedtv:cultura.json
/stream/tv/embedtv:cultura.json
```

## Estrutura da resposta de stream

```json
{
  "streams": [
    {
      "name": "EmbedTV Ao Vivo",
      "title": "▶ Cultura",
      "url": "https://servidor.exemplo/proxy/TOKEN_TEMPORARIO"
    }
  ]
}
```

As URLs do proxy são temporárias. O addon resolve novamente a origem quando o
usuário inicia a reprodução.

## Segurança e operação

- O proxy aceita apenas URLs assinadas pelo próprio servidor.
- Destinos HTTP, endereços privados, hosts locais e URLs com credenciais são rejeitados.
- Defina um `PROXY_SECRET` permanente em produção.
- Não exponha chaves ou arquivos `.env` no GitHub.
- Monitore memória, banda e número de conexões antes de ampliar o acesso.
- O proxy retransmite o conteúdo; todo o tráfego de vídeo passa pela hospedagem.

Um stream de aproximadamente 5 Mbps pode consumir cerca de 2,25 GB por hora por
usuário. Verifique os limites e custos de transferência da hospedagem escolhida.

## Aviso

Este projeto não hospeda arquivos de vídeo. Ele organiza informações fornecidas
por uma fonte externa e atua como intermediário técnico durante a reprodução.

Use o servidor somente com transmissões para as quais você possua autorização de
acesso e distribuição. A disponibilidade, estabilidade e legalidade das fontes
externas são responsabilidade de seus respectivos operadores e de quem publica
o serviço.
