# Gaia

Galleria infinita in stile postcards.mono.studio con poesie, cartoline e foto.

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # sito statico in dist/ (caricabile su Netlify, Vercel, GitHub Pages…)
```

## Aggiungere contenuti

- `content/poesie/*.txt` — una poesia per file, scritta a penna blu su carta gialla a righe rosse.
  Titolo facoltativo: prima riga che inizia con `# ` (es. `# Favignana`). Le righe lunghe vanno a capo da sole, quindi la prosa si scrive un paragrafo per riga.
  Una riga con solo `---` fa iniziare una pagina nuova; oltre 18 righe la pagina va a capo da sola.
  Le poesie non si girano: se hanno più pagine si sfogliano con le frecce, trascinando o con ← →.
- `content/cartoline/` — immagini (jpg, png, webp). Verticali e orizzontali vanno bene tutte e due.
- `content/foto/` — come sopra.
- Retro di una cartolina, due modi (vale anche per le foto):
  - `nome-retro.txt` accanto a `nome.jpg`: il testo viene scritto a penna blu sul retro, con francobollo e righe dell'indirizzo. Gli a capo restano come li scrivi.
  - `nome-retro.jpg`: la foto del retro vero (vince sul .txt se ci sono entrambi).
  Senza retro, sul dorso compare il nome del file.

Il nome dei file (senza numeri iniziali) diventa la didascalia: `03-roma-2024.jpg` → "roma 2024".
Le immagini di prova in `content/` vanno cancellate.

Nota: le foto dell'iPhone in formato HEIC vanno esportate in JPG prima.
