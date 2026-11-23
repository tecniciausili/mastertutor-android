// Prova automatica dell'APK nell'emulatore (o su un tablet collegato con adb), con l'APK di debug
// installato e aperto (il WebView di debug si può comandare da adb):
//   node strumenti/prova-apk.mjs <cartella suoni .wav> <ip presa 1> <ip presa 2>
// Configura due prese, aggiunge voci e anticipatori, li assegna dai menu della scheda Anticipatore
// e fa una stimolazione con la riproduzione VERA, annotando cosa suona prima di ogni stimolo.
// ATTENZIONE: azzera audio e impostazioni dell'app sul dispositivo di prova.
import { _android as android } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSIONE = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'package.json'), 'utf8')).version;

const [SUONI, IP1, IP2] = process.argv.slice(2);
const esiti = [];
const verifica = (cosa, ok, dettaglio = '') => { esiti.push(ok); console.log(`${ok ? '✓' : '✗'} ${cosa}${dettaglio ? ` — ${dettaglio}` : ''}`); };
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (n) => fs.readFileSync(path.join(SUONI, `${n}.wav`)).toString('base64');

const [dispositivo] = await android.devices();
if (!dispositivo) throw new Error('Nessun dispositivo Android collegato (adb devices)');
const webview = await dispositivo.webView({ pkg: 'it.tecniciausili.mastertutor' });
const pagina = await webview.page();
// Clic e scrittura direttamente nella pagina: con la tastiera del tablet aperta i tocchi simulati
// sullo schermo possono restare bloccati
const clicca = async (sel) => { await pagina.waitForSelector(sel, { state: 'attached' }); await pagina.$eval(sel, (e) => e.click()); };
const scrivi = async (sel, valore) => {
  await pagina.waitForSelector(sel, { state: 'attached' });
  await pagina.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, valore);
};
const errori = [];
pagina.on('pageerror', (e) => errori.push(e.message));
pagina.on('dialog', (d) => d.accept());
await pagina.reload();
await pagina.waitForLoadState('load');
await attendi(1500);

verifica(`APK ${VERSIONE} «nativo», con la nuova scheda`, await pagina.evaluate((v) =>
  APP_CONFIG.versione === v && Util.apk === true && Presa.locale === true && typeof Educatore === 'object', VERSIONE));
verifica('Nessun riferimento ad altri siti nella pagina', !/assistive|aruba/i.test(await pagina.content()));

// Dati di partenza puliti (dispositivo di prova)
await pagina.evaluate(async () => {
  for (const a of await Archivio.audioLista()) await Archivio.audioElimina(a.id);
  localStorage.setItem('mt_impostazioni', '{}');
});

// ---------- Due prese ----------
await clicca('[data-app="educatore"]');
await clicca('[data-scheda="presa"]');
await clicca('[data-azione="presa-configura"]');
await pagina.waitForSelector('.cassetto.active');
await attendi(800);
await scrivi('#cpEmail', 'prova@esempio.it');
await scrivi('#cpPassword', 'prova123');
await pagina.evaluate(() => { document.querySelector('[data-ruolo="righe"]').innerHTML = ''; });
await clicca('[data-cassetto="aggiungi"]');
await clicca('[data-cassetto="aggiungi"]');
await scrivi('.riga-presa:nth-child(1) .cp-nome', 'Ventilatore');
await scrivi('.riga-presa:nth-child(1) .cp-ip', IP1);
await scrivi('.riga-presa:nth-child(2) .cp-nome', 'Luci di Natale');
await scrivi('.riga-presa:nth-child(2) .cp-ip', IP2);
await scrivi('#cpSecondi', '1');
await clicca('[data-ruolo="salva"]');
await pagina.waitForFunction(() => /Configurazione salvata/.test(document.querySelector('.cassetto [data-ruolo="esito"]')?.textContent || ''), null, { timeout: 30000 });
const esitoPrese = await pagina.textContent('.cassetto [data-ruolo="esito"]');
verifica('Due prese configurate e raggiunte dal tablet', /tutte le prese rispondono/.test(esitoPrese), esitoPrese.trim());
await clicca('.cassetto [data-cassetto="chiudi"]');

// ---------- Voci e anticipatori nell'archivio ----------
await pagina.evaluate(async (file) => {
  const blob = (s) => new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))], { type: 'audio/wav' });
  const prese = Presa.elenco();
  const idDi = (nome) => prese.find((p) => p.nome === nome).id;
  for (const [n, nome] of [['voce-mamma', 'Voce della mamma'], ['voce-papa', 'Voce del papà']]) {
    await Archivio.audioAggiungi({ nome, blob: blob(file[n]), durata: 2, origine: 'upload', intero: true });
  }
  for (const [n, nome, cat] of [['ant-voce', 'anticipatore-voce', 'audio'], ['ant-ventilatore', 'anticipatore-ventilatore', `presa:${idDi('Ventilatore')}`],
    ['ant-luci', 'anticipatore-luci-di-natale', `presa:${idDi('Luci di Natale')}`]]) {
    await Archivio.audioAggiungi({ nome, blob: blob(file[n]), durata: 1, origine: 'upload', attivo: false, anticipa: cat });
  }
}, { 'voce-mamma': b64('voce-mamma'), 'voce-papa': b64('voce-papa'), 'ant-voce': b64('ant-voce'), 'ant-ventilatore': b64('ant-ventilatore'), 'ant-luci': b64('ant-luci') });

// ---------- Scheda Anticipatore: assegno dai menu ----------
await clicca('[data-scheda="anticipatore"]');
await pagina.waitForSelector('#tabellaAnticipatori .riga-anticipatore');
await attendi(500);
const righe = await pagina.$$eval('#tabellaAnticipatori .riga-anticipatore strong', (s) => s.map((x) => x.textContent));
verifica('Una riga per tipo di stimolo e per presa', righe.length === 5, righe.join(' | '));
const assegna = async (categoriaContiene, etichetta) => {
  await pagina.selectOption(`select[aria-label="Anticipatore: ${categoriaContiene}"]`, { label: etichetta });
  await attendi(400);
};
await assegna('Generale', 'Nessun anticipatore');
await assegna('Voci registrate', 'anticipatore-voce');
await assegna('Presa: Ventilatore', 'anticipatore-ventilatore');
await assegna('Presa: Luci di Natale', 'anticipatore-luci-di-natale');
await attendi(500);
const scelte = await pagina.$$eval('#tabellaAnticipatori select', (s) => s.map((x) => x.selectedOptions[0]?.textContent));
verifica('Anticipatori assegnati dai menu', scelte.join(', ') === 'Nessun anticipatore, anticipatore-voce, Come il generale, anticipatore-ventilatore, anticipatore-luci-di-natale', scelte.join(', '));
await pagina.screenshot({ path: path.join(SUONI, 'apk-anticipatori.png') });

// ---------- Stimolazione: categoria a caso, poi stimolo a caso (audio veri, YouTube simulato) ----------
await pagina.evaluate(() => {
  for (const [n, id] of [[1, 'aaaaaaaaaa1'], [2, 'aaaaaaaaaa2']]) {
    Archivio.aggiungiYoutube({ nome: `Video ${n}`, video_id: id, link: `https://youtu.be/${id}` });
  }
  Archivio.salvaImpostazioni({ stimolazione: { attesa_min: 1, attesa_max: 1, eventi: { audio: true, youtube: true, presa: true } } });
  window.__log = [];
  Archivio.audioLista().then((l) => { window.__nomi = new Map(l.map((a) => [a.blob.size, a.nome])); });
  const orig = Riproduttore.riproduciAudio;
  Riproduttore.riproduciAudio = (src, opz) => {
    const nome = src instanceof Blob ? (window.__nomi.get(src.size) || '?') : String(src);
    const t0 = performance.now();
    return orig(src, opz).then((e) => { window.__log.push(`${nome} (${e}, ${((performance.now() - t0) / 1000).toFixed(1)} s)`); return e; });
  };
  Riproduttore.youtubeDisponibile = () => true;
  Riproduttore.youtubeSbloccato = () => true;
  Riproduttore.precaricaYoutube = () => {};
  Riproduttore.riproduciYoutube = (v) => { window.__log.push(`VIDEO ${v.nome}`); return new Promise((r) => setTimeout(() => r('fine'), 300)); };
  const oa = Presa.accendi.bind(Presa);
  Presa.accendi = (ids, s) => { window.__log.push(`PRESA ${Presa.elenco().find((p) => p.id === ids[0])?.nome}`); return oa(ids, s); };
});
await clicca('[data-azione="vai-utente"]');
await pagina.waitForSelector('[data-azione="avvia"]', { state: 'attached' });
await clicca('[data-azione="avvia"]');
console.log('  …stimolazione in corso (60 s)');
await attendi(60000);
await clicca('[data-azione="ferma"]').catch(() => {});
const log = await pagina.evaluate(() => window.__log);
const stimoli = log.filter((x) => /^(Voce|VIDEO|PRESA)/.test(x));
const categoriaDi = (x) => (x.startsWith('PRESA') ? 'presa' : x.startsWith('VIDEO') ? 'video' : 'voce');
const categorie = stimoli.map(categoriaDi);
console.log('  stimoli:', stimoli.map((x) => x.replace(/ \(.*/, '')).join(' → '));
const prima = (pred) => log.map((x, i) => [x, log[i - 1] || '']).filter(([x]) => pred(x)).map(([, p]) => p);
verifica('Abbastanza stimoli per giudicare', stimoli.length >= 6, `${stimoli.length} stimoli`);
const giri = [];
for (let i = 0; i + 3 <= categorie.length; i += 3) giri.push(categorie.slice(i, i + 3));
verifica('Ogni giro contiene video, voce e presa', giri.every((g) => new Set(g).size === 3), giri.map((g) => g.join('-')).join(' | '));
verifica('Mai la stessa categoria due volte di fila', categorie.every((c, i) => i === 0 || c !== categorie[i - 1]));
verifica('Prima di ogni voce suona anticipatore-voce, per intero', prima((x) => x.startsWith('Voce')).every((p) => p.startsWith('anticipatore-voce (fine')));
verifica('Prima del ventilatore suona il suo anticipatore', prima((x) => x === 'PRESA Ventilatore').every((p) => p.startsWith('anticipatore-ventilatore (fine')));
verifica('Prima delle luci suona il loro anticipatore', prima((x) => x === 'PRESA Luci di Natale').every((p) => p.startsWith('anticipatore-luci-di-natale (fine')));
verifica('Nessun errore JavaScript', errori.length === 0, errori.join(' | '));
await dispositivo.close();
console.log(esiti.every(Boolean) ? '\nTUTTO OK' : '\nCI SONO PROBLEMI');
process.exit(esiti.every(Boolean) ? 0 : 1);
