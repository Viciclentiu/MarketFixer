# MarketFixer frontend

Landing page-ul folosește React, Vite și SCSS.

```sh
cd frontend
npm install
npm run dev
```

Serverul de dezvoltare trimite cererile API către backend-ul de pe portul 4000. Pornește backendul separat cu `npm run dev` din directorul `backend`. Pentru a actualiza fișierele servite de backend, rulează `npm run build`. Linkurile vechi către `/audit.html` sunt redirecționate către noua pagină de analiză, păstrând adresa site-ului.

Formularul de pe pagina principală pornește analiza și deschide raportul la `/?view=audit&scan=<id>`. Pentru o analiză nouă sau istoricul scanărilor, deschide `/?view=audit`. Raportul include progres, scoruri, constatări cu dovezi, filtre, comparații cu scanări anterioare ale aceleiași adrese și analiza fișierelor CSV. Linkul unei scanări poate fi redeschis după reîncărcarea paginii.

Secțiunea de statistici reproduce valorile și atribuirea din Figma; acestea sunt repere editoriale, nu rezultate ale scanării curente.

Testul de integrare din `test/audit.test.mjs` rulează cu `node --test test/audit.test.mjs`, după build. Setează `PLAYWRIGHT_MODULE` la pachetul Playwright instalat; testul folosește Microsoft Edge, un server temporar, SQLite în memorie și un site de probă. Verifică pornirea scanării, raportul, filtrele, CSV, comparația, reîncărcarea, recuperarea după o eroare de conexiune și afișarea pe mobil. Capturile sunt salvate în `test-output/`. Fără variabila configurată, testul este omis.
