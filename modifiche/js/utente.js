// ==================== AREA UTENTE ====================
// Tre modalità:
//   casuale    → come il programma originale: attesa casuale, audio anticipatore,
//                poi lo stimolo successivo della lista (audio, video YouTube, presa)
//                oppure uno a caso
//   richiesta  → come sopra, ma dopo l'anticipatore lo stimolo parte solo se
//                l'utente preme lo switch (causa-effetto, con tempi di risposta)
//   switch     → ascolto comandato dall'utente, con le modalità delle altre app:
//                diretto, random, temporizzato, timer persistente, navigazione assistita
//
// Switch: SPAZIO, INVIO, FRECCE (Makey Makey, switch USB/Bluetooth) o tocco sul palco.
// Con il doppio switch la FRECCIA DESTRA è dedicata agli audio registrati.

const Utente = (() => {
  const ANTICIPATORE_PREDEFINITO = 'assets/audio/anticipatore.mp3';

  const MODALITA = {
    casuale: {
      titolo: 'Stimolazione casuale',
      icona: 'bi-shuffle',
      info: 'L\'educatore preme <strong>Avvia</strong>. A intervalli casuali suona l\'audio anticipatore e parte uno stimolo: prima si estrae a caso la <strong>categoria</strong> (video, voci, prese), poi uno stimolo a caso di quella categoria.',
    },
    richiesta: {
      titolo: 'Stimolo su richiesta',
      icona: 'bi-hand-index-thumb',
      info: 'Come la stimolazione casuale, ma dopo l\'audio anticipatore lo stimolo parte <strong>solo se l\'utente preme lo switch</strong>. I tempi di risposta finiscono nel registro.',
    },
    switch: {
      titolo: 'Ascolto con switch',
      icona: 'bi-headphones',
      info: 'L\'utente sceglie quando ascoltare premendo lo switch (SPAZIO, INVIO, frecce o tocco sullo schermo).',
    },
  };

  const ASCOLTI = {
    diretto: { titolo: 'Diretto', info: 'Ogni pressione avvia lo stimolo successivo della lista.' },
    random: { titolo: 'Random', info: 'Ogni pressione avvia uno stimolo a caso (mai lo stesso due volte di fila).' },
    temporizzato: { titolo: 'Temporizzato', info: 'Dopo il tempo impostato lo stimolo va in pausa: premendo riprende.' },
    persistente: { titolo: 'Timer persistente', info: 'Durante il timer lo switch è disattivato: protegge dai movimenti involontari.' },
    navigazione: { titolo: 'Navigazione assistita', info: 'La voce annuncia ogni stimolo, che parte da solo dopo il conto alla rovescia. Lo switch passa al successivo.' },
  };

  let aperta = false;
  let ui = {};
  let prefs = {};
  let dati = { audio: [], youtube: [], anticipatore: null, tuttiAudio: new Map() };
  let elementi = [];                // lista corrente dell'ascolto con switch
  const tastiPremuti = new Set();
  let rimuoviAscoltoPresa = null;

  // Stimolazione casuale / su richiesta
  let sessione = null;              // { controller, record, attesaSwitch }
  let contoAttesaId = null;

  // Ascolto con switch
  const sw = {
    record: null,
    corrente: null,
    controller: null,
    indice: -1,
    timerPausa: null,    // temporizzato: mette in pausa dopo il tempo impostato
    timerBlocco: null,   // timer persistente: tiene disattivato lo switch
    inPausaTimer: false,
    bloccato: false,
    audio2: null,
    indice2: -1,
    nav: null,
    giro: Util.creaGiro((e) => e.chiave),   // ordine "a caso" senza ripetizioni
    giro2: Util.creaGiro((a) => a.id),      // idem per gli audio della freccia destra
  };

  // ==================== APERTURA / CHIUSURA ====================

  async function apri(contenitore) {
    aperta = true;
    prefs = Archivio.getImpostazioni().utente;
    disegnaStruttura(contenitore);

    Riproduttore.monta(ui.palcoContenitore, {
      onTocco: () => {
        // Un video che non è ancora partito si avvia col tocco, invece di passare oltre
        if (Riproduttore.youtubeInAttesaDiAvvio()) {
          Riproduttore.avviaYoutube();
          return;
        }
        premiSwitch(1);
      },
      scenaIniziale: { titolo: 'Caricamento…' },
    });

    document.addEventListener('keydown', alTastoGiu);
    document.addEventListener('keyup', alTastoSu);
    rimuoviAscoltoPresa = Presa.onCambio(() => {
      if (aperta) {
        aggiornaDisponibili();
        if (prefs.modalita === 'switch') {
          ricostruisciElementi();
        } else {
          disegnaListaSessione();
        }
      }
    });

    await caricaDati();
    if (!aperta) {
      return;
    }
    const primo = stimoliInGioco().find((el) => el.tipo === 'youtube')?.video;
    if (primo) {
      Riproduttore.preparaYoutube(primo.video_id).catch(() => aggiornaDisponibili());
    }
    applicaModalita();
  }

  function chiudi() {
    if (!aperta) {
      return;
    }
    fermaSessione();
    fermaTuttoSwitch();
    chiudiRecordSwitch();
    aperta = false;
    document.removeEventListener('keydown', alTastoGiu);
    document.removeEventListener('keyup', alTastoSu);
    rimuoviAscoltoPresa?.();
    rimuoviAscoltoPresa = null;
    Riproduttore.smonta();
    Riproduttore.schermoAcceso(false);
    ui = {};
  }

  async function caricaDati() {
    const imp = Archivio.getImpostazioni();
    let audio = [];
    try {
      audio = await Archivio.audioLista();
    } catch (e) {
      console.error('Audio non leggibili:', e);
    }
    dati.audio = audio.filter((a) => a.attivo && a.blob);
    dati.youtube = Archivio.getYoutube().filter((v) => v.attivo && !Riproduttore.erroreDefinitivo(v.errore));
    dati.anticipatore = null;
    // Tutti gli audio con un file, anticipatori compresi (non sono stimoli: non stanno in dati.audio)
    dati.tuttiAudio = new Map(audio.filter((a) => a.blob).map((a) => [a.id, a]));
    if (typeof imp.anticipatore === 'number') {
      const record = audio.find((a) => a.id === imp.anticipatore);
      dati.anticipatore = record?.blob ? record : null;
    }
  }

  // ==================== INTERFACCIA ====================

  function disegnaStruttura(contenitore) {
    contenitore.innerHTML = `
      <div class="user-options-overlay" id="opzioniOverlay"></div>
      <nav class="user-options-menu" id="opzioniMenu" aria-label="Opzioni dell'Area Utente">
        <h4><i class="bi bi-sliders"></i> Modalità</h4>
        <div class="options-group" id="gruppoModalita">
          ${Object.entries(MODALITA).map(([id, m]) => `
            <label><input type="radio" name="modalita" value="${id}" />
              <span><i class="bi ${m.icona}"></i> ${m.titolo}</span></label>`).join('')}
        </div>

        <div id="opzioniSwitch">
          <h4><i class="bi bi-headphones"></i> Ascolto con switch</h4>
          <div class="options-group" id="gruppoAscolto">
            ${Object.entries(ASCOLTI).map(([id, a]) => `
              <label><input type="radio" name="ascolto" value="${id}" /> <span>${a.titolo}</span></label>`).join('')}
          </div>

          <div class="timer-controls" id="boxTimer">
            <label for="sliderTimer">Durata dell'ascolto (secondi)</label>
            <input type="range" id="sliderTimer" min="5" max="120" step="5" />
            <span class="timer-value" id="valoreTimer"></span>
            <div class="pref-box-options">
              <label><input type="radio" name="ordine" value="successivo" /> <span>In ordine</span></label>
              <label><input type="radio" name="ordine" value="random" /> <span>A caso</span></label>
            </div>
          </div>

          <div class="timer-controls" id="boxNavigazione">
            <label for="sliderAttesa">Attesa prima dello stimolo (secondi)</label>
            <input type="range" id="sliderAttesa" min="3" max="120" step="1" />
            <span class="timer-value" id="valoreAttesa"></span>
            <p class="helper-text">Durante lo stimolo lo switch:</p>
            <div class="pref-box-options colonna">
              <label><input type="radio" name="spazioNav" value="next" /> <span>Passa al successivo</span></label>
              <label><input type="radio" name="spazioNav" value="ignore" /> <span>Non fa nulla</span></label>
              <label><input type="radio" name="spazioNav" value="disabled" /> <span>È sempre disattivato</span></label>
            </div>
          </div>

          <label class="spunta grande" id="rigaSwitch2">
            <input type="checkbox" id="optSwitch2" />
            <span><i class="bi bi-arrow-right-square"></i> Doppio switch: FRECCIA DESTRA = audio registrati</span>
          </label>
        </div>

        <div class="direct-info active" id="infoModalita"></div>
      </nav>

      <div class="space-indicator" id="indicatoreSpazio"></div>

      <div class="user-layout ${prefs.pannello_chiuso ? 'pannello-chiuso' : ''}" id="layoutUtente">
        <section class="panel user-panel" id="pannelloUtente">
          <div class="intestazione-area">
            <h2 id="titoloModalita"></h2>
            <button type="button" class="btn-secondary btn-piccolo" data-azione="vai-educatore">
              <i class="bi bi-gear-fill"></i> Configurazione
            </button>
          </div>
          <div id="contenutoPannello"></div>
        </section>
        <section class="user-player-panel">
          <div class="player-testa">
            <button type="button" class="btn-icona" id="btnPannello" title="Mostra o nascondi l'elenco">
              <i class="bi bi-layout-sidebar-inset"></i>
            </button>
            <p id="titoloCorrente" class="titolo-corrente">Pronto</p>
          </div>
          <div class="palco-contenitore" id="palcoContenitore"></div>
        </section>
      </div>
    `;

    ui = {
      menu: contenitore.querySelector('#opzioniMenu'),
      overlay: contenitore.querySelector('#opzioniOverlay'),
      opzioniSwitch: contenitore.querySelector('#opzioniSwitch'),
      boxTimer: contenitore.querySelector('#boxTimer'),
      boxNavigazione: contenitore.querySelector('#boxNavigazione'),
      sliderTimer: contenitore.querySelector('#sliderTimer'),
      valoreTimer: contenitore.querySelector('#valoreTimer'),
      sliderAttesa: contenitore.querySelector('#sliderAttesa'),
      valoreAttesa: contenitore.querySelector('#valoreAttesa'),
      optSwitch2: contenitore.querySelector('#optSwitch2'),
      infoModalita: contenitore.querySelector('#infoModalita'),
      indicatore: contenitore.querySelector('#indicatoreSpazio'),
      layout: contenitore.querySelector('#layoutUtente'),
      titoloModalita: contenitore.querySelector('#titoloModalita'),
      pannello: contenitore.querySelector('#contenutoPannello'),
      titoloCorrente: contenitore.querySelector('#titoloCorrente'),
      palcoContenitore: contenitore.querySelector('#palcoContenitore'),
    };

    // Valori salvati nei controlli
    const spunta = (nome, valore) => {
      const r = ui.menu.querySelector(`input[name="${nome}"][value="${valore}"]`);
      if (r) {
        r.checked = true;
      }
    };
    spunta('modalita', prefs.modalita);
    spunta('ascolto', prefs.ascolto);
    spunta('ordine', prefs.ordine);
    spunta('spazioNav', prefs.spazio_navigazione);
    ui.sliderTimer.value = prefs.timer;
    ui.valoreTimer.textContent = `${prefs.timer} s`;
    ui.sliderAttesa.value = prefs.attesa_navigazione;
    ui.valoreAttesa.textContent = `${prefs.attesa_navigazione} s`;
    ui.optSwitch2.checked = !!prefs.switch2_audio;

    ui.overlay.addEventListener('click', () => alternaOpzioni(false));
    ui.menu.addEventListener('change', alCambioOpzione);
    ui.sliderTimer.addEventListener('input', () => {
      ui.valoreTimer.textContent = `${ui.sliderTimer.value} s`;
    });
    ui.sliderAttesa.addEventListener('input', () => {
      ui.valoreAttesa.textContent = `${ui.sliderAttesa.value} s`;
    });
    contenitore.querySelector('[data-azione="vai-educatore"]').addEventListener('click', () => App.mostraEducatore());
    contenitore.querySelector('#btnPannello').addEventListener('click', () => {
      prefs.pannello_chiuso = !ui.layout.classList.toggle('pannello-chiuso') ? false : true;
      salvaPrefs();
    });
    ui.pannello.addEventListener('click', alClickPannello);
    ui.pannello.addEventListener('change', alCambioPannello);
    ui.pannello.addEventListener('input', alInputPannello);
  }

  function salvaPrefs() {
    Archivio.salvaImpostazioni({ utente: prefs });
  }

  function alternaOpzioni(forza) {
    if (!aperta) {
      return;
    }
    const apriMenu = typeof forza === 'boolean' ? forza : !ui.menu.classList.contains('active');
    ui.menu.classList.toggle('active', apriMenu);
    ui.overlay.classList.toggle('active', apriMenu);
    if (!apriMenu) {
      document.activeElement?.blur?.();
    }
  }

  function menuAperto() {
    return !!ui.menu?.classList.contains('active');
  }

  function alCambioOpzione(e) {
    const t = e.target;
    Riproduttore.sblocca();
    if (t.name === 'modalita') {
      prefs.modalita = t.value;
      salvaPrefs();
      applicaModalita();
    } else if (t.name === 'ascolto') {
      prefs.ascolto = t.value;
      salvaPrefs();
      applicaModalita();
    } else if (t.name === 'ordine') {
      prefs.ordine = t.value;
      salvaPrefs();
    } else if (t.name === 'spazioNav') {
      prefs.spazio_navigazione = t.value;
      salvaPrefs();
    } else if (t.id === 'sliderTimer') {
      prefs.timer = Number(t.value);
      salvaPrefs();
    } else if (t.id === 'sliderAttesa') {
      prefs.attesa_navigazione = Number(t.value);
      salvaPrefs();
    } else if (t.id === 'optSwitch2') {
      prefs.switch2_audio = t.checked;
      salvaPrefs();
      applicaModalita();
    }
  }

  // Ridisegna il pannello di sinistra e le opzioni secondo la modalità scelta
  function applicaModalita() {
    fermaSessione();
    fermaTuttoSwitch();
    chiudiRecordSwitch();
    Riproduttore.ferma();
    nascondiIndicatore();

    const m = MODALITA[prefs.modalita] || MODALITA.casuale;
    ui.titoloModalita.innerHTML = `<i class="bi ${m.icona}"></i> ${m.titolo}`;
    const inSwitch = prefs.modalita === 'switch';
    ui.opzioniSwitch.hidden = !inSwitch;
    ui.boxTimer.classList.toggle('active', inSwitch && ['temporizzato', 'persistente'].includes(prefs.ascolto));
    ui.boxNavigazione.classList.toggle('active', inSwitch && prefs.ascolto === 'navigazione');
    ui.infoModalita.innerHTML = `<p><i class="bi bi-info-circle"></i> ${m.info}${inSwitch ? `<br><br><strong>${ASCOLTI[prefs.ascolto]?.titolo}:</strong> ${ASCOLTI[prefs.ascolto]?.info}` : ''}</p>`;

    if (inSwitch) {
      disegnaPannelloSwitch();
      Riproduttore.scena('riposo', { titolo: 'Premi lo switch per ascoltare' });
      titoloCorrente('Pronto');
    } else {
      disegnaPannelloSessione();
      Riproduttore.scena('riposo', { titolo: 'Premi Avvia per iniziare' });
      titoloCorrente('Pronto');
    }
  }

  function titoloCorrente(testo) {
    if (ui.titoloCorrente) {
      ui.titoloCorrente.textContent = testo;
    }
  }

  function mostraIndicatore(html) {
    if (ui.indicatore) {
      ui.indicatore.innerHTML = html;
      ui.indicatore.classList.add('active');
    }
  }

  function nascondiIndicatore() {
    ui.indicatore?.classList.remove('active');
  }

  // ==================== ELEMENTI (stimoli) ====================

  function elementoAudio(a) {
    return { chiave: `a${a.id}`, tipo: 'audio', nome: a.nome, categoria: 'Audio registrati', record: a };
  }

  function elementoVideo(v) {
    return { chiave: `y${v.id}`, tipo: 'youtube', nome: v.nome, categoria: v.categoria || 'Video', video: v };
  }

  // Ogni presa scelta è uno stimolo a sé, con il suo nome e il suo anticipatore
  // (scelte nella scheda Presa; nessuna scelta = tutte quelle configurate)
  function elementiPrese() {
    if (!Presa.disponibile()) {
      return [];
    }
    const tutte = Presa.elenco();
    const scelte = Archivio.getImpostazioni().presa.prese || [];
    const inGioco = scelte.length ? tutte.filter((p) => scelte.includes(p.id)) : tutte;
    return (inGioco.length ? inGioco : tutte).map((p) => ({
      chiave: `presa:${p.id}`, tipo: 'presa', nome: p.nome || 'Presa smart', categoria: 'Presa smart', presa: p,
    }));
  }

  function iconaElemento(el) {
    if (el.tipo === 'audio') {
      return el.record.origine === 'registrazione' ? 'bi-mic-fill' : 'bi-file-earmark-music';
    }
    if (el.tipo === 'presa') {
      return 'bi-plug-fill';
    }
    return el.video.solo_audio ? 'bi-music-note-beamed' : 'bi-youtube';
  }

  function dettaglioElemento(el) {
    if (el.tipo === 'audio') {
      return `${Util.escapeHtml(el.categoria)} · ${(Number(el.record.durata) || 0).toFixed(1)} s${el.record.intero ? ' · per intero' : ''}`;
    }
    if (el.tipo === 'presa') {
      const secondi = Archivio.getImpostazioni().presa.secondi;
      return `Accesa per ${secondi} s${Presa.disponibile() ? '' : ' · non collegata'}`;
    }
    const v = el.video;
    const tempi = (v.inizio || v.fine) ? ` · ${Util.formatoTempo(v.inizio)}${v.fine ? `–${Util.formatoTempo(v.fine)}` : ''}` : '';
    return `${Util.escapeHtml(el.categoria)}${tempi}${v.solo_audio ? ' · solo audio' : ''}${v.intero ? ' · per intero' : ''}`;
  }

  function disegnaLista(contenitore, lista, cliccabile) {
    if (!contenitore) {
      return;
    }
    if (lista.length === 0) {
      contenitore.innerHTML = `
        <p class="vuoto"><i class="bi bi-inbox"></i> Nessuno stimolo nel gioco.<br>
        <small>Aggiungili dalla <strong>Configurazione</strong>.</small></p>`;
      return;
    }
    contenitore.innerHTML = lista.map((el) => `
      <div class="brano-item" data-chiave="${el.chiave}">
        <button type="button" class="maniglia" title="Trascina per cambiare l'ordine"
          aria-label="Sposta ${Util.escapeHtml(el.nome)} (frecce su e giù)">
          <i class="bi bi-grip-vertical"></i>
        </button>
        <div class="brano-info" ${cliccabile ? `data-azione="riproduci" data-chiave="${el.chiave}"` : ''}>
          <i class="bi ${iconaElemento(el)}"></i>
          <div>
            <strong>${Util.escapeHtml(el.nome)}</strong>
            <small>${dettaglioElemento(el)}</small>
          </div>
        </div>
        ${cliccabile ? `
          <div class="brano-actions">
            <button type="button" class="btn-play" data-azione="riproduci" data-chiave="${el.chiave}" title="Riproduci">
              <i class="bi bi-play-circle"></i>
            </button>
          </div>` : ''}
      </div>`).join('');
  }

  // Tutti gli stimoli nel gioco nell'ordine scelto trascinandoli (i nuovi in fondo).
  // È la stessa sequenza in ogni modalità e negli elenchi dell'Area Educatore.
  function stimoliInGioco({ conAudio = true } = {}) {
    return Archivio.inOrdine([
      ...(conAudio ? dati.audio.map(elementoAudio) : []),
      ...dati.youtube.map(elementoVideo),
      ...elementiPrese(),
    ], (el) => el.chiave);
  }

  // Nuovo ordine dopo un trascinamento. L'elenco visibile può essere solo una parte
  // (filtro per categoria, stimoli tolti dal gioco): gli altri restano al loro posto.
  function nuovoOrdine(chiaviVisibili) {
    const completo = Archivio.getOrdine();
    [...stimoliInGioco().map((el) => el.chiave), ...chiaviVisibili].forEach((k) => {
      if (!completo.includes(k)) {
        completo.push(k);
      }
    });
    const posti = completo.map((k, i) => (chiaviVisibili.includes(k) ? i : -1)).filter((i) => i >= 0);
    posti.forEach((posto, j) => {
      completo[posto] = chiaviVisibili[j];
    });
    Archivio.salvaOrdine(completo);

    if (prefs.modalita === 'switch') {
      const prima = elementi[sw.indice]?.chiave;
      const navPrima = sw.nav ? elementi[sw.nav.indice]?.chiave : null;
      elementi = chiaviVisibili.map((k) => elementi.find((e) => e.chiave === k)).filter(Boolean);
      sw.indice = prima ? elementi.findIndex((e) => e.chiave === prima) : -1;
      if (sw.nav && navPrima) {
        sw.nav.indice = Math.max(0, elementi.findIndex((e) => e.chiave === navPrima));
      }
      precaricaProssimo();
    }
  }

  function evidenzia(el) {
    ui.pannello?.querySelectorAll('.brano-item').forEach((item) => {
      const corrente = !!el && item.dataset.chiave === el.chiave;
      item.classList.toggle('corrente', corrente);
      if (corrente) {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // Durata massima di questo stimolo (0 = nessun limite). La durata generale vale per tutti,
  // tranne gli stimoli segnati "Sempre per intero" (es. la voce di un familiare) e i video
  // con un proprio tempo di fine: l'impostazione del singolo stimolo vince su quella generale.
  function limiteDurata(el, generale) {
    if (el.tipo === 'audio') {
      return el.record.intero ? 0 : generale;
    }
    if (el.tipo === 'youtube') {
      return (el.video.intero || el.video.fine > 0) ? 0 : generale;
    }
    return generale;
  }

  // Esegue uno stimolo qualsiasi e restituisce l'esito ('fine' | 'stop' | 'errore')
  async function eseguiStimolo(el, { maxSecondi = 0, segnale } = {}) {
    evidenzia(el);
    titoloCorrente(el.nome);
    if (el.tipo === 'audio') {
      Riproduttore.scena('audio', { titolo: el.nome });
      return Riproduttore.riproduciAudio(el.record.blob, { maxSecondi, segnale });
    }
    if (el.tipo === 'youtube') {
      Riproduttore.scena(el.video.solo_audio ? 'solo-audio' : 'caricamento', {
        titolo: el.nome,
        sottotitolo: el.video.solo_audio ? '' : 'Caricamento del video…',
      });
      const esito = await Riproduttore.riproduciYoutube(el.video, { maxSecondi, segnale });
      const errore = Riproduttore.ultimoErroreYoutube();
      if (esito === 'errore' && errore?.videoId === el.video.video_id && Riproduttore.erroreDefinitivo(errore.codice)) {
        segnaVideoNonRiproducibile(el.video, errore.codice);
      }
      return esito;
    }
    return eseguiPresa(el, segnale);
  }

  // Il video non si può riprodurre fuori da YouTube: lo segno (l'educatore lo vede
  // nell'elenco) e non lo propongo più finché non viene riprovato
  function segnaVideoNonRiproducibile(video, codice) {
    Archivio.aggiornaYoutube(video.id, { errore: codice, errore_data: Date.now() });
    dati.youtube = dati.youtube.filter((v) => v.id !== video.id);
    if (aperta && prefs.modalita === 'switch') {
      ricostruisciElementi();
    }
  }

  async function eseguiPresa(el, segnale) {
    const conf = Archivio.getImpostazioni().presa;
    const ids = el.presa ? [el.presa.id] : conf.prese;
    Riproduttore.scena('presa', { titolo: el.presa ? `${el.nome}: accesa` : 'Presa accesa', contatore: conf.secondi });
    try {
      await Presa.accendi(ids, conf.secondi);
    } catch (e) {
      console.warn('Presa:', e.message);
      Riproduttore.scena('riposo', { titolo: 'La presa non risponde', sottotitolo: e.message });
      await Util.attendi(2000, segnale);
      return 'errore';
    }
    const completato = await Util.attendi(conf.secondi * 1000, segnale);
    if (!completato) {
      Presa.spegni(ids).catch(() => {});
      return 'stop';
    }
    return 'fine';
  }

  // ==================== REGISTRO ====================

  function nuovoRecord(modalita, dettaglio = '') {
    return {
      id: Util.idUnivoco(),
      modalita,
      dettaglio,
      inizio: Date.now(),
      fine: null,
      stimoli: 0,
      per_tipo: { audio: 0, youtube: 0, presa: 0 },
      richieste: 0,
      risposte: 0,
      tempi_risposta: [],
      pressioni: 0,
      pressioni_fuori_tempo: 0,
    };
  }

  function salvaRecord(record, chiuso = false) {
    if (!record) {
      return;
    }
    if (chiuso) {
      record.fine = Date.now();
    }
    if (record.stimoli > 0 || record.pressioni > 0 || record.richieste > 0) {
      Archivio.salvaSessione(record);
    }
  }

  // ==================== STIMOLAZIONE CASUALE / SU RICHIESTA ====================

  function disegnaPannelloSessione() {
    ui.pannello.innerHTML = `
      <div class="sessione-controlli">
        <button type="button" class="btn-grande btn-avvia" data-azione="avvia">
          <i class="bi bi-play-circle-fill"></i> Avvia
        </button>
        <button type="button" class="btn-grande btn-ferma" data-azione="ferma" hidden>
          <i class="bi bi-stop-circle-fill"></i> Ferma
        </button>
      </div>
      <div class="stato-sessione" id="statoSessione" role="status" aria-live="polite">Pronto</div>
      <div class="regolazione-attesa">
        <div class="regolazione-titolo"><i class="bi bi-hourglass-split"></i> Attesa tra gli stimoli</div>
        <label class="cursore">
          <span>Minima</span>
          <input type="range" id="cursoreAttesaMin" min="1" max="120" step="1" />
          <strong id="valoreAttesaMin"></strong>
        </label>
        <label class="cursore">
          <span>Massima</span>
          <input type="range" id="cursoreAttesaMax" min="1" max="120" step="1" />
          <strong id="valoreAttesaMax"></strong>
        </label>
      </div>
      <div class="contatori" id="contatori"></div>
      <div class="disponibili" id="disponibili"></div>
      <h4 class="titolo-lista"><i class="bi bi-collection-play"></i> Stimoli nel gioco</h4>
      <p class="nota-presa-casuale"><i class="bi bi-shuffle"></i> A ogni stimolo si estrae a caso una <strong>categoria</strong> tra video YouTube, voci e prese Tapo, poi uno stimolo a caso di quella categoria. La categoria successiva si sceglie tra quelle rimaste: le tre escono tutte prima di ricominciare, e mai la stessa due volte di fila. Dentro una categoria nessuno stimolo si ripete finché non sono usciti tutti.</p>
      <div class="brani-list" id="listaStimoli"></div>
    `;
    const st = Archivio.getImpostazioni().stimolazione;
    ui.pannello.querySelector('#cursoreAttesaMin').value = st.attesa_min;
    ui.pannello.querySelector('#cursoreAttesaMax').value = st.attesa_max;
    mostraValoriAttesa();
    aggiornaDisponibili();
    aggiornaContatori();
    Ordinabile.attiva(ui.pannello.querySelector('#listaStimoli'), { onCambio: nuovoOrdine });
    disegnaListaSessione();
  }

  function disegnaListaSessione() {
    const contenitore = ui.pannello?.querySelector('#listaStimoli');
    // Non ridisegno mentre l'educatore sta trascinando uno stimolo
    if (!contenitore || contenitore.querySelector('.in-trascinamento')) {
      return;
    }
    // La presa parte a cadenza fissa, non segue la sequenza: qui mostro solo audio e video
    disegnaLista(contenitore, stimoliInGioco().filter((el) => el.tipo !== 'presa'), false);
  }

  function mostraValoriAttesa() {
    const min = ui.pannello?.querySelector('#cursoreAttesaMin');
    const max = ui.pannello?.querySelector('#cursoreAttesaMax');
    if (min && max) {
      ui.pannello.querySelector('#valoreAttesaMin').textContent = `${min.value} s`;
      ui.pannello.querySelector('#valoreAttesaMax').textContent = `${max.value} s`;
    }
  }

  // Cursori dell'attesa: valgono dal prossimo stimolo, anche a sessione avviata
  function alInputPannello(e) {
    const id = e.target.id;
    if (id !== 'cursoreAttesaMin' && id !== 'cursoreAttesaMax') {
      return;
    }
    const cMin = ui.pannello.querySelector('#cursoreAttesaMin');
    const cMax = ui.pannello.querySelector('#cursoreAttesaMax');
    if (id === 'cursoreAttesaMin' && Number(cMin.value) > Number(cMax.value)) {
      cMax.value = cMin.value;
    }
    if (id === 'cursoreAttesaMax' && Number(cMax.value) < Number(cMin.value)) {
      cMin.value = cMax.value;
    }
    mostraValoriAttesa();
    Archivio.salvaImpostazioni({ stimolazione: { attesa_min: Number(cMin.value), attesa_max: Number(cMax.value) } });
    aggiornaDisponibili();
  }

  function nomeAnticipatore() {
    const a = Archivio.getImpostazioni().anticipatore;
    if (a === 'nessuno') {
      return 'nessuno';
    }
    if (a === 'predefinito' || !dati.anticipatore) {
      return 'suono predefinito';
    }
    return dati.anticipatore.nome;
  }

  // Quanti tipi di stimolo hanno un anticipatore proprio (diverso dal generale)
  function anticipatoriPropri() {
    const per = Archivio.getImpostazioni().anticipatori || {};
    const valori = [per.audio, per.youtube, ...elementiPrese().map((el) => per.prese?.[el.presa.id])];
    const n = valori.filter((v) => v !== undefined && v !== 'generale').length;
    return n ? ` · ${n} ${n === 1 ? 'tipo di stimolo ha' : 'tipi di stimolo hanno'} il proprio` : '';
  }

  function aggiornaDisponibili() {
    const box = ui.pannello?.querySelector('#disponibili');
    if (!box) {
      return;
    }
    const st = Archivio.getImpostazioni().stimolazione;
    const riga = (attivo, icona, testo) => `
      <div class="${attivo ? '' : 'spento'}"><i class="bi ${icona}"></i> ${testo}</div>`;
    const yt = Riproduttore.youtubeDisponibile();
    box.innerHTML = [
      riga(st.eventi.audio && dati.audio.length > 0, 'bi-mic-fill',
        `Audio: ${dati.audio.length} nel gioco${st.eventi.audio ? '' : ' (esclusi nei Tempi)'}`),
      riga(st.eventi.youtube && dati.youtube.length > 0 && yt, 'bi-youtube',
        `Video: ${dati.youtube.length} nel gioco${st.eventi.youtube ? '' : ' (esclusi nei Tempi)'}${dati.youtube.length && !yt ? ' · YouTube non raggiungibile' : ''}`),
      riga(st.eventi.presa && Presa.disponibile(), 'bi-plug-fill',
        `Prese: ${Presa.disponibile() ? `${elementiPrese().length} · una alla volta` : 'non collegate'}${st.eventi.presa ? '' : ' (escluse nei Tempi)'}`),
      riga(true, 'bi-bell-fill', `Anticipatore generale: ${Util.escapeHtml(nomeAnticipatore())}${anticipatoriPropri()}`),
      riga(true, 'bi-stopwatch', `Attesa ${st.attesa_min}–${st.attesa_max} s${prefs.modalita === 'richiesta'
        ? ` · risposta ${st.risposta_timeout ? `entro ${st.risposta_timeout} s` : 'senza limite'}` : ''}`),
    ].join('');
  }

  function aggiornaContatori() {
    const box = ui.pannello?.querySelector('#contatori');
    if (!box) {
      return;
    }
    const r = sessione?.record;
    if (!r) {
      box.innerHTML = '';
      return;
    }
    const tempi = r.tempi_risposta;
    const media = tempi.length ? (tempi.reduce((a, b) => a + b, 0) / tempi.length / 1000).toFixed(1) : '-';
    box.innerHTML = `
      <div><strong>${r.stimoli}</strong><span>stimoli</span></div>
      ${r.modalita === 'richiesta' ? `
        <div><strong>${r.risposte}/${r.richieste}</strong><span>risposte</span></div>
        <div><strong>${media} s</strong><span>tempo medio</span></div>` : `
        <div><strong>${r.pressioni}</strong><span>pressioni</span></div>`}
    `;
  }

  function statoSessione(testo, attesaSecondi = 0) {
    clearInterval(contoAttesaId);
    contoAttesaId = null;
    const box = ui.pannello?.querySelector('#statoSessione');
    if (!box) {
      return;
    }
    if (attesaSecondi > 0) {
      let rimanenti = Math.round(attesaSecondi);
      box.textContent = `${testo}: ${rimanenti} s`;
      contoAttesaId = setInterval(() => {
        rimanenti = Math.max(0, rimanenti - 1);
        box.textContent = `${testo}: ${rimanenti} s`;
        if (rimanenti <= 0) {
          clearInterval(contoAttesaId);
          contoAttesaId = null;
        }
      }, 1000);
    } else {
      box.textContent = testo;
    }
  }

  function tipiDisponibili(st, youtubeEscluso) {
    const tipi = [];
    if (st.eventi.audio && dati.audio.length > 0) {
      tipi.push('audio');
    }
    if (st.eventi.youtube && dati.youtube.length > 0 && !youtubeEscluso && Riproduttore.youtubeDisponibile()) {
      tipi.push('youtube');
    }
    if (st.eventi.presa && Presa.disponibile()) {
      tipi.push('presa');
    }
    return tipi;
  }

  // Prossimo stimolo della sessione, in due estrazioni:
  //  1. una CATEGORIA a caso tra quelle con stimoli disponibili adesso: video YouTube ('youtube'),
  //     voci ('audio'), prese Tapo ('presa'). La successiva si sceglie tra quelle rimaste: le
  //     categorie escono tutte prima di ricominciare un giro, e mai la stessa due volte di fila;
  //  2. uno STIMOLO a caso di quella categoria: nessuno si ripete finché non sono usciti tutti.
  // Una categoria vuota o non disponibile (nessun video, prese scollegate) viene saltata.
  function prossimoStimolo(giroCategorie, giriStimoli, tipi) {
    const perCategoria = new Map();
    for (const el of stimoliInGioco().filter((e) => tipi.includes(e.tipo))) {
      if (!perCategoria.has(el.tipo)) {
        perCategoria.set(el.tipo, []);
      }
      perCategoria.get(el.tipo).push(el);
    }
    if (perCategoria.size === 0) {
      return null;
    }
    const categoria = giroCategorie.prossimo([...perCategoria.keys()], Util.mescola);
    if (!giriStimoli.has(categoria)) {
      giriStimoli.set(categoria, Util.creaGiro((e) => e.chiave));
    }
    return giriStimoli.get(categoria).prossimo(perCategoria.get(categoria), Util.mescola);
  }


  function aggiornaControlliSessione() {
    const attiva = !!sessione;
    const avvia = ui.pannello?.querySelector('[data-azione="avvia"]');
    const ferma = ui.pannello?.querySelector('[data-azione="ferma"]');
    if (avvia) {
      avvia.hidden = attiva;
    }
    if (ferma) {
      ferma.hidden = !attiva;
    }
  }

  async function avviaSessione() {
    if (sessione || !aperta) {
      return;
    }
    Riproduttore.sblocca();
    document.activeElement?.blur?.();

    const st = Archivio.getImpostazioni().stimolazione;
    if (tipiDisponibili(st, false).length === 0) {
      statoSessione('Nessuno stimolo disponibile: aggiungi audio o video nella Configurazione, oppure collega la presa.');
      return;
    }

    const controller = new AbortController();
    sessione = { controller, record: nuovoRecord(prefs.modalita), attesaSwitch: null };
    aggiornaControlliSessione();
    aggiornaContatori();
    Riproduttore.schermoAcceso(true);

    try {
      await cicloStimolazione(controller.signal);
    } catch (e) {
      console.error('Errore nella stimolazione:', e);
      statoSessione(`Errore: ${e.message}`);
    } finally {
      if (sessione && sessione.controller === controller) {
        chiudiSessione();
      }
    }
  }

  function fermaSessione() {
    if (!sessione) {
      return;
    }
    sessione.controller.abort();
    Riproduttore.ferma();
    chiudiSessione();
  }

  function chiudiSessione() {
    if (!sessione) {
      return;
    }
    salvaRecord(sessione.record, true);
    sessione = null;
    clearInterval(contoAttesaId);
    contoAttesaId = null;
    Riproduttore.schermoAcceso(false);
    if (aperta) {
      aggiornaControlliSessione();
      statoSessione('Sessione terminata');
      Riproduttore.scena('riposo', { titolo: 'Premi Avvia per iniziare' });
      titoloCorrente('Pronto');
      evidenzia(null);
    }
  }

  // Scelta per il tipo dello stimolo: 'generale' | 'nessuno' | 'predefinito' | id di un audio
  function sceltaAnticipatore(imp, el) {
    const per = imp.anticipatori || {};
    if (el?.tipo === 'presa' && el.presa) {
      return per.prese?.[el.presa.id] ?? 'generale';
    }
    if (el?.tipo === 'audio' || el?.tipo === 'youtube') {
      return per[el.tipo] ?? 'generale';
    }
    return 'generale';
  }

  // Audio da suonare prima dello stimolo el (null = nessuno). Se l'audio scelto per quel
  // tipo non esiste più, suona l'anticipatore generale.
  async function sorgenteAnticipatore(el) {
    const imp = Archivio.getImpostazioni();
    const scelta = sceltaAnticipatore(imp, el);
    if (scelta === 'nessuno') {
      return null;
    }
    if (scelta === 'predefinito') {
      return ANTICIPATORE_PREDEFINITO;
    }
    if (typeof scelta === 'number' && dati.tuttiAudio.get(scelta)?.blob) {
      return dati.tuttiAudio.get(scelta).blob;
    }
    const a = imp.anticipatore;
    if (a === 'nessuno') {
      return null;
    }
    if (typeof a === 'number' && dati.tuttiAudio.get(a)?.blob) {
      return dati.tuttiAudio.get(a).blob;
    }
    return ANTICIPATORE_PREDEFINITO;
  }

  async function cicloStimolazione(segnale) {
    const suRichiesta = prefs.modalita === 'richiesta';
    const record = sessione.record;
    let youtubeEscluso = false;
    const giroCategorie = Util.creaGiro((categoria) => categoria);   // 'youtube' | 'audio' | 'presa'
    const giriStimoli = new Map();   // categoria → giro dei suoi stimoli
    let nota = '';   // esito del giro precedente, mostrato durante l'attesa

    // iPad/iPhone: YouTube parte da solo solo dopo un primo tocco sul video
    const st0 = Archivio.getImpostazioni().stimolazione;
    if (st0.eventi.youtube && dati.youtube.length > 0 && Riproduttore.youtubeDisponibile()
        && !Riproduttore.youtubeSbloccato()) {
      statoSessione('Tocca il video una volta per abilitare YouTube');
      titoloCorrente('Tocca il video');
      const ok = await Riproduttore.assicuraYoutubeSbloccato(segnale);
      if (segnale.aborted) {
        return;
      }
      if (!ok) {
        youtubeEscluso = true;
      }
    }

    while (!segnale.aborted) {
      const imp = Archivio.getImpostazioni();
      const st = imp.stimolazione;

      // 1. Attesa casuale
      const attesa = Util.numeroCasuale(st.attesa_min, st.attesa_max);
      Riproduttore.scena('attesa');
      titoloCorrente('In attesa…');
      evidenzia(null);
      statoSessione(`${nota}Prossimo stimolo tra`, attesa);
      nota = '';
      if (!(await Util.attendi(attesa * 1000, segnale))) {
        break;
      }

      const tipi = tipiDisponibili(st, youtubeEscluso);
      if (tipi.length === 0) {
        statoSessione('Nessuno stimolo disponibile in questo momento (presa scollegata o YouTube non raggiungibile?)');
        continue;
      }

      // 2. Scelgo subito lo stimolo: se è un video si carica (muto, nascosto)
      //    mentre suona l'anticipatore, così alla fine parte senza attese
      const el = prossimoStimolo(giroCategorie, giriStimoli, tipi);
      if (!el) {
        continue;
      }
      if (el.tipo === 'youtube') {
        Riproduttore.precaricaYoutube(el.video);
      }

      // 3. Audio anticipatore
      const anticipatore = await sorgenteAnticipatore(el);
      if (anticipatore) {
        Riproduttore.scena('anticipatore', { titolo: 'Ascolta…' });
        titoloCorrente('Audio anticipatore');
        statoSessione('Audio anticipatore');
        await Riproduttore.riproduciAudio(anticipatore, { segnale });
        if (segnale.aborted) {
          break;
        }
      }

      // 4. Su richiesta: aspetto lo switch
      if (suRichiesta) {
        record.richieste++;
        Riproduttore.scena('richiesta', {
          titolo: 'Premi!',
          contatore: st.risposta_timeout > 0 ? st.risposta_timeout : null,
        });
        titoloCorrente('Aspetto lo switch');
        statoSessione('Aspetto la pressione dello switch…');
        const risposta = await attendiSwitch(st.risposta_timeout, segnale);
        if (segnale.aborted) {
          break;
        }
        if (!risposta) {
          aggiornaContatori();
          salvaRecord(record);
          nota = 'Nessuna risposta. ';
          continue;
        }
        record.risposte++;
        record.tempi_risposta.push(risposta.ms);
        aggiornaContatori();
      }

      // 5. Stimolo
      statoSessione(`Stimolo: ${el.nome}`);
      const esito = await eseguiStimolo(el, { maxSecondi: limiteDurata(el, st.durata_max), segnale });
      if (esito !== 'errore') {
        record.stimoli++;
        record.per_tipo[el.tipo]++;
      }
      if (esito === 'errore' && el.tipo === 'youtube' && !Riproduttore.youtubeSbloccato()) {
        youtubeEscluso = true;
      }
      aggiornaContatori();
      salvaRecord(record);
    }
  }

  function attendiSwitch(timeoutSecondi, segnale) {
    return new Promise((resolve) => {
      const inizio = performance.now();
      let timer = null;
      const alStop = () => fine(null);
      function fine(risposta) {
        clearTimeout(timer);
        segnale.removeEventListener('abort', alStop);
        if (sessione) {
          sessione.attesaSwitch = null;
        }
        resolve(risposta);
      }
      sessione.attesaSwitch = { risolvi: () => fine({ ms: Math.round(performance.now() - inizio) }) };
      if (timeoutSecondi > 0) {
        timer = setTimeout(() => fine(null), timeoutSecondi * 1000);
      }
      segnale.addEventListener('abort', alStop, { once: true });
    });
  }

  // ==================== ASCOLTO CON SWITCH ====================

  function disegnaPannelloSwitch() {
    ui.pannello.innerHTML = `
      <div class="form-group" id="gruppoCategoria">
        <label for="filtroCategoria">Categoria</label>
        <select id="filtroCategoria"></select>
      </div>
      ${prefs.ascolto === 'navigazione' ? `
        <button type="button" class="btn-grande btn-avvia" data-azione="avvia-navigazione">
          <i class="bi bi-megaphone"></i> Avvia la navigazione
        </button>
        <div class="conto-navigazione" id="contoNavigazione" hidden>
          <i class="bi bi-hourglass-split"></i> Parte tra <span>0</span> s
          <small>Premi lo switch per passare al successivo</small>
        </div>` : ''}
      <p class="info-switch2" id="infoSwitch2" hidden></p>
      <div class="brani-list" id="listaStimoli"></div>
    `;
    Ordinabile.attiva(ui.pannello.querySelector('#listaStimoli'), { onCambio: nuovoOrdine });
    ricostruisciElementi();
  }

  // In sequenza il prossimo stimolo è noto: se è un video lo preparo già
  function precaricaProssimo() {
    const inSequenza = prefs.ascolto === 'diretto'
      || (['temporizzato', 'persistente'].includes(prefs.ascolto) && prefs.ordine !== 'random');
    if (prefs.modalita !== 'switch' || !inSequenza || elementi.length === 0) {
      return;
    }
    const prossimo = elementi[(sw.indice + 1) % elementi.length];
    if (prossimo?.tipo === 'youtube') {
      Riproduttore.precaricaYoutube(prossimo.video);
    }
  }

  function ricostruisciElementi() {
    const tutti = stimoliInGioco({ conAudio: !prefs.switch2_audio });

    const select = ui.pannello?.querySelector('#filtroCategoria');
    const categorie = Array.from(new Set(tutti.map((e) => e.categoria)));
    if (select) {
      if (!categorie.includes(prefs.categoria)) {
        prefs.categoria = '';
      }
      select.innerHTML = `<option value="">Tutti gli stimoli</option>${categorie
        .map((c) => `<option value="${Util.escapeHtml(c)}" ${c === prefs.categoria ? 'selected' : ''}>${Util.escapeHtml(c)}</option>`)
        .join('')}`;
      ui.pannello.querySelector('#gruppoCategoria').hidden = categorie.length < 2;
    }

    elementi = prefs.categoria ? tutti.filter((e) => e.categoria === prefs.categoria) : tutti;
    if (sw.corrente && !elementi.some((e) => e.chiave === sw.corrente.chiave)) {
      sw.indice = -1;
    }
    disegnaLista(ui.pannello?.querySelector('#listaStimoli'), elementi, true);
    evidenzia(sw.corrente);
    precaricaProssimo();

    const info = ui.pannello?.querySelector('#infoSwitch2');
    if (info) {
      info.hidden = !prefs.switch2_audio;
      info.innerHTML = dati.audio.length > 0
        ? `<i class="bi bi-arrow-right-square"></i> Freccia DESTRA: <strong>${dati.audio.length} audio</strong> (${prefs.ordine === 'random' ? 'a caso' : 'in ordine'})`
        : '<i class="bi bi-mic-mute"></i> Freccia DESTRA: nessun audio nel gioco';
    }
  }

  function assicuraRecordSwitch() {
    if (!sw.record) {
      sw.record = nuovoRecord('switch', ASCOLTI[prefs.ascolto]?.titolo || '');
    }
    return sw.record;
  }

  function chiudiRecordSwitch() {
    if (sw.record) {
      salvaRecord(sw.record, true);
      sw.record = null;
    }
  }

  function prossimoElemento(casuale) {
    if (elementi.length === 0) {
      return null;
    }
    if (casuale) {
      // A giri: nessuno stimolo si ripete finché non sono passati tutti gli altri
      const el = sw.giro.prossimo(elementi, Util.mescola);
      sw.indice = elementi.indexOf(el);
      return el;
    }
    sw.indice = (sw.indice + 1) % elementi.length;
    return elementi[sw.indice];
  }

  function fermaElementoCorrente() {
    clearTimeout(sw.timerPausa);
    sw.timerPausa = null;
    sw.inPausaTimer = false;
    if (sw.controller) {
      sw.controller.abort();
      sw.controller = null;
    }
    sw.corrente = null;
  }

  function fermaTuttoSwitch() {
    fermaNavigazione();
    fermaSwitch2(false);
    fermaElementoCorrente();
    clearTimeout(sw.timerBlocco);
    sw.timerBlocco = null;
    sw.bloccato = false;
    nascondiIndicatore();
  }

  async function avviaElemento(el) {
    if (!el || !aperta) {
      return;
    }
    fermaElementoCorrente();
    const controller = new AbortController();
    sw.controller = controller;
    sw.corrente = el;
    sw.indice = Math.max(0, elementi.indexOf(el));
    nascondiIndicatore();

    const record = assicuraRecordSwitch();
    record.stimoli++;
    record.per_tipo[el.tipo]++;
    salvaRecord(record);

    if (prefs.ascolto === 'temporizzato' && el.tipo !== 'presa') {
      avviaTimerTemporizzato(controller);
    } else if (prefs.ascolto === 'persistente') {
      avviaTimerPersistente(controller);
    }

    await eseguiStimolo(el, { segnale: controller.signal });
    if (sw.controller !== controller) {
      return;
    }
    // Fine naturale dello stimolo. Il timer persistente, se c'è, continua:
    // lo switch resta disattivato fino alla sua scadenza.
    clearTimeout(sw.timerPausa);
    sw.controller = null;
    sw.corrente = null;
    sw.inPausaTimer = false;
    if (!sw.bloccato) {
      nascondiIndicatore();
    }
    evidenzia(null);
    titoloCorrente('Pronto');
    Riproduttore.scena('riposo', { titolo: 'Premi lo switch per ascoltare' });
    precaricaProssimo();
  }

  function pausaCorrente() {
    if (!sw.corrente) {
      return;
    }
    if (sw.corrente.tipo === 'audio') {
      Riproduttore.pausaAudio();
      Riproduttore.scena('pausa', { titolo: sw.corrente.nome });
    } else if (sw.corrente.tipo === 'youtube') {
      Riproduttore.pausaYoutube();
    }
  }

  function riprendiCorrente() {
    if (!sw.corrente) {
      return;
    }
    if (sw.corrente.tipo === 'audio') {
      Riproduttore.scena('audio', { titolo: sw.corrente.nome });
      Riproduttore.riprendiAudio();
    } else if (sw.corrente.tipo === 'youtube') {
      if (sw.corrente.video.solo_audio) {
        Riproduttore.scena('solo-audio', { titolo: sw.corrente.nome });
      }
      Riproduttore.riprendiYoutube();
    }
  }

  function avviaTimerTemporizzato(controller) {
    clearTimeout(sw.timerPausa);
    sw.timerPausa = setTimeout(() => {
      if (sw.controller !== controller) {
        return;
      }
      pausaCorrente();
      sw.inPausaTimer = true;
      mostraIndicatore('<i class="bi bi-pause-circle"></i> Premi lo switch per continuare');
    }, prefs.timer * 1000);
  }

  function avviaTimerPersistente(controller) {
    clearTimeout(sw.timerBlocco);
    sw.bloccato = true;
    mostraIndicatore('<i class="bi bi-shield-lock"></i> Switch disattivato');
    sw.timerBlocco = setTimeout(() => {
      sw.timerBlocco = null;
      sw.bloccato = false;
      nascondiIndicatore();
      if (sw.controller === controller) {
        pausaCorrente();
        if (sw.corrente?.tipo === 'youtube' && !sw.corrente.video.solo_audio) {
          Riproduttore.scena('video');
        }
      }
    }, prefs.timer * 1000);
  }

  function switchAscolto(numero) {
    const record = assicuraRecordSwitch();
    record.pressioni++;

    if (numero === 2) {
      suonaSwitch2();
      return;
    }
    // Lo switch 1 interrompe l'audio dello switch 2: se la musica era in pausa riprende
    if (sw.audio2) {
      const riprendeVideo = sw.audio2.riprendiVideo;
      fermaSwitch2(true);
      if (riprendeVideo) {
        return;
      }
    }

    if (prefs.ascolto === 'navigazione') {
      switchNavigazione();
      return;
    }
    if (sw.bloccato) {
      record.pressioni_fuori_tempo++;
      return;
    }
    if (prefs.ascolto === 'temporizzato' && sw.inPausaTimer && sw.controller) {
      sw.inPausaTimer = false;
      nascondiIndicatore();
      riprendiCorrente();
      avviaTimerTemporizzato(sw.controller);
      return;
    }

    const casuale = prefs.ascolto === 'random'
      || (['temporizzato', 'persistente'].includes(prefs.ascolto) && prefs.ordine === 'random');
    const el = prossimoElemento(casuale);
    if (!el) {
      titoloCorrente('Nessuno stimolo nel gioco');
      return;
    }
    avviaElemento(el);
  }

  // ---------- Doppio switch: FRECCIA DESTRA = audio registrati ----------

  async function suonaSwitch2() {
    if (dati.audio.length === 0 || sw.audio2) {
      return;
    }
    const audio = Archivio.inOrdine(dati.audio, (a) => `a${a.id}`);
    let el;
    if (prefs.ordine === 'random') {
      const scelto = sw.giro2.prossimo(audio, Util.mescola);
      sw.indice2 = audio.indexOf(scelto);
      el = elementoAudio(scelto);
    } else {
      sw.indice2 = (sw.indice2 + 1) % audio.length;
      el = elementoAudio(audio[sw.indice2]);
    }

    const riprendiVideo = Riproduttore.youtubeStaSuonando();
    if (riprendiVideo) {
      Riproduttore.pausaYoutube();
    }
    const controller = new AbortController();
    sw.audio2 = { controller, riprendiVideo };
    const record = assicuraRecordSwitch();
    record.stimoli++;
    record.per_tipo.audio++;

    Riproduttore.mostraBadge(`🎤 ${el.nome}`);
    if (!Riproduttore.youtubeInCorso()) {
      Riproduttore.scena('audio', { titolo: el.nome });
    }
    await Riproduttore.riproduciAudio(el.record.blob, { segnale: controller.signal });
    if (sw.audio2?.controller === controller) {
      fermaSwitch2(true);
    }
  }

  function fermaSwitch2(riprendiMusica) {
    const a2 = sw.audio2;
    if (!a2) {
      return;
    }
    sw.audio2 = null;
    a2.controller.abort();
    Riproduttore.mostraBadge('');
    if (riprendiMusica && a2.riprendiVideo) {
      Riproduttore.riprendiYoutube();
    }
    if (!Riproduttore.youtubeInCorso() && !sw.corrente && aperta) {
      Riproduttore.scena('riposo', { titolo: 'Premi lo switch per ascoltare' });
    }
  }

  // ---------- Navigazione assistita ----------

  function avviaNavigazione(indice = 0) {
    fermaNavigazione();
    fermaElementoCorrente();
    if (elementi.length === 0) {
      titoloCorrente('Nessuno stimolo nel gioco');
      return;
    }
    assicuraRecordSwitch();
    sw.nav = { indice: indice % elementi.length, controller: new AbortController(), inRiproduzione: false };
    passoNavigazione(sw.nav);
  }

  function fermaNavigazione() {
    if (sw.nav) {
      sw.nav.controller.abort();
      sw.nav = null;
    }
    const conto = ui.pannello?.querySelector('#contoNavigazione');
    if (conto) {
      conto.hidden = true;
    }
  }

  async function passoNavigazione(nav) {
    const segnale = nav.controller.signal;
    const el = elementi[nav.indice];
    if (!el) {
      return;
    }
    evidenzia(el);
    titoloCorrente(el.nome);
    Riproduttore.scena('annuncio', { titolo: el.nome });
    await Riproduttore.parla(el.nome, segnale);
    if (segnale.aborted) {
      return;
    }

    // Conto alla rovescia prima di far partire lo stimolo
    const attesa = prefs.attesa_navigazione;
    const conto = ui.pannello?.querySelector('#contoNavigazione');
    const valore = conto?.querySelector('span');
    Riproduttore.scena('annuncio', { titolo: el.nome, contatore: attesa });
    if (el.tipo === 'youtube') {
      Riproduttore.precaricaYoutube(el.video);
    }
    if (conto) {
      conto.hidden = false;
    }
    for (let s = attesa; s > 0; s--) {
      if (valore) {
        valore.textContent = String(s);
      }
      if (!(await Util.attendi(1000, segnale))) {
        return;
      }
    }
    if (conto) {
      conto.hidden = true;
    }

    nav.inRiproduzione = true;
    const record = assicuraRecordSwitch();
    record.stimoli++;
    record.per_tipo[el.tipo]++;
    salvaRecord(record);
    await eseguiStimolo(el, { segnale });
    nav.inRiproduzione = false;
    if (segnale.aborted || sw.nav !== nav) {
      return;
    }
    nav.indice = (nav.indice + 1) % elementi.length;
    passoNavigazione(nav);
  }

  function switchNavigazione() {
    const comportamento = prefs.spazio_navigazione;
    if (comportamento === 'disabled') {
      return;
    }
    if (!sw.nav) {
      avviaNavigazione(Math.max(0, sw.indice));
      return;
    }
    if (sw.nav.inRiproduzione && comportamento === 'ignore') {
      return;
    }
    const prossimo = (sw.nav.indice + 1) % elementi.length;
    Riproduttore.ferma();
    avviaNavigazione(prossimo);
  }

  // ==================== SWITCH (tasti e tocco) ====================

  function premiSwitch(numero) {
    if (!aperta || menuAperto()) {
      return;
    }
    Riproduttore.sblocca();
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur?.();
    }

    if (prefs.modalita === 'switch') {
      switchAscolto(numero);
      return;
    }
    if (!sessione) {
      return;
    }
    const record = sessione.record;
    record.pressioni++;
    if (sessione.attesaSwitch) {
      sessione.attesaSwitch.risolvi();
    } else if (record.modalita === 'richiesta') {
      record.pressioni_fuori_tempo++;
    }
    aggiornaContatori();
  }

  function numeroSwitch(codice) {
    switch (codice) {
      case 'Space':
      case 'Enter':
      case 'NumpadEnter':
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'ArrowDown':
        return 1;
      case 'ArrowRight':
        return prefs.modalita === 'switch' && prefs.switch2_audio ? 2 : 1;
      default:
        return 0;
    }
  }

  function alTastoGiu(e) {
    if (!aperta || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    if (e.key === 'Escape') {
      if (menuAperto()) {
        alternaOpzioni(false);
      } else if (sessione) {
        fermaSessione();
      } else if (prefs.modalita === 'switch') {
        fermaTuttoSwitch();
        Riproduttore.ferma();
        Riproduttore.scena('riposo', { titolo: 'Premi lo switch per ascoltare' });
        titoloCorrente('Pronto');
        evidenzia(null);
      }
      return;
    }
    if (menuAperto() || document.querySelector('.modal.active') || Util.daCampoDiTesto(e) || e.target.closest?.('.maniglia')) {
      return;
    }
    const numero = numeroSwitch(e.code);
    if (!numero) {
      return;
    }
    e.preventDefault();
    if (tastiPremuti.has(e.code)) {
      return; // tasto tenuto premuto: conta una sola volta
    }
    tastiPremuti.add(e.code);
    premiSwitch(numero);
  }

  function alTastoSu(e) {
    tastiPremuti.delete(e.code);
  }

  // ==================== PANNELLO: CLICK E CAMBI ====================

  function alClickPannello(e) {
    const btn = e.target.closest('[data-azione]');
    if (!btn) {
      return;
    }
    const azione = btn.dataset.azione;
    Riproduttore.sblocca();
    if (azione === 'avvia') {
      avviaSessione();
    } else if (azione === 'ferma') {
      fermaSessione();
    } else if (azione === 'avvia-navigazione') {
      avviaNavigazione(0);
      btn.blur();
    } else if (azione === 'riproduci') {
      const el = elementi.find((x) => x.chiave === btn.dataset.chiave);
      if (el) {
        if (prefs.ascolto === 'navigazione') {
          avviaNavigazione(elementi.indexOf(el));
        } else {
          fermaNavigazione();
          const record = assicuraRecordSwitch();
          record.pressioni++;
          avviaElemento(el);
        }
      }
    }
  }

  function alCambioPannello(e) {
    if (e.target.type === 'range') {
      e.target.blur();
      return;
    }
    // Vale dal prossimo stimolo, anche a sessione avviata
    if (e.target.name === 'ordineSessione') {
      Archivio.salvaImpostazioni({ stimolazione: { ordine: e.target.value } });
      e.target.blur();
      return;
    }
    if (e.target.id === 'filtroCategoria') {
      prefs.categoria = e.target.value;
      salvaPrefs();
      fermaTuttoSwitch();
      Riproduttore.ferma();
      sw.indice = -1;
      ricostruisciElementi();
      e.target.blur();
      if (prefs.ascolto === 'navigazione' && elementi.length > 0) {
        avviaNavigazione(0);
      } else {
        Riproduttore.scena('riposo', { titolo: 'Premi lo switch per ascoltare' });
      }
    }
  }

  // Chiusura improvvisa (scheda chiusa, app in background): salvo il registro
  window.addEventListener('pagehide', () => {
    if (sessione) {
      salvaRecord(sessione.record, true);
      Presa.spegni(Archivio.getImpostazioni().presa.prese).catch(() => {});
    }
    if (sw.record) {
      salvaRecord(sw.record, true);
    }
  });

  return {
    apri,
    chiudi,
    alternaOpzioni,
    get aperta() {
      return aperta;
    },
  };
})();
