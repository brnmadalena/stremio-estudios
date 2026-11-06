# Estúdios BR, addon de catálogo para o Stremio

Mostra filmes e séries organizados por estúdio (Marvel, Pixar, A24 e outros), com títulos e capas em português do Brasil. Roda 100% no GitHub, sem servidor: uma rotina diária consulta o TMDB, gera os arquivos do catálogo e publica no GitHub Pages.

## Como funciona

1. O GitHub Actions roda `scripts/build.mjs` todo dia (e quando você pedir).
2. O script busca no TMDB os títulos de cada estúdio listado em `studios.json`, já em `pt-BR`, e converte cada um para o código do IMDb, que é o que o Stremio usa.
3. O resultado vira arquivos JSON estáticos, publicados no GitHub Pages.
4. No Stremio, o addon aparece em **Descobrir**, com um filtro para escolher o estúdio.

## Publicar, passo a passo

**1. Criar o repositório.** No GitHub, crie um repositório **público** (por exemplo `stremio-estudios`) e envie todos os arquivos desta pasta, incluindo a pasta oculta `.github`. Pelo site, use *Add file > Upload files* e arraste tudo. A branch principal deve se chamar `main`.

**2. Guardar a chave do TMDB.** No repositório, vá em *Settings > Secrets and variables > Actions > New repository secret*. Nome: `TMDB_API_KEY`. Valor: sua chave de API (v3) do TMDB, que fica em *Configurações > API* na sua conta do TMDB. Não coloque a chave em nenhum arquivo.

**3. Ligar o GitHub Pages.** Em *Settings > Pages*, em **Source**, escolha **GitHub Actions**.

**4. Rodar pela primeira vez.** Vá na aba *Actions*, escolha **Atualizar addon** e clique em *Run workflow*. A primeira execução é a mais demorada (alguns minutos), porque monta o cache de IDs. As seguintes são rápidas.

**5. Instalar no Stremio.** Abra `https://SEU_USUARIO.github.io/NOME_DO_REPOSITORIO/` no navegador. A página tem os botões de instalar. Ou, no Stremio, vá em *Addons*, cole o endereço abaixo e confirme:

```
https://SEU_USUARIO.github.io/NOME_DO_REPOSITORIO/manifest.json
```

Como o addon fica no seu Stremio, ele aparece também no celular e na TV da mesma conta. Se alguma plataforma não sincronizar, instale pelo mesmo link nela.

**6. Conferir (opcional).** Com o Node instalado, rode:

```
node scripts/verify.mjs https://SEU_USUARIO.github.io/NOME_DO_REPOSITORIO
```

Ele pede as URLs do mesmo jeito que o Stremio e confere todos os estúdios e páginas.

## Personalizar

Tudo está em `studios.json`.

- **Estúdios:** cada item tem `name` (como aparece no menu), `ids` (IDs de empresa do TMDB, de `themoviedb.org/company/ID`) e `expect`, um texto que o nome da empresa precisa conter. Se o ID não bater com o `expect`, o script ignora e avisa no log. Também dá para usar `search`, uma lista de nomes exatos para o script procurar sozinho (como foi feito com a DC Studios e a MGM).
- **Linhas na tela inicial:** coloque nomes em `featured`, por exemplo `["Marvel Studios", "Pixar"]`. Cada um vira uma linha própria além do menu do Descobrir.
- **Quantidade:** `maxItems` é o máximo de títulos por estúdio e tipo (padrão 300). `minVotes` filtra títulos com poucos votos no TMDB.
- **Nomes de estúdio** não podem ter `/ \ ? # % & = :` nem ponto no final, porque viram nomes de arquivo.

Depois de editar, o workflow roda sozinho ao salvar o `studios.json` na branch `main`. Se mudar a lista de estúdios, reinstale o addon no Stremio para ele reler o menu.

## Limites e cuidados

- Os dados atualizam uma vez por dia, não em tempo real.
- Não há configuração por usuário: a lista é a que estiver no repositório.
- Nomes e descrições vêm em pt-BR. As capas usam a versão em português quando o TMDB tem uma, e a capa padrão quando não tem. O TMDB não separa português do Brasil e de Portugal nas imagens.
- Títulos sem código do IMDb ou sem capa ficam de fora, porque o Stremio não consegue abrir os detalhes deles.
- O repositório precisa ser público no plano gratuito do Pages. A chave do TMDB continua protegida no Secret.
- Repositórios sem atividade por muito tempo podem ter a rotina agendada pausada pelo GitHub. Se acontecer, reative em *Actions*.

## Se algo der errado

- **Erro 401 no log:** a chave do `TMDB_API_KEY` está errada ou vazia.
- **Aviso "empresa X não bate":** o ID do `studios.json` não corresponde ao estúdio. Confira em `themoviedb.org/company/ID` e corrija.
- **Estúdio sem nenhum título:** veja a linha do estúdio no log do workflow, que mostra quais empresas foram encontradas.
- **Pages não publica:** confirme que *Settings > Pages > Source* está em **GitHub Actions**.
- **Estúdio com espaço no nome (como "20th Century Fox") não abre no Stremio:** rode o `verify.mjs` no endereço publicado e me mande o resultado.

## Teste local

`node test/run.mjs` roda o gerador contra um TMDB simulado e confere manifest, paginação, nomes com espaço, cache e capas, sem usar sua chave.

## Créditos

Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB. Dados e imagens: [The Movie Database](https://www.themoviedb.org).
