// ==================== AREA EDUCATORE ====================
// Qui l'educatore prepara gli stimoli e le regole della sessione:
//   Audio        registrazioni dal microfono e file dal disco
//   YouTube      video (anche "solo audio") con tempi di inizio/fine
//   Anticipatore l'audio che annuncia ogni stimolo
//   Presa        collegamento alla presa smart
//   Tempi        attese casuali, durata massima, tipi di stimolo
//   Registro     sessioni svolte e risposte dell'utente

const Educatore = (() => {
  const SCHEDE = [
    // Solo nell'APK: i tipi di stimolo hanno una scheda propria, in prima posizione
    ...(Util.apk ? [{ id: 'stimoli', icona: 'bi-ui-checks-grid', titolo: 'Stimoli' }] : []),
    { id: 'audio', icona: 'bi-mic-fill', titolo: 'Audio' },
    { id: 'youtube', icona: 'bi-youtube', titolo: 'YouTube' },
    { id: 'anticipatore', icona: 'bi-bell', titolo: 'Anticipatore' },
    { id: 'presa', icona: 'bi-plug-fill', titolo: 'Presa' },
    { id: 'tempi', icona: 'bi-stopwatch', titolo: 'Tempi' },
    { id: 'registro', icona: 'bi-clipboard-data', titolo: 'Registro' },
  ];

  const RICERCA_PREDEFINITA = 'musica per bambini';
  const ANTICIPATORE_PREDEFINITO = 'assets/audio/anticipatore.mp3';
  const NOTA_ORDINE = 'in ordine di riproduzione: si cambia nell\'Area Utente trascinando <i class="bi bi-grip-vertical"></i>';

  let contenuto = null;
  let schedaAttiva = Util.apk ? 'stimoli' : 'audio';
  let acquisizione = null;
  let finestraYoutube = null;
  let timerRicerca = null;
  let rimuoviAscoltoPresa = null;
  let rimuoviAscoltoSegnali = null;   // solo APK: aggiorna i segnali quando cambia la presa

  const anteprima = new Audio();
  let urlAnteprima = null;

  // Controllo dei video YouTube: un piccolo player di anteprima nel modulo
  let playerVerifica = null;
  let eventiVerifica = null;
  let timerVerifica = null;
  let verifica = { videoId: '', esito: null };   // esito: null | 'attesa' | {ok, codice?}

  // Importazione di una playlist: player nascosto usato solo per leggere l'elenco
  let playerImport = null;
  let importInCorso = false;

  function distruggiVerifica() {
    clearTimeout(timerVerifica);
    try {
      playerVerifica?.destroy();
    } catch (e) { /* già distrutto */ }
    playerVerifica = null;
    eventiVerifica = null;
    verifica = { videoId: '', esito: null };
    distruggiImport();
  }

  function distruggiImport() {
    try {
      playerImport?.destroy();
    } catch (e) { /* già distrutto */ }
    playerImport = null;
  }

  // ==================== STRUTTURA ====================

  function apri(contenitore) {
    contenitore.innerHTML = `
      <div class="educatore">
        <section class="panel pannello-educatore" aria-label="Configurazione">
          <div class="intestazione-area">
            <h2><i class="bi bi-gear-fill"></i> Configurazione</h2>
            <button type="button" class="btn-secondary btn-piccolo" data-azione="vai-utente">
              <i class="bi bi-play-circle-fill"></i> Vai all'esercizio
            </button>
          </div>
          <nav class="schede" role="tablist" aria-label="Sezioni">
            ${SCHEDE.map((s) => `
              <button type="button" class="scheda" role="tab" data-scheda="${s.id}">
                <i class="bi ${s.icona}"></i><span>${s.titolo}</span>
                ${Util.apk ? '<span class="segnale" aria-hidden="true"></span>' : ''}
              </button>`).join('')}
          </nav>
          <div class="scheda-contenuto" id="schedaContenuto"></div>
        </section>
      </div>
    `;

    contenuto = contenitore.querySelector('#schedaContenuto');
    contenitore.querySelector('.schede').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-scheda]');
      if (btn) {
        mostraScheda(btn.dataset.scheda);
      }
    });
    contenitore.querySelector('[data-azione="vai-utente"]').addEventListener('click', () => App.mostraUtente());
    contenuto.addEventListener('click', gestisciClick);
    contenuto.addEventListener('change', gestisciCambio);
    if (Util.apk) {
      rimuoviAscoltoSegnali = Presa.onCambio(() => aggiornaSegnali());
    }

    mostraScheda(schedaAttiva);
  }

  function chiudi() {
    rimuoviAscoltoSegnali?.();
    rimuoviAscoltoSegnali = null;
    acquisizione?.chiudi();
    acquisizione = null;
    fermaAnteprima();
    distruggiVerifica();
    rimuoviAscoltoPresa?.();
    rimuoviAscoltoPresa = null;
    clearTimeout(timerRicerca);
    contenuto = null;
  }

  function mostraScheda(id) {
    if (!contenuto) {
      return;
    }
    acquisizione?.chiudi();
    acquisizione = null;
    fermaAnteprima();
    distruggiVerifica();
    rimuoviAscoltoPresa?.();
    rimuoviAscoltoPresa = null;

    schedaAttiva = id;
    document.querySelectorAll('.schede .scheda').forEach((b) => {
      const attiva = b.dataset.scheda === id;
      b.classList.toggle('attiva', attiva);
      b.setAttribute('aria-selected', attiva ? 'true' : 'false');
    });

    const disegna = {
      stimoli: schedaStimoli,
      audio: schedaAudio,
      youtube: schedaYoutube,
      anticipatore: schedaAnticipatore,
      presa: schedaPresa,
      tempi: schedaTempi,
      registro: schedaRegistro,
    }[id] || schedaAudio;
    disegna();
    aggiornaSegnali();
  }

  // Solo nell'APK: su ogni pulsante una spunta verde se quella parte è configurata,
  // un "!" arancione se manca qualcosa che serve. Calcolato dallo stato reale.
  async function aggiornaSegnali() {
    if (!Util.apk || !contenuto) {
      return;
    }
    const imp = Archivio.getImpostazioni();
    const ev = imp.stimolazione.eventi;
    let audio = [];
    try {
      audio = await Archivio.audioLista();
    } catch (e) { /* archivio non leggibile: risulta "nessun audio" */ }
    const nAudio = audio.filter((a) => a.attivo && a.blob).length;
    const nVideo = Archivio.getYoutube().filter((v) => v.attivo && !Riproduttore.erroreDefinitivo(v.errore)).length;
    const presaOk = Presa.disponibile();
    const sceltiNumeri = categorieAnticipatore().map((c) => sceltaDi(imp, c.cat)).filter((v) => typeof v === 'number');
    const anticipatoreOk = sceltiNumeri.every((id) => audio.some((a) => a.id === id && a.blob));
    const mancanti = [];
    if (ev.audio && !nAudio) {
      mancanti.push('nessun audio nel gioco');
    }
    if (ev.youtube && !nVideo) {
      mancanti.push('nessun video nel gioco');
    }
    if (ev.presa && !presaOk) {
      mancanti.push('presa non collegata');
    }
    // [stato, spiegazione] — null = area non in uso, nessun segnale
    const segnali = {
      stimoli: mancanti.length ? ['manca', `Da completare: ${mancanti.join(', ')}`] : ['ok', 'Tipi di stimolo pronti'],
      audio: ev.audio ? (nAudio ? ['ok', `${nAudio} audio nel gioco`] : ['manca', 'Nessun audio nel gioco']) : null,
      youtube: ev.youtube ? (nVideo ? ['ok', `${nVideo} video nel gioco`] : ['manca', 'Nessun video nel gioco']) : null,
      presa: ev.presa ? (presaOk ? ['ok', 'Presa collegata'] : ['manca', 'La presa è tra gli stimoli usati ma non è collegata']) : null,
      anticipatore: anticipatoreOk ? ['ok', 'Anticipatori scelti'] : ['manca', 'Un audio anticipatore scelto non esiste più'],
      tempi: ['ok', 'Tempi impostati'],
    };
    document.querySelectorAll('.schede .scheda').forEach((b) => {
      const segnale = b.querySelector('.segnale');
      const s = segnali[b.dataset.scheda];
      if (!segnale) {
        return;
      }
      if (!s) {
        b.removeAttribute('data-segnale');
        b.removeAttribute('title');
        segnale.innerHTML = '';
        return;
      }
      b.dataset.segnale = s[0];
      b.title = s[1];
      segnale.innerHTML = `<i class="bi ${s[0] === 'ok' ? 'bi-check-lg' : 'bi-exclamation-lg'}"></i>`;
    });
  }

  function stato(selettore, messaggio, tipo = 'info') {
    const box = contenuto?.querySelector(selettore);
    if (box) {
      box.textContent = messaggio || '';
      box.className = `status-message ${messaggio ? tipo : ''}`;
    }
  }

  // ==================== ANTEPRIMA AUDIO ====================

  function ascolta(sorgente) {
    fermaAnteprima();
    if (sorgente instanceof Blob) {
      urlAnteprima = URL.createObjectURL(sorgente);
      anteprima.src = urlAnteprima;
    } else {
      anteprima.src = sorgente;
    }
    anteprima.play().catch(() => {});
  }

  function fermaAnteprima() {
    anteprima.pause();
    if (urlAnteprima) {
      URL.revokeObjectURL(urlAnteprima);
      urlAnteprima = null;
    }
  }

  // ==================== SCHEDA AUDIO ====================

  function schedaAudio() {
    contenuto.innerHTML = `
      <h3><i class="bi bi-mic-fill"></i> Audio registrati e caricati</h3>
      <p class="helper-text">
        Registra una voce con il microfono di questo dispositivo oppure carica <strong>qualsiasi file
        audio</strong> dal disco (MP3, vocali di <strong>WhatsApp</strong>, M4A, WAV, AMR, WMA, AIFF…, anche
        l'audio di un video): viene convertito in MP3 in automatico e il silenzio iniziale e finale
        viene tagliato. Gli audio con la spunta <strong>Nel gioco</strong> diventano stimoli.
        I nuovi audio si ascoltano <strong>per intero</strong>: togli la spunta «Sempre per intero»
        per fermarli al tempo impostato nella scheda Tempi.
      </p>
      <div id="acqAudio"></div>
      <h4 class="titolo-lista"><i class="bi bi-collection-play"></i> Audio archiviati</h4>
      <div id="statoListaAudio" class="status-message" role="status" aria-live="polite"></div>
      <div id="listaAudio" class="lista-elementi"></div>
    `;

    acquisizione = ElaboraAudio.crea(contenuto.querySelector('#acqAudio'), {
      etichettaSalva: 'Salva audio',
      onSalva: async ({ nome, blob, durata, origine }) => {
        // Quasi tutti gli audio sono voci di familiari: nascono "per intero"
        await Archivio.audioAggiungi({ nome, blob, durata, origine, intero: true });
        disegnaListaAudio();
        aggiornaSegnali();
        return `✅ "${nome}" salvato e messo nel gioco: si ascolta per intero.`;
      },
    });

    disegnaListaAudio();
  }

  async function disegnaListaAudio() {
    const lista = contenuto?.querySelector('#listaAudio');
    if (!lista) {
      return;
    }
    let audio;
    try {
      audio = await Archivio.audioLista();
    } catch (e) {
      lista.innerHTML = `<p class="vuoto errore"><i class="bi bi-exclamation-triangle"></i> ${Util.escapeHtml(e.message)}</p>`;
      return;
    }
    if (!contenuto?.querySelector('#listaAudio')) {
      return;
    }
    audio = audio.filter((a) => !a.anticipa);
    if (audio.length === 0) {
      lista.innerHTML = '<p class="vuoto"><i class="bi bi-mic-mute"></i> Nessun audio archiviato su questo dispositivo.</p>';
      return;
    }

    // Stessa sequenza dell'Area Utente, dove si cambia trascinando gli stimoli
    audio = Archivio.inOrdine(audio, (a) => `a${a.id}`);
    const impAudio = Archivio.getImpostazioni();
    const inGioco = audio.filter((a) => a.attivo).length;
    lista.innerHTML = `
      <p class="conteggio">${inGioco} nel gioco su ${audio.length} · ${NOTA_ORDINE}</p>
      ${audio.map((a) => {
        const eAnticipatore = usiDi(impAudio, a.id).length > 0;
        return `
          <div class="elemento ${a.attivo ? 'attivo' : ''}">
            <label class="spunta" title="Usa questo audio come stimolo">
              <input type="checkbox" data-azione="audio-attivo" data-id="${a.id}" ${a.attivo ? 'checked' : ''} />
              <span>Nel gioco</span>
            </label>
            <i class="bi ${a.origine === 'registrazione' ? 'bi-mic-fill' : 'bi-file-earmark-music'} elemento-icona"></i>
            <div class="elemento-testo">
              <strong>${Util.escapeHtml(a.nome)}</strong>
              <small>${(Number(a.durata) || 0).toFixed(1)} s · ${Util.formatoData(a.data_creazione)}
                ${eAnticipatore ? ' · <span class="etichetta"><i class="bi bi-bell-fill"></i> anticipatore</span>' : ''}</small>
              <label class="spunta" title="Ignora la durata massima generale: questo audio si ascolta sempre tutto">
                <input type="checkbox" data-azione="audio-intero" data-id="${a.id}" ${a.intero ? 'checked' : ''} />
                <span>Sempre per intero</span>
              </label>
            </div>
            <button type="button" class="btn-icona" data-azione="audio-ascolta" data-id="${a.id}" title="Ascolta">
              <i class="bi bi-play-fill"></i>
            </button>
            <button type="button" class="btn-icona pericolo" data-azione="audio-elimina" data-id="${a.id}" title="Elimina">
              <i class="bi bi-trash3"></i>
            </button>
          </div>`;
      }).join('')}
    `;
  }

  // ==================== SCHEDA YOUTUBE ====================

  function schedaYoutube() {
    contenuto.innerHTML = `
      <h3><i class="bi bi-youtube"></i> Video YouTube</h3>
      <p class="helper-text">
        Scrivi la categoria: dopo un secondo si apre YouTube con la ricerca. Scegli il video,
        copia il link dalla barra degli indirizzi e incollalo qui sotto.
      </p>
      <form id="formYoutube" class="form-grid" novalidate>
        <div class="form-group">
          <label for="ytCategoria">Categoria *</label>
          <input id="ytCategoria" type="text" maxlength="100" required list="ytCategorie"
            placeholder="Es: canzoni per bambini" autocomplete="off" />
          <datalist id="ytCategorie">
            ${Archivio.getCategorie().map((c) => `<option value="${Util.escapeHtml(c)}"></option>`).join('')}
          </datalist>
        </div>
        <div class="form-group">
          <label for="ytLink">Link YouTube *</label>
          <input id="ytLink" type="url" maxlength="500" required autocomplete="off"
            placeholder="https://www.youtube.com/watch?v=..." />
        </div>
        <div class="verifica-video" id="ytVerifica" hidden>
          <div class="yt-anteprima"><div id="ytAnteprimaPlayer"></div></div>
          <p class="verifica-esito" id="ytVerificaEsito" role="status" aria-live="polite"></p>
        </div>
        <div class="form-group">
          <label for="ytNome">Nome *</label>
          <input id="ytNome" type="text" maxlength="150" required autocomplete="off"
            placeholder="Es: Ninna nanna dolce" />
        </div>
        <div class="riga-2">
          <div class="form-group">
            <label>Inizio (facoltativo)</label>
            <div class="tempo">
              <input id="ytInizioMin" type="number" min="0" max="999" placeholder="min" aria-label="Minuti di inizio" />
              <span>:</span>
              <input id="ytInizioSec" type="number" min="0" max="59" placeholder="sec" aria-label="Secondi di inizio" />
            </div>
          </div>
          <div class="form-group">
            <label>Fine (facoltativo)</label>
            <div class="tempo">
              <input id="ytFineMin" type="number" min="0" max="999" placeholder="min" aria-label="Minuti di fine" />
              <span>:</span>
              <input id="ytFineSec" type="number" min="0" max="59" placeholder="sec" aria-label="Secondi di fine" />
            </div>
          </div>
        </div>
        <label class="spunta grande">
          <input id="ytSoloAudio" type="checkbox" />
          <span><i class="bi bi-music-note-beamed"></i> Fai sentire <strong>solo l'audio</strong> (il video resta coperto)</span>
        </label>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="bi bi-save"></i> Salva video</button>
          <button type="reset" class="btn-secondary"><i class="bi bi-eraser"></i> Svuota</button>
        </div>
        <div id="statoYoutube" class="status-message" role="status" aria-live="polite"></div>
      </form>

      <div class="blocco-playlist">
        <h4 class="titolo-lista"><i class="bi bi-list-ol"></i> Importa una playlist</h4>
        <p class="helper-text">
          Incolla il link di una playlist di YouTube: i suoi video vengono aggiunti sotto,
          uno per uno, con il titolo di YouTube e la categoria uguale al nome della playlist.
        </p>
        <form id="formPlaylist" class="form-grid" novalidate>
          <div class="form-group">
            <label for="ytPlaylist">Link playlist</label>
            <input id="ytPlaylist" type="url" maxlength="600" autocomplete="off"
              placeholder="https://www.youtube.com/playlist?list=..." />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn-primary"><i class="bi bi-download"></i> Importa playlist</button>
          </div>
          <div id="statoPlaylist" class="status-message" role="status" aria-live="polite"></div>
        </form>
        <div id="ytImportPlayer" class="import-player-nascosto" aria-hidden="true"></div>
      </div>

      <h4 class="titolo-lista"><i class="bi bi-collection-play"></i> Video archiviati</h4>
      <div id="listaYoutube" class="lista-elementi"></div>
    `;

    const categoria = contenuto.querySelector('#ytCategoria');
    categoria.addEventListener('input', () => {
      clearTimeout(timerRicerca);
      const testo = categoria.value.trim();
      if (testo.length >= 3) {
        timerRicerca = setTimeout(() => apriRicercaYoutube(testo), 1000);
      }
    });
    contenuto.querySelector('#formYoutube').addEventListener('submit', salvaVideo);
    contenuto.querySelector('#formYoutube').addEventListener('reset', () => {
      const box = contenuto?.querySelector('#ytVerifica');
      if (box) {
        box.hidden = true;
      }
      verifica = { videoId: '', esito: null };
    });
    const link = contenuto.querySelector('#ytLink');
    link.addEventListener('input', () => {
      clearTimeout(timerVerifica);
      timerVerifica = setTimeout(() => verificaVideo(link.value), 500);
    });

    contenuto.querySelector('#formPlaylist').addEventListener('submit', importaPlaylist);

    disegnaListaYoutube();
  }

  function esitoVerifica(testo, classe) {
    const p = contenuto?.querySelector('#ytVerificaEsito');
    if (p) {
      p.textContent = testo;
      p.className = `verifica-esito ${classe}`;
    }
  }

  // Carica il video in un piccolo player: YouTube segnala subito (onError) se il
  // proprietario non ne permette la riproduzione fuori dal suo sito
  async function verificaVideo(testo) {
    const box = contenuto?.querySelector('#ytVerifica');
    if (!box) {
      return;
    }
    const id = Util.estraiVideoId(testo);
    if (!id) {
      box.hidden = true;
      verifica = { videoId: '', esito: null };
      return;
    }
    if (id === verifica.videoId && verifica.esito && verifica.esito !== 'attesa') {
      return;
    }
    verifica = { videoId: id, esito: 'attesa' };
    box.hidden = false;
    esitoVerifica('⏳ Controllo del video…', 'attesa');
    try {
      await Riproduttore.attendiApiYoutube(8000);
    } catch (e) {
      verifica.esito = null;
      esitoVerifica('YouTube non è raggiungibile: il controllo richiede internet.', 'attesa');
      return;
    }
    const risultato = await new Promise((resolve) => {
      let fatto = false;
      const fine = (r) => {
        if (!fatto) {
          fatto = true;
          clearTimeout(tempoMassimo);
          resolve(r);
        }
      };
      const tempoMassimo = setTimeout(() => fine({ ok: true, incerto: true }), 8000);
      eventiVerifica = {
        // 5 = video pronto: se entro poco non arriva un errore, si può usare
        stato: (s) => {
          if (s === 5 || s === 1) {
            setTimeout(() => fine({ ok: true }), 1200);
          }
        },
        errore: (codice) => fine({ ok: false, codice }),
      };
      if (playerVerifica) {
        playerVerifica.cueVideoById(id);
      } else if (contenuto?.querySelector('#ytAnteprimaPlayer')) {
        playerVerifica = new YT.Player('ytAnteprimaPlayer', {
          width: '100%',
          height: '100%',
          videoId: id,
          playerVars: { rel: 0, playsinline: 1, modestbranding: 1, enablejsapi: 1, origin: window.location.origin },
          events: {
            onStateChange: (e) => eventiVerifica?.stato(e.data),
            onError: (e) => eventiVerifica?.errore(e.data),
          },
        });
      } else {
        fine({ ok: true, incerto: true });
      }
    });
    if (verifica.videoId !== id) {
      return; // nel frattempo il link è cambiato
    }
    verifica.esito = risultato;
    if (risultato.ok) {
      esitoVerifica(risultato.incerto
        ? 'Il video sembra a posto (YouTube non ha confermato in tempo).'
        : '✅ Il video si può usare in Mastertutor.', risultato.incerto ? 'attesa' : 'ok');
    } else {
      esitoVerifica(`❌ ${Riproduttore.descriviErroreYoutube(risultato.codice)} Cerca un'altra versione dello stesso brano.`, 'errore');
    }
  }

  function salvaVideo(evento) {
    evento.preventDefault();
    const f = (id) => contenuto.querySelector(id);
    const categoria = f('#ytCategoria').value.trim();
    const link = f('#ytLink').value.trim();
    const nome = f('#ytNome').value.trim();
    const videoId = Util.estraiVideoId(link);
    const inizio = Util.secondiDa(f('#ytInizioMin').value, f('#ytInizioSec').value);
    const fine = Util.secondiDa(f('#ytFineMin').value, f('#ytFineSec').value);

    if (!categoria || !link || !nome) {
      stato('#statoYoutube', 'Compila categoria, link e nome.', 'error');
      return;
    }
    if (!videoId) {
      stato('#statoYoutube', 'Il link non sembra un indirizzo YouTube valido.', 'error');
      return;
    }
    if (fine > 0 && fine <= inizio) {
      stato('#statoYoutube', 'Il tempo di fine deve essere dopo il tempo di inizio.', 'error');
      return;
    }
    if (verifica.videoId === videoId && verifica.esito && verifica.esito.ok === false) {
      stato('#statoYoutube', `Questo video non si può usare: ${Riproduttore.descriviErroreYoutube(verifica.esito.codice)}`, 'error');
      return;
    }

    try {
      Archivio.aggiungiYoutube({
        nome, categoria, link, video_id: videoId, inizio, fine, solo_audio: f('#ytSoloAudio').checked,
      });
      f('#formYoutube').reset();
      contenuto.querySelector('#ytVerifica').hidden = true;
      verifica = { videoId: '', esito: null };
      stato('#statoYoutube', `✅ "${nome}" salvato e messo nel gioco.`, 'success');
      aggiornaSegnali();
      const datalist = f('#ytCategorie');
      datalist.innerHTML = Archivio.getCategorie().map((c) => `<option value="${Util.escapeHtml(c)}"></option>`).join('');
      disegnaListaYoutube();
    } catch (e) {
      stato('#statoYoutube', e.message, 'error');
    }
  }

  // ==================== IMPORTAZIONE PLAYLIST ====================

  // Legge l'elenco dei video di una playlist riusando il player di YouTube:
  // niente chiave API, tutto lato client. Restituisce gli id dei video.
  function enumeraPlaylist(playlistId) {
    return new Promise((resolve, reject) => {
      const box = contenuto?.querySelector('#ytImportPlayer');
      if (!box) {
        reject(new Error('Riquadro di importazione non disponibile.'));
        return;
      }
      // YT.Player sostituisce l'elemento bersaglio con un iframe: ne uso uno
      // nuovo ogni volta, così il riquadro contenitore resta al suo posto.
      box.innerHTML = '<div id="ytImportTarget"></div>';
      let concluso = false;
      let sonda = null;
      const scadenza = setTimeout(
        () => fine(null, new Error('La playlist non risponde: potrebbe essere vuota o privata.')),
        15000,
      );
      function fine(ids, errore) {
        if (concluso) {
          return;
        }
        concluso = true;
        clearTimeout(scadenza);
        clearInterval(sonda);
        if (errore) {
          reject(errore);
        } else {
          resolve(ids);
        }
      }
      const leggi = () => {
        try {
          const ids = playerImport?.getPlaylist?.();
          if (Array.isArray(ids) && ids.length) {
            fine(ids.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)));
          }
        } catch (e) { /* non ancora pronto */ }
      };
      try {
        playerImport = new YT.Player('ytImportTarget', {
          width: '1',
          height: '1',
          playerVars: {
            listType: 'playlist', list: playlistId,
            enablejsapi: 1, origin: window.location.origin,
          },
          events: {
            onReady: () => { sonda = setInterval(leggi, 300); leggi(); },
            onError: (e) => fine(null, new Error(`YouTube non apre la playlist (codice ${e.data}).`)),
          },
        });
      } catch (e) {
        fine(null, e);
      }
    });
  }

  // Titolo di un video o di una playlist tramite oEmbed (gratis, senza chiave).
  async function titoloOEmbed(indirizzo) {
    try {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(indirizzo)}&format=json`;
      const risposta = await fetch(url);
      if (!risposta.ok) {
        return null;
      }
      const dati = await risposta.json();
      const titolo = (dati && dati.title ? String(dati.title) : '').trim();
      return titolo || null;
    } catch (e) {
      return null;
    }
  }

  async function importaPlaylist(evento) {
    evento.preventDefault();
    if (importInCorso) {
      return;
    }
    const campo = contenuto.querySelector('#ytPlaylist');
    const url = campo.value.trim();
    const playlistId = Util.estraiPlaylistId(url);
    if (!url) {
      stato('#statoPlaylist', 'Incolla il link di una playlist di YouTube.', 'error');
      return;
    }
    if (!playlistId) {
      stato('#statoPlaylist', 'Il link non contiene una playlist valida (manca il parametro "list"). Le liste "Guarda più tardi" e "Mi piace" sono private e non si possono importare.', 'error');
      return;
    }
    if (navigator.onLine === false) {
      stato('#statoPlaylist', 'Serve la connessione a internet per leggere la playlist.', 'error');
      return;
    }

    importInCorso = true;
    const bottone = contenuto.querySelector('#formPlaylist button[type="submit"]');
    if (bottone) {
      bottone.disabled = true;
    }
    stato('#statoPlaylist', '⏳ Apertura della playlist…', 'info');
    try {
      await Riproduttore.attendiApiYoutube(8000);
      distruggiImport();
      const ids = await enumeraPlaylist(playlistId);
      const nomePlaylist = (await titoloOEmbed(`https://www.youtube.com/playlist?list=${playlistId}`)) || 'Playlist importata';
      let aggiunti = 0;
      let gia = 0;
      for (let i = 0; i < ids.length; i++) {
        stato('#statoPlaylist', `⏳ Importazione di "${nomePlaylist}"… ${i + 1}/${ids.length}`, 'info');
        const id = ids[i];
        const link = `https://www.youtube.com/watch?v=${id}`;
        const titolo = (await titoloOEmbed(link)) || `${nomePlaylist} #${i + 1}`;
        try {
          Archivio.aggiungiYoutube({
            nome: titolo, categoria: nomePlaylist, link, video_id: id,
            playlist_id: playlistId, playlist_nome: nomePlaylist,
          });
          aggiunti++;
        } catch (e) {
          gia++;   // già presente (stesso video già in lista)
        }
      }
      distruggiImport();
      campo.value = '';
      const parti = [`✅ ${aggiunti} video aggiunti da "${nomePlaylist}"`];
      if (gia) {
        parti.push(`${gia} già presenti`);
      }
      stato('#statoPlaylist', parti.join(' · '), aggiunti ? 'success' : 'info');
      aggiornaSegnali();
      const datalist = contenuto.querySelector('#ytCategorie');
      if (datalist) {
        datalist.innerHTML = Archivio.getCategorie().map((c) => `<option value="${Util.escapeHtml(c)}"></option>`).join('');
      }
      disegnaListaYoutube();
    } catch (e) {
      distruggiImport();
      stato('#statoPlaylist', `❌ ${e.message}`, 'error');
    } finally {
      importInCorso = false;
      if (bottone) {
        bottone.disabled = false;
      }
    }
  }

  // Una singola scheda video, usata sia per i video singoli sia dentro un gruppo playlist
  function cardYoutube(v) {
    const tempi = (v.inizio || v.fine)
      ? ` · <i class="bi bi-clock"></i> ${Util.formatoTempo(v.inizio)}${v.fine ? `–${Util.formatoTempo(v.fine)}` : ''}`
      : '';
    const avviso = Riproduttore.erroreDefinitivo(v.errore) ? `
          <div class="avviso-video">
            <i class="bi bi-exclamation-triangle-fill"></i>
            <span>Non riproducibile: ${Util.escapeHtml(Riproduttore.descriviErroreYoutube(v.errore))} Non viene proposto.</span>
            <button type="button" class="btn-secondary btn-piccolo" data-azione="yt-riprova" data-id="${v.id}">Riprova</button>
          </div>` : '';
    return `
      <div class="elemento ${v.attivo ? 'attivo' : ''}">
        <img class="miniatura" src="https://img.youtube.com/vi/${v.video_id}/mqdefault.jpg" alt="" loading="lazy" />
        <div class="elemento-testo">
          <strong>${Util.escapeHtml(v.nome)}</strong>
          <small>${Util.escapeHtml(v.categoria || 'Senza categoria')}${tempi}</small>
          <div class="spunte-riga">
            <label class="spunta">
              <input type="checkbox" data-azione="yt-attivo" data-id="${v.id}" ${v.attivo ? 'checked' : ''} />
              <span>Nel gioco</span>
            </label>
            <label class="spunta">
              <input type="checkbox" data-azione="yt-solo-audio" data-id="${v.id}" ${v.solo_audio ? 'checked' : ''} />
              <span>Solo audio</span>
            </label>
            <label class="spunta" title="Ignora la durata massima generale: questo video si ascolta sempre tutto (o tutto l'intervallo inizio–fine)">
              <input type="checkbox" data-azione="yt-intero" data-id="${v.id}" ${v.intero ? 'checked' : ''} />
              <span>Sempre per intero</span>
            </label>
          </div>
          <div class="tempi-riga" data-tempi-id="${v.id}">
            <label class="campo-tempo">
              <span>Inizio</span>
              <input type="number" min="0" max="99999" inputmode="numeric" data-azione="yt-inizio" data-id="${v.id}" value="${v.inizio || 0}" aria-label="Secondo di inizio" />
              <span class="unita">sec</span>
            </label>
            <label class="campo-tempo">
              <span>Fine</span>
              <input type="number" min="0" max="99999" inputmode="numeric" data-azione="yt-fine" data-id="${v.id}" value="${v.fine || ''}" placeholder="fine" aria-label="Secondo di fine" />
              <span class="unita">sec</span>
            </label>
            <span class="tempi-esito" data-esito-id="${v.id}" role="status" aria-live="polite"></span>
          </div>
          ${avviso}
        </div>
        <a class="btn-icona" href="${Util.escapeHtml(v.link)}" target="_blank" rel="noopener" title="Apri su YouTube">
          <i class="bi bi-box-arrow-up-right"></i>
        </a>
        <button type="button" class="btn-icona pericolo" data-azione="yt-elimina" data-id="${v.id}" title="Elimina">
          <i class="bi bi-trash3"></i>
        </button>
      </div>`;
  }

  // Salva inizio/fine (in secondi) del singolo video quando l'educatore li cambia.
  // Vale per tutti i video, compresi quelli importati da una playlist.
  function salvaTempiVideo(id) {
    const riga = contenuto?.querySelector(`[data-tempi-id="${id}"]`);
    if (!riga) {
      return;
    }
    const esito = riga.querySelector('.tempi-esito');
    const mostra = (testo, classe) => {
      if (esito) {
        esito.textContent = testo;
        esito.className = `tempi-esito ${classe}`;
      }
    };
    const inizio = Math.max(0, parseInt(riga.querySelector('[data-azione="yt-inizio"]').value, 10) || 0);
    const fine = Math.max(0, parseInt(riga.querySelector('[data-azione="yt-fine"]').value, 10) || 0);
    if (fine > 0 && fine <= inizio) {
      mostra('La fine deve essere dopo l\'inizio', 'errore');
      return;
    }
    Archivio.aggiornaYoutube(id, { inizio, fine });
    mostra('✓ salvato', 'ok');
  }

  function disegnaListaYoutube() {
    const lista = contenuto?.querySelector('#listaYoutube');
    if (!lista) {
      return;
    }
    // Stessa sequenza dell'Area Utente, dove si cambia trascinando gli stimoli
    const video = Archivio.inOrdine(Archivio.getYoutube(), (v) => `y${v.id}`);
    if (video.length === 0) {
      lista.innerHTML = '<p class="vuoto"><i class="bi bi-youtube"></i> Nessun video archiviato su questo dispositivo.</p>';
      return;
    }
    const inGioco = video.filter((v) => v.attivo).length;
    // I video di una stessa playlist si raggruppano sotto un'intestazione,
    // alla posizione (nell'ordine di riproduzione) del loro primo video.
    const playlistRese = new Set();
    const blocchi = [];
    for (const v of video) {
      if (v.playlist_id) {
        if (playlistRese.has(v.playlist_id)) {
          continue;
        }
        playlistRese.add(v.playlist_id);
        const membri = video.filter((x) => x.playlist_id === v.playlist_id);
        const nome = v.playlist_nome || 'Playlist';
        const attiviGruppo = membri.filter((m) => m.attivo).length;
        blocchi.push(`
          <div class="gruppo-playlist">
            <div class="gruppo-playlist-intestazione">
              <div class="gruppo-playlist-titolo">
                <i class="bi bi-list-ol"></i>
                <strong>Playlist: ${Util.escapeHtml(nome)}</strong>
                <small>${attiviGruppo} nel gioco su ${membri.length}</small>
              </div>
              <button type="button" class="btn-secondary btn-piccolo pericolo" data-azione="yt-elimina-playlist" data-playlist="${Util.escapeHtml(v.playlist_id)}">
                <i class="bi bi-trash3"></i> Elimina playlist
              </button>
            </div>
            <div class="gruppo-playlist-video">
              ${membri.map(cardYoutube).join('')}
            </div>
          </div>`);
      } else {
        blocchi.push(cardYoutube(v));
      }
    }
    lista.innerHTML = `
      <p class="conteggio">${inGioco} nel gioco su ${video.length} · ${NOTA_ORDINE}</p>
      ${blocchi.join('')}
    `;
  }

  // Finestra di ricerca YouTube affiancata (2/3 destri dello schermo, come nelle altre app)
  function apriRicercaYoutube(testo) {
    if (navigator.onLine === false) {
      stato('#statoYoutube', 'YouTube non è raggiungibile senza connessione a internet.', 'info');
      return;
    }
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(testo || RICERCA_PREDEFINITA)}`;
    const larghezzaSchermo = window.screen.availWidth;
    const tablet = /iPad|Android/i.test(navigator.userAgent) || Riproduttore.IOS;
    const quota = tablet ? 0.5 : 0.667;
    const larghezza = Math.floor(larghezzaSchermo * quota);
    const altezza = Math.floor(window.screen.availHeight * 0.75);
    const sinistra = (window.screen.availLeft || 0) + Math.floor(larghezzaSchermo * (1 - quota));

    if (finestraYoutube && !finestraYoutube.closed) {
      try {
        finestraYoutube.location.href = url;
        finestraYoutube.focus();
        return;
      } catch (e) {
        finestraYoutube = null;
      }
    }
    finestraYoutube = window.open(url, 'RicercaYouTube',
      `width=${larghezza},height=${altezza},left=${sinistra},top=0,scrollbars=yes,resizable=yes`);
    if (!finestraYoutube) {
      stato('#statoYoutube', 'Il browser ha bloccato la finestra di YouTube: consenti i popup per questo sito.', 'error');
    }
  }

  // ==================== SCHEDA ANTICIPATORE ====================
  // Ogni tipo di stimolo può avere il suo audio anticipatore: uno per le voci registrate,
  // uno per la musica (YouTube) e uno per ogni presa configurata. Dove si sceglie
  // «Come il generale» suona l'anticipatore generale.
  //
  // Categorie: 'generale' | 'audio' | 'youtube' | 'presa:<id della presa>'

  function categorieAnticipatore() {
    const prese = Presa.elenco();
    return [
      { cat: 'generale', icona: 'bi-bell-fill', nome: 'Generale', nota: 'Suona per i tipi di stimolo che non ne hanno uno proprio' },
      { cat: 'audio', icona: 'bi-mic-fill', nome: 'Voci registrate', nota: 'Prima di ogni audio registrato o caricato' },
      { cat: 'youtube', icona: 'bi-music-note-beamed', nome: 'Musica (YouTube)', nota: 'Prima di ogni video o brano YouTube' },
      ...prese.map((p) => ({
        cat: `presa:${p.id}`, icona: 'bi-plug-fill', nome: `Presa: ${p.nome}`, nota: `Prima che si accenda «${p.nome}»`, presa: p,
      })),
    ];
  }

  function nomeCategoria(cat) {
    if (cat === 'generale') return 'Generale';
    if (cat === 'audio') return 'Voci registrate';
    if (cat === 'youtube') return 'Musica (YouTube)';
    if (String(cat).startsWith('presa:')) {
      const id = cat.slice(6);
      const p = Presa.elenco().find((x) => x.id === id);
      return p ? `Presa: ${p.nome}` : 'Presa non più configurata';
    }
    return 'Senza categoria';
  }

  // Nome proposto per un anticipatore nuovo: anticipatore-voce, anticipatore-musica,
  // anticipatore-ventilatore, anticipatore-luci-di-natale…
  function nomeProposto(cat) {
    if (cat === 'audio') return 'anticipatore-voce';
    if (cat === 'youtube') return 'anticipatore-musica';
    if (String(cat).startsWith('presa:')) {
      const p = Presa.elenco().find((x) => x.id === cat.slice(6));
      const parola = String(p?.nome || 'presa').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return `anticipatore-${parola || 'presa'}`;
    }
    return 'anticipatore';
  }

  // Valore scelto per una categoria: 'generale' | 'nessuno' | 'predefinito' | id
  function sceltaDi(imp, cat) {
    if (cat === 'generale') return imp.anticipatore;
    if (cat.startsWith('presa:')) return imp.anticipatori?.prese?.[cat.slice(6)] ?? 'generale';
    return imp.anticipatori?.[cat] ?? 'generale';
  }

  function salvaScelta(cat, valore) {
    if (cat === 'generale') {
      Archivio.salvaImpostazioni({ anticipatore: valore });
    } else if (cat.startsWith('presa:')) {
      Archivio.salvaImpostazioni({ anticipatori: { prese: { [cat.slice(6)]: valore } } });
    } else {
      Archivio.salvaImpostazioni({ anticipatori: { [cat]: valore } });
    }
  }

  // Tutti i riferimenti a un audio eliminato tornano al generale (o al suono predefinito)
  function dimenticaAnticipatore(id) {
    const imp = Archivio.getImpostazioni();
    if (imp.anticipatore === id) {
      Archivio.salvaImpostazioni({ anticipatore: 'predefinito' });
    }
    const per = imp.anticipatori || {};
    const modifiche = {};
    for (const tipo of ['audio', 'youtube']) {
      if (per[tipo] === id) {
        modifiche[tipo] = 'generale';
      }
    }
    const prese = {};
    for (const [idPresa, v] of Object.entries(per.prese || {})) {
      if (v === id) {
        prese[idPresa] = 'generale';
      }
    }
    if (Object.keys(prese).length) {
      modifiche.prese = prese;
    }
    if (Object.keys(modifiche).length) {
      Archivio.salvaImpostazioni({ anticipatori: modifiche });
    }
  }

  // Per quali categorie è in uso l'audio id
  function usiDi(imp, id) {
    return categorieAnticipatore().filter((c) => sceltaDi(imp, c.cat) === id).map((c) => c.nome);
  }

  let catNuovo = 'generale';

  async function schedaAnticipatore() {
    contenuto.innerHTML = `
      <h3><i class="bi bi-bell"></i> Audio anticipatori</h3>
      <p class="helper-text">
        Prima di ogni stimolo, nella <strong>stimolazione casuale</strong> e nello <strong>stimolo su
        richiesta</strong>, suona un audio che avvisa l'utente di quello che sta per arrivare.
        <strong>Ogni tipo di stimolo può avere il suo</strong>: uno per le voci registrate, uno per la
        musica e uno per ogni presa (per esempio «anticipatore-ventilatore»). Dove scegli
        <em>Come il generale</em> suona l'anticipatore generale.
      </p>
      <div id="tabellaAnticipatori" class="lista-elementi"></div>

      <h4 class="titolo-lista"><i class="bi bi-plus-circle"></i> Nuovo anticipatore</h4>
      <div class="form-group">
        <label for="nuovoAnticipatorePer">È l'anticipatore di</label>
        <select id="nuovoAnticipatorePer"></select>
      </div>
      <p class="helper-text">Registralo o caricalo: diventa subito l'anticipatore di quello che hai
        scelto qui sopra e non entra tra gli stimoli.</p>
      <div id="acqAnticipatore"></div>

      <h4 class="titolo-lista"><i class="bi bi-collection-play"></i> Anticipatori registrati</h4>
      <div id="listaAnticipatori" class="lista-elementi"></div>
    `;

    acquisizione = ElaboraAudio.crea(contenuto.querySelector('#acqAnticipatore'), {
      nomeSuggerito: () => nomeProposto(catNuovo),
      nomeAncheFile: true,
      etichettaSalva: 'Usa come anticipatore',
      onSalva: async ({ nome, blob, durata, origine }) => {
        const cat = catNuovo;
        const record = await Archivio.audioAggiungi({ nome, blob, durata, origine, attivo: false, anticipa: cat });
        salvaScelta(cat, record.id);
        disegnaAnticipatori();
        return `✅ "${nome}" è ora l'anticipatore di: ${nomeCategoria(cat)}.`;
      },
    });

    contenuto.querySelector('#nuovoAnticipatorePer').addEventListener('change', (e) => {
      catNuovo = e.target.value;
      acquisizione?.suggerisci(nomeProposto(catNuovo));
    });

    // Le prese arrivano dal collegamento: quando cambiano, ridisegno l'elenco
    rimuoviAscoltoPresa?.();
    rimuoviAscoltoPresa = Presa.onCambio(() => disegnaAnticipatori());
    disegnaAnticipatori();
  }

  async function disegnaAnticipatori() {
    const tabella = contenuto?.querySelector('#tabellaAnticipatori');
    if (!tabella) {
      return;
    }
    let audio = [];
    try {
      audio = await Archivio.audioLista();
    } catch (e) { /* mostro comunque le opzioni base */ }
    if (!contenuto?.querySelector('#tabellaAnticipatori')) {
      return;
    }
    const imp = Archivio.getImpostazioni();
    const categorie = categorieAnticipatore();
    const anticipatori = audio.filter((a) => a.anticipa && a.blob);
    const perId = new Map(audio.map((a) => [a.id, a]));
    const esc = Util.escapeHtml;

    const opzioniPer = (c) => {
      const scelta = sceltaDi(imp, c.cat);
      const sel = (v) => (String(scelta) === String(v) ? 'selected' : '');
      const propri = anticipatori.filter((a) => a.anticipa === c.cat);
      const altri = anticipatori.filter((a) => a.anticipa !== c.cat);
      // Un audio scelto con la versione precedente (senza categoria) resta selezionabile
      const vecchio = typeof scelta === 'number' && !anticipatori.some((a) => a.id === scelta) ? perId.get(scelta) : null;
      return [
        c.cat === 'generale' ? '' : `<option value="generale" ${sel('generale')}>Come il generale</option>`,
        `<option value="predefinito" ${sel('predefinito')}>Suono predefinito</option>`,
        `<option value="nessuno" ${sel('nessuno')}>Nessun anticipatore</option>`,
        propri.length ? `<optgroup label="Registrati per questo">${propri.map((a) => `<option value="${a.id}" ${sel(a.id)}>${esc(a.nome)}</option>`).join('')}</optgroup>` : '',
        altri.length ? `<optgroup label="Altri anticipatori">${altri.map((a) => `<option value="${a.id}" ${sel(a.id)}>${esc(a.nome)}</option>`).join('')}</optgroup>` : '',
        vecchio ? `<option value="${vecchio.id}" selected>${esc(vecchio.nome)}</option>` : '',
        typeof scelta === 'number' && !perId.has(scelta) ? '<option value="" selected>(audio eliminato: suona il generale)</option>' : '',
      ].join('');
    };

    tabella.innerHTML = categorie.map((c) => `
      <div class="elemento riga-anticipatore">
        <i class="bi ${c.icona} elemento-icona"></i>
        <div class="elemento-testo">
          <strong>${esc(c.nome)}</strong>
          <small>${esc(c.nota)}</small>
        </div>
        <div class="form-group scelta-anticipatore">
          <select data-azione="anticipatore-scelta" data-categoria="${esc(c.cat)}" aria-label="Anticipatore: ${esc(c.nome)}">${opzioniPer(c)}</select>
        </div>
        <button type="button" class="btn-icona" data-azione="anticipatore-ascolta-cat" data-categoria="${esc(c.cat)}" title="Ascolta">
          <i class="bi bi-play-fill"></i>
        </button>
      </div>`).join('')
      + (Presa.elenco().length ? '' : `
      <p class="helper-text"><i class="bi bi-plug"></i> Nessuna presa configurata: quando le configuri nella scheda
        <strong>Presa</strong>, qui compare una riga per ognuna.</p>`);

    // Menu «È l'anticipatore di»
    const menu = contenuto.querySelector('#nuovoAnticipatorePer');
    if (!categorie.some((c) => c.cat === catNuovo)) {
      catNuovo = 'generale';
    }
    menu.innerHTML = categorie.map((c) => `<option value="${esc(c.cat)}" ${c.cat === catNuovo ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');

    // Elenco degli anticipatori registrati
    const lista = contenuto.querySelector('#listaAnticipatori');
    if (anticipatori.length === 0) {
      lista.innerHTML = '<p class="vuoto"><i class="bi bi-bell-slash"></i> Nessun anticipatore registrato: si usa il suono predefinito.</p>';
      return;
    }
    lista.innerHTML = anticipatori.map((a) => {
      const usi = usiDi(imp, a.id);
      return `
        <div class="elemento ${usi.length ? 'attivo' : ''}">
          <i class="bi ${a.origine === 'registrazione' ? 'bi-mic-fill' : 'bi-file-earmark-music'} elemento-icona"></i>
          <div class="elemento-testo">
            <strong>${esc(a.nome)}</strong>
            <small>Registrato per: ${esc(nomeCategoria(a.anticipa))} · ${(Number(a.durata) || 0).toFixed(1)} s
              ${usi.length ? ` · <span class="etichetta"><i class="bi bi-bell-fill"></i> in uso: ${esc(usi.join(', '))}</span>` : ' · non in uso'}</small>
          </div>
          <button type="button" class="btn-icona" data-azione="anticipatore-ascolta" data-valore="${a.id}" title="Ascolta">
            <i class="bi bi-play-fill"></i>
          </button>
          <button type="button" class="btn-icona pericolo" data-azione="anticipatore-elimina" data-id="${a.id}" title="Elimina">
            <i class="bi bi-trash3"></i>
          </button>
        </div>`;
    }).join('');
  }

  // ==================== SCHEDA PRESA ====================

  function schedaPresa() {
    if (typeof SchedaPresa !== 'undefined') {
      rimuoviAscoltoPresa = SchedaPresa.disegna(contenuto);
      return;
    }
    contenuto.innerHTML = `
      <h3><i class="bi bi-plug-fill"></i> Presa smart</h3>
      <p class="helper-text">
        La presa si accende come stimolo durante la stimolazione casuale, lo stimolo su richiesta
        e l'ascolto con switch.
      </p>
      <div class="info-box">
        <i class="bi bi-tools"></i>
        <p>Il collegamento alla presa è in preparazione: in questa versione gli stimoli sono audio e video.</p>
      </div>
    `;
  }

  // ==================== SCHEDA TEMPI ====================

  // ==================== SCHEDA STIMOLI (solo APK) ====================

  function schedaStimoli() {
    const ev = Archivio.getImpostazioni().stimolazione.eventi;
    const riga = (tipo, icona, testo) => `
      <label class="spunta grande">
        <input type="checkbox" data-azione="tipo-stimolo" value="${tipo}" ${ev[tipo] ? 'checked' : ''} />
        <span><i class="bi ${icona}"></i> ${testo}
          <small class="dettaglio-tipo" data-tipo="${tipo}"></small></span>
      </label>`;
    contenuto.innerHTML = `
      <h3><i class="bi bi-ui-checks-grid"></i> Tipi di stimolo usati</h3>
      <p class="helper-text">
        Scegli quali stimoli usare nella <strong>stimolazione casuale</strong> e nello
        <strong>stimolo su richiesta</strong>. Le modifiche si salvano subito.
      </p>
      <fieldset class="gruppo-spunte">
        <legend>Tipi di stimolo usati</legend>
        ${riga('audio', 'bi-mic-fill', 'Audio registrati e caricati')}
        ${riga('youtube', 'bi-youtube', 'Video YouTube')}
        ${riga('presa', 'bi-plug-fill', 'Presa smart')}
      </fieldset>
      <div id="statoStimoli" class="status-message" role="status" aria-live="polite"></div>
    `;
    disegnaDettagliStimoli();
  }

  // Sotto ogni tipo: quanti stimoli sono pronti, per vedere subito cosa manca
  async function disegnaDettagliStimoli() {
    const scrivi = (tipo, testo, manca) => {
      const el = contenuto?.querySelector(`.dettaglio-tipo[data-tipo="${tipo}"]`);
      if (el) {
        el.textContent = testo;
        el.classList.toggle('manca', manca);
      }
    };
    let audio = [];
    try {
      audio = await Archivio.audioLista();
    } catch (e) { /* archivio non leggibile */ }
    const attivi = audio.filter((a) => a.attivo && a.blob);
    const interi = attivi.filter((a) => a.intero).length;
    const nVideo = Archivio.getYoutube().filter((v) => v.attivo && !Riproduttore.erroreDefinitivo(v.errore)).length;
    const secondi = Archivio.getImpostazioni().presa.secondi;
    scrivi('audio', attivi.length
      ? `${attivi.length} nel gioco${interi ? ` · ${interi} per intero` : ''}`
      : 'nessuno nel gioco: aggiungili nella scheda Audio', !attivi.length);
    scrivi('youtube', nVideo ? `${nVideo} nel gioco` : 'nessuno nel gioco: aggiungili nella scheda YouTube', !nVideo);
    scrivi('presa', Presa.disponibile()
      ? `${Presa.elenco().length} ${Presa.elenco().length === 1 ? 'presa' : 'prese'} · resta accesa ${secondi} s`
      : 'non collegata: configurala nella scheda Presa', !Presa.disponibile());
  }

  function schedaTempi() {
    const imp = Archivio.getImpostazioni();
    const st = imp.stimolazione;
    contenuto.innerHTML = `
      <h3><i class="bi bi-stopwatch"></i> Tempi della stimolazione</h3>
      <p class="helper-text">
        Valgono per la <strong>stimolazione casuale</strong> e per lo <strong>stimolo su richiesta</strong>.
        Tra uno stimolo e l'altro l'app aspetta un tempo scelto a caso tra il minimo e il massimo.
      </p>
      <form id="formTempi" class="form-grid" novalidate>
        <div class="riga-2">
          <div class="form-group">
            <label for="tAttesaMin">Attesa minima (secondi)</label>
            <input id="tAttesaMin" type="number" min="1" max="3600" value="${st.attesa_min}" />
          </div>
          <div class="form-group">
            <label for="tAttesaMax">Attesa massima (secondi)</label>
            <input id="tAttesaMax" type="number" min="1" max="3600" value="${st.attesa_max}" />
          </div>
        </div>
        <div class="form-group">
          <label for="tDurataMax">Durata massima di audio e video (secondi)</label>
          <input id="tDurataMax" type="number" min="0" max="3600" value="${st.durata_max}" />
          <p class="helper-text">0 = fino alla fine (o fino al tempo di fine impostato per il video).
            Non taglia gli stimoli segnati <strong>«Sempre per intero»</strong> (es. la voce di un familiare)
            né i video con un proprio tempo di fine.</p>
        </div>
        ${Util.apk ? '' : `<fieldset class="gruppo-spunte">
          <legend>Tipi di stimolo usati</legend>
          <label class="spunta grande"><input id="tEvAudio" type="checkbox" ${st.eventi.audio ? 'checked' : ''} />
            <span><i class="bi bi-mic-fill"></i> Audio registrati e caricati</span></label>
          <label class="spunta grande"><input id="tEvYoutube" type="checkbox" ${st.eventi.youtube ? 'checked' : ''} />
            <span><i class="bi bi-youtube"></i> Video YouTube</span></label>
          <label class="spunta grande"><input id="tEvPresa" type="checkbox" ${st.eventi.presa ? 'checked' : ''} />
            <span><i class="bi bi-plug-fill"></i> Presa smart</span></label>
        </fieldset>`}
        <div class="form-group">
          <label for="tRisposta">Stimolo su richiesta: tempo per premere lo switch (secondi)</label>
          <input id="tRisposta" type="number" min="0" max="600" value="${st.risposta_timeout}" />
          <p class="helper-text">Dopo l'audio anticipatore l'app aspetta la pressione dello switch. 0 = aspetta senza limite.</p>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary"><i class="bi bi-save"></i> Salva</button>
        </div>
        <div id="statoTempi" class="status-message" role="status" aria-live="polite"></div>
      </form>
    `;

    contenuto.querySelector('#formTempi').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = (id) => Number(contenuto.querySelector(id).value);
      const min = n('#tAttesaMin');
      const max = n('#tAttesaMax');
      if (!(min >= 1) || !(max >= 1)) {
        stato('#statoTempi', 'Le attese devono essere di almeno 1 secondo.', 'error');
        return;
      }
      if (max < min) {
        stato('#statoTempi', 'L\'attesa massima non può essere minore della minima.', 'error');
        return;
      }
      const stimolazione = {
        attesa_min: min,
        attesa_max: max,
        durata_max: Math.max(0, n('#tDurataMax') || 0),
        risposta_timeout: Math.max(0, n('#tRisposta') || 0),
      };
      // Nella PWA i tipi di stimolo sono qui; nell'APK hanno la scheda Stimoli
      if (contenuto.querySelector('#tEvAudio')) {
        stimolazione.eventi = {
          audio: contenuto.querySelector('#tEvAudio').checked,
          youtube: contenuto.querySelector('#tEvYoutube').checked,
          presa: contenuto.querySelector('#tEvPresa').checked,
        };
        if (!stimolazione.eventi.audio && !stimolazione.eventi.youtube && !stimolazione.eventi.presa) {
          stato('#statoTempi', 'Scegli almeno un tipo di stimolo.', 'error');
          return;
        }
      }
      Archivio.salvaImpostazioni({ stimolazione });
      stato('#statoTempi', '✅ Impostazioni salvate.', 'success');
    });
  }

  // ==================== SCHEDA REGISTRO ====================

  const NOMI_MODALITA = {
    casuale: 'Stimolazione casuale',
    richiesta: 'Stimolo su richiesta',
    switch: 'Ascolto con switch',
  };

  function schedaRegistro() {
    const sessioni = Archivio.getRegistro().slice().reverse();
    const conRichiesta = sessioni.filter((s) => s.richieste > 0);
    const totRichieste = conRichiesta.reduce((t, s) => t + s.richieste, 0);
    const totRisposte = conRichiesta.reduce((t, s) => t + s.risposte, 0);
    const tempi = conRichiesta.flatMap((s) => s.tempi_risposta || []);
    const media = (lista) => (lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : 0);

    contenuto.innerHTML = `
      <h3><i class="bi bi-clipboard-data"></i> Registro delle sessioni</h3>
      <p class="helper-text">Le ultime 200 sessioni svolte su questo dispositivo.</p>
      ${sessioni.length === 0 ? '<p class="vuoto"><i class="bi bi-journal"></i> Nessuna sessione registrata.</p>' : `
        <div class="riepilogo">
          <div><strong>${sessioni.length}</strong><span>sessioni</span></div>
          <div><strong>${Util.formatoDurata(sessioni.reduce((t, s) => t + Math.max(0, (s.fine || s.inizio) - s.inizio), 0) / 1000)}</strong><span>tempo totale</span></div>
          ${totRichieste ? `
            <div><strong>${Math.round((totRisposte / totRichieste) * 100)}%</strong><span>risposte allo switch</span></div>
            <div><strong>${(media(tempi) / 1000).toFixed(1)} s</strong><span>tempo medio di risposta</span></div>` : ''}
        </div>
        <div class="lista-sessioni">
          ${sessioni.map(disegnaSessione).join('')}
        </div>
        <div class="form-actions">
          <button type="button" class="btn-secondary" data-azione="registro-azzera">
            <i class="bi bi-trash3"></i> Azzera registro
          </button>
        </div>`}
    `;
  }

  function disegnaSessione(s) {
    const durata = Math.max(0, (s.fine || s.inizio) - s.inizio) / 1000;
    const pt = s.per_tipo || {};
    const dettagli = [];
    const tipi = [
      pt.audio ? `audio ${pt.audio}` : '',
      pt.youtube ? `video ${pt.youtube}` : '',
      pt.presa ? `presa ${pt.presa}` : '',
    ].filter(Boolean).join(', ');
    dettagli.push(`Stimoli: <strong>${s.stimoli || 0}</strong>${tipi ? ` (${tipi})` : ''}`);
    if (s.richieste > 0) {
      const tempi = s.tempi_risposta || [];
      const media = tempi.length ? (tempi.reduce((a, b) => a + b, 0) / tempi.length / 1000).toFixed(1) : '-';
      dettagli.push(`Risposte: <strong>${s.risposte} su ${s.richieste}</strong> (${Math.round((s.risposte / s.richieste) * 100)}%) · tempo medio ${media} s`);
    }
    if (s.pressioni > 0) {
      dettagli.push(`Pressioni dello switch: <strong>${s.pressioni}</strong>${s.pressioni_fuori_tempo ? ` (${s.pressioni_fuori_tempo} fuori tempo)` : ''}`);
    }
    return `
      <div class="sessione">
        <div class="sessione-testa">
          <strong>${Util.escapeHtml(NOMI_MODALITA[s.modalita] || s.modalita)}${s.dettaglio ? ` · ${Util.escapeHtml(s.dettaglio)}` : ''}</strong>
          <span>${Util.formatoData(s.inizio)} · ${Util.formatoDurata(durata)}${s.fine ? '' : ' · interrotta'}</span>
        </div>
        ${dettagli.map((d) => `<div class="sessione-dati">${d}</div>`).join('')}
      </div>`;
  }

  // ==================== EVENTI (delegati) ====================

  async function gestisciClick(e) {
    const btn = e.target.closest('[data-azione]');
    if (!btn || btn.tagName === 'INPUT') {
      return;
    }
    const azione = btn.dataset.azione;
    const id = Number(btn.dataset.id);

    try {
      if (azione === 'audio-ascolta') {
        const record = await Archivio.audioGet(id);
        if (record?.blob) {
          ascolta(record.blob);
        }
      } else if (azione === 'audio-elimina') {
        const record = await Archivio.audioGet(id);
        if (!record || !confirm(`Eliminare l'audio "${record.nome}"?\n\nNon si può annullare.`)) {
          return;
        }
        await Archivio.audioElimina(id);
        dimenticaAnticipatore(id);
        disegnaListaAudio();
      } else if (azione === 'yt-riprova') {
        Archivio.aggiornaYoutube(id, { errore: null, errore_data: null });
        disegnaListaYoutube();
      } else if (azione === 'yt-elimina') {
        const video = Archivio.getYoutube().find((v) => v.id === id);
        if (!video || !confirm(`Eliminare il video "${video.nome}"?\n\nNon si può annullare.`)) {
          return;
        }
        Archivio.eliminaYoutube(id);
        disegnaListaYoutube();
      } else if (azione === 'yt-elimina-playlist') {
        const playlistId = btn.dataset.playlist;
        const membri = Archivio.getYoutube().filter((v) => v.playlist_id === playlistId);
        const nome = membri[0]?.playlist_nome || 'questa playlist';
        if (!membri.length || !confirm(`Eliminare tutti i ${membri.length} video della playlist "${nome}"?\n\nNon si può annullare.`)) {
          return;
        }
        Archivio.eliminaYoutubePlaylist(playlistId);
        disegnaListaYoutube();
      } else if (azione === 'anticipatore-elimina') {
        const record = await Archivio.audioGet(id);
        if (!record || !confirm(`Eliminare l'anticipatore "${record.nome}"?\n\nDove era in uso suonerà l'anticipatore generale. Non si può annullare.`)) {
          return;
        }
        await Archivio.audioElimina(id);
        dimenticaAnticipatore(id);
        disegnaAnticipatori();
      } else if (azione === 'anticipatore-ascolta-cat') {
        const imp = Archivio.getImpostazioni();
        let valore = sceltaDi(imp, btn.dataset.categoria);
        if (valore === 'generale') {
          valore = imp.anticipatore;
        }
        if (typeof valore === 'number') {
          const record = await Archivio.audioGet(valore);
          ascolta(record?.blob || ANTICIPATORE_PREDEFINITO);
        } else if (valore === 'predefinito') {
          ascolta(ANTICIPATORE_PREDEFINITO);
        }
      } else if (azione === 'anticipatore-ascolta') {
        const valore = btn.dataset.valore;
        if (valore === 'predefinito') {
          ascolta(ANTICIPATORE_PREDEFINITO);
        } else {
          const record = await Archivio.audioGet(Number(valore));
          if (record?.blob) {
            ascolta(record.blob);
          }
        }
      } else if (azione === 'registro-azzera') {
        if (confirm('Cancellare tutto il registro delle sessioni?\n\nGli audio e i video restano.')) {
          Archivio.azzeraRegistro();
          schedaRegistro();
        }
      }
    } catch (errore) {
      alert(`⚠️ ${errore.message}`);
    }
    aggiornaSegnali();
  }

  async function gestisciCambio(e) {
    const input = e.target.closest('[data-azione]');
    if (!input) {
      return;
    }
    const azione = input.dataset.azione;
    const id = Number(input.dataset.id);

    try {
      if (azione === 'audio-attivo') {
        await Archivio.audioAggiorna(id, { attivo: input.checked });
        disegnaListaAudio();
      } else if (azione === 'yt-attivo') {
        Archivio.aggiornaYoutube(id, { attivo: input.checked });
        disegnaListaYoutube();
      } else if (azione === 'yt-solo-audio') {
        Archivio.aggiornaYoutube(id, { solo_audio: input.checked });
      } else if (azione === 'tipo-stimolo') {
        const eventi = {};
        contenuto.querySelectorAll('[data-azione="tipo-stimolo"]').forEach((c) => {
          eventi[c.value] = c.checked;
        });
        if (!eventi.audio && !eventi.youtube && !eventi.presa) {
          input.checked = true;
          stato('#statoStimoli', 'Serve almeno un tipo di stimolo.', 'error');
          return;
        }
        Archivio.salvaImpostazioni({ stimolazione: { eventi } });
        stato('#statoStimoli', '✅ Salvato.', 'success');
      } else if (azione === 'yt-intero') {
        Archivio.aggiornaYoutube(id, { intero: input.checked });
      } else if (azione === 'audio-intero') {
        await Archivio.audioAggiorna(id, { intero: input.checked });
      } else if (azione === 'yt-inizio' || azione === 'yt-fine') {
        salvaTempiVideo(id);
      } else if (azione === 'anticipatore-scelta') {
        const valore = input.value;
        if (valore === '') {
          return;
        }
        salvaScelta(input.dataset.categoria,
          ['generale', 'predefinito', 'nessuno'].includes(valore) ? valore : Number(valore));
        disegnaAnticipatori();
      }
    } catch (errore) {
      alert(`⚠️ ${errore.message}`);
    }
    aggiornaSegnali();
  }

  return { apri, chiudi, mostraScheda };
})();
