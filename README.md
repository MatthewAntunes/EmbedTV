# EmbedTV Live para Nuvio

Servidor local de teste que transforma o catálogo público da EmbedTV em um
catálogo `tv` compatível com o protocolo de addons usado pelo Nuvio.

## Executar

```powershell
npm install
npm start
```

No Nuvio, instale:

```text
http://localhost:3100/manifest.json
```

Para testar no navegador:

```text
http://localhost:3100/health
http://localhost:3100/catalog/tv/embedtv-live.json
```

Variáveis opcionais:

- `PORT`: porta HTTP, padrão `3100`.
- `PUBLIC_URL`: endereço público do servidor quando executado atrás de proxy.
- `PROXY_SECRET`: segredo longo e permanente usado para assinar URLs do proxy.
- `REQUEST_TIMEOUT_MS`: timeout das consultas externas, padrão `10000`.

As URLs dos streams são temporárias e são resolvidas novamente ao iniciar a
reprodução. Use apenas fontes para as quais você tenha autorização de acesso.
