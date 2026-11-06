# Studio, a catalog addon for Stremio

Shows movies and series organized by studio (Marvel, Pixar, A24 and more), with titles and posters in Brazilian Portuguese. It runs 100% on GitHub, with no server: a daily job queries TMDB, generates the catalog files and publishes them to GitHub Pages.

## How it works

1. GitHub Actions runs `scripts/build.mjs` every day (and whenever you ask).
2. The script fetches the titles of every studio listed in `studios.json` from TMDB, already in `pt-BR`, and maps each one to its IMDb id, which is what Stremio uses.
3. The result becomes static JSON files, published on GitHub Pages.
4. In Stremio, the addon shows up under **Discover**, with a filter to pick the studio.

## Publish, step by step

**1. Create the repository.** On GitHub, create a **public** repository (for example `stremio-studio-addon`) and upload every file in this folder, including the hidden `.github` folder. On the website, use *Add file > Upload files* and drag everything in. The main branch must be named `main`.

**2. Store the TMDB key.** In the repository, go to *Settings > Secrets and variables > Actions > New repository secret*. Name: `TMDB_API_KEY`. Value: your TMDB API key (v3), found under *Settings > API* in your TMDB account. Do not put the key in any file.

**3. Turn on GitHub Pages.** In *Settings > Pages*, under **Source**, choose **GitHub Actions**.

**4. Run it for the first time.** Go to the *Actions* tab, choose **Update addon** and click *Run workflow*. The first run is the slowest (a few minutes) because it builds the ID cache. Later runs are fast.

**5. Install in Stremio.** Open `https://YOUR_USERNAME.github.io/REPOSITORY_NAME/` in a browser. The page has install buttons. Or, in Stremio, go to *Addons*, paste the address below and confirm:

```
https://YOUR_USERNAME.github.io/REPOSITORY_NAME/manifest.json
```

Since the addon lives in your Stremio account, it also shows up on your phone and TV. If a platform does not sync, install it there with the same link.

**6. Check it (optional).** With Node installed, run:

```
node scripts/verify.mjs https://YOUR_USERNAME.github.io/REPOSITORY_NAME
```

It requests the URLs the same way Stremio does and checks every studio and page.

## Customize

Everything lives in `studios.json`.

- **Studios:** each item has `name` (as shown in the menu), `ids` (TMDB company IDs, from `themoviedb.org/company/ID`) and `expect`, a pattern the company name must match. If an ID does not match `expect`, the script ignores it and warns in the log. You can also use `search`, a list of exact names the script looks up on its own (as done for DC Studios and MGM).
- **Home screen rows:** put names in `featured`, for example `["Marvel Studios", "Pixar"]`. Each one becomes its own row in addition to the Discover menu.
- **Amount:** `maxItems` is the maximum number of titles per studio and type (default 300). `minVotes` filters out titles with very few votes on TMDB.
- **Studio names** cannot contain `/ \ ? # % & = :` or end with a dot, because they become file names.

After editing, the workflow runs on its own when `studios.json` is saved on the `main` branch. If you change the list of studios, reinstall the addon in Stremio so it rereads the menu.

## Limits and notes

- Data updates once a day, not in real time.
- There is no per-user setup: the list is whatever is in the repository.
- Titles and descriptions come in pt-BR. Posters use the Portuguese version when TMDB has one, and the default poster otherwise. TMDB does not separate Brazilian and European Portuguese for images.
- Titles without an IMDb id or without a poster are left out, because Stremio cannot open their details.
- The repository must be public on the free Pages plan. The TMDB key stays protected in the Secret.
- GitHub may pause scheduled jobs in repositories with no activity for a long time. If that happens, re-enable it under *Actions*.

## Troubleshooting

- **401 error in the log:** the `TMDB_API_KEY` secret is wrong or empty.
- **Warning "company X does not match":** the ID in `studios.json` does not correspond to the studio. Check `themoviedb.org/company/ID` and fix it.
- **A studio with no titles:** check the studio's line in the workflow log, which shows which companies were found.
- **Pages does not publish:** confirm that *Settings > Pages > Source* is set to **GitHub Actions**.
- **A studio with a space in its name (like "20th Century Fox") does not open in Stremio:** run `verify.mjs` against the published address and check the output.

## Local test

`node test/run.mjs` runs the generator against a simulated TMDB and checks the manifest, pagination, names with spaces, cache and posters, without using your key.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB. Data and images: [The Movie Database](https://www.themoviedb.org).
