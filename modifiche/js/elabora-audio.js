// ==================== ACQUISIZIONE AUDIO ====================
// Registrazione della voce dal microfono del dispositivo oppure caricamento
// di QUALSIASI file audio dal disco (anche l'audio di un video). Come in
// "Ascolto la Musica e MP3": il silenzio iniziale e finale viene tagliato e
// l'audio convertito in MP3 direttamente nel browser (lamejs).
//
// I formati comuni (MP3, M4A, WAV, OGG/Opus di WhatsApp, FLAC...) li legge il
// browser. Per gli altri (AMR, WMA, AIFF, MOV...) entra in gioco ffmpeg.wasm:
// il suo motore (circa 30 MB) si scarica solo la prima volta che serve.

const ElaboraAudio = (() => {
  const SOGLIA_SILENZIO = 0.02;  // RMS sotto cui una finestra è silenzio
  const FINESTRA_S = 0.02;       // finestre di analisi da 20 ms
  const MARGINE_S = 0.08;        // margine lasciato prima e dopo la voce
  const MAX_REGISTRAZIONE_S = 120;
  const MAX_FILE_MB = 60;
  const FFMPEG_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

  // Tutti i file audio (e video, per prenderne l'audio) che si possono scegliere
  const FORMATI = 'audio/*,video/*,.mp3,.m4a,.m4b,.aac,.wav,.wave,.ogg,.oga,.opus,.flac,.webm,.weba,'
    + '.mp4,.mov,.3gp,.3ga,.amr,.awb,.wma,.aif,.aiff,.aifc,.caf,.alac,.ac3,.mka,.mkv,.avi,.m4r,.mp2,.mpga,.ra,.au,.snd';

  let ffmpegPronto = null;

  async function inBlobUrl(url, tipo) {
    const risposta = await fetch(url);
    if (!risposta.ok) {
      throw new Error(`download non riuscito (${risposta.status})`);
    }
    return URL.createObjectURL(new Blob([await risposta.arrayBuffer()], { type: tipo }));
  }

  // Carica ffmpeg.wasm una volta sola (i file dell'app + il motore da jsDelivr)
  function caricaFfmpeg(onStato) {
    if (!ffmpegPronto) {
      ffmpegPronto = (async () => {
        const { FFmpeg } = await import(new URL('js/lib/ffmpeg/index.js', document.baseURI).href);
        const ffmpeg = new FFmpeg();
        onStato?.('⏳ Il browser non legge questo formato: scarico il convertitore universale (circa 30 MB, solo la prima volta)…');
        await ffmpeg.load({
          coreURL: await inBlobUrl(`${FFMPEG_CORE}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await inBlobUrl(`${FFMPEG_CORE}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        return ffmpeg;
      })();
      ffmpegPronto.catch(() => {
        ffmpegPronto = null;
      });
    }
    return ffmpegPronto;
  }

  // Qualsiasi formato → WAV mono 44,1 kHz con ffmpeg.wasm
  async function convertiInWav(blob, nome, onStato) {
    let ffmpeg;
    try {
      ffmpeg = await caricaFfmpeg(onStato);
    } catch (e) {
      throw new Error('il convertitore universale non si è scaricato (serve internet)');
    }
    const estensione = (String(nome || '').match(/\.[a-z0-9]{1,5}$/i) || [''])[0].toLowerCase();
    const ingresso = `ingresso${estensione}`;
    const avanzamento = ({ progress }) => {
      if (progress > 0 && progress <= 1) {
        onStato?.(`⏳ Conversione in corso… ${Math.round(progress * 100)}%`);
      }
    };
    ffmpeg.on('progress', avanzamento);
    try {
      onStato?.('⏳ Conversione in corso…');
      await ffmpeg.writeFile(ingresso, new Uint8Array(await blob.arrayBuffer()));
      const esito = await ffmpeg.exec(['-i', ingresso, '-vn', '-ac', '1', '-ar', '44100', '-f', 'wav', 'uscita.wav']);
      if (esito !== 0) {
        throw new Error('il file non contiene audio leggibile');
      }
      const dati = await ffmpeg.readFile('uscita.wav');
      return new Blob([dati], { type: 'audio/wav' });
    } finally {
      ffmpeg.off('progress', avanzamento);
      ffmpeg.deleteFile(ingresso).catch(() => {});
      ffmpeg.deleteFile('uscita.wav').catch(() => {});
    }
  }

  async function decodifica(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const Contesto = window.AudioContext || window.webkitAudioContext;
    const contesto = new Contesto();
    let buffer;
    try {
      buffer = await new Promise((resolve, reject) => {
        // Forma a callback: funziona anche sui Safari più vecchi
        const p = contesto.decodeAudioData(arrayBuffer, resolve, reject);
        if (p && typeof p.then === 'function') {
          p.then(resolve, reject);
        }
      });
    } finally {
      if (contesto.state !== 'closed') {
        contesto.close().catch(() => {});
      }
    }
    return buffer;
  }

  // Qualsiasi file o registrazione → MP3 mono 128 kbps senza silenzio iniziale e finale.
  // opzioni: { nome (per riconoscere il formato), onStato (messaggi di avanzamento) }
  async function elabora(blob, { nome = '', onStato } = {}) {
    let buffer;
    try {
      buffer = await decodifica(blob);
    } catch (e) {
      // Il browser non conosce il formato: lo converto con ffmpeg.wasm
      const wav = await convertiInWav(blob, nome || blob.name, onStato);
      onStato?.('⏳ Taglio del silenzio e conversione in MP3…');
      buffer = await decodifica(wav);
    }

    const lunghezza = buffer.length;
    const canali = buffer.numberOfChannels;
    const mono = new Float32Array(lunghezza);
    for (let c = 0; c < canali; c++) {
      const dati = buffer.getChannelData(c);
      for (let i = 0; i < lunghezza; i++) {
        mono[i] += dati[i] / canali;
      }
    }

    const sr = buffer.sampleRate;
    const finestra = Math.max(1, Math.floor(sr * FINESTRA_S));
    const margine = Math.floor(sr * MARGINE_S);
    const rms = (da, a) => {
      let somma = 0;
      for (let j = da; j < a; j++) {
        somma += mono[j] * mono[j];
      }
      return Math.sqrt(somma / Math.max(1, a - da));
    };

    let inizio = 0;
    let fine = lunghezza;
    for (let i = 0; i < lunghezza; i += finestra) {
      if (rms(i, Math.min(i + finestra, lunghezza)) > SOGLIA_SILENZIO) {
        inizio = Math.max(0, i - margine);
        break;
      }
    }
    for (let i = lunghezza; i > 0; i -= finestra) {
      if (rms(Math.max(i - finestra, 0), i) > SOGLIA_SILENZIO) {
        fine = Math.min(lunghezza, i + margine);
        break;
      }
    }
    if (fine <= inizio) {
      inizio = 0;
      fine = lunghezza;
    }

    const tagliato = mono.subarray(inizio, fine);
    if (typeof lamejs === 'undefined') {
      throw new Error('Libreria lamejs non caricata: impossibile creare l\'MP3.');
    }

    const campioni = new Int16Array(tagliato.length);
    for (let i = 0; i < tagliato.length; i++) {
      const s = Math.max(-1, Math.min(1, tagliato[i]));
      campioni[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const encoder = new lamejs.Mp3Encoder(1, sr, 128);
    const parti = [];
    for (let i = 0; i < campioni.length; i += 1152) {
      const blocco = encoder.encodeBuffer(campioni.subarray(i, i + 1152));
      if (blocco.length > 0) {
        parti.push(blocco);
      }
    }
    const coda = encoder.flush();
    if (coda.length > 0) {
      parti.push(coda);
    }

    return {
      blob: new Blob(parti, { type: 'audio/mpeg' }),
      durata: tagliato.length / sr,
    };
  }

  // ==================== COMPONENTE: REGISTRA / CARICA / ANTEPRIMA ====================
  // opzioni:
  //   titoloAnteprima: testo sopra l'anteprima
  //   nomeSuggerito:   nome proposto per le registrazioni (testo, oppure funzione che lo restituisce)
  //   nomeAncheFile:   true = il nome proposto vale anche per i file caricati (al posto del nome del file)
  //   etichettaSalva:  testo del pulsante di salvataggio
  //   onSalva:         async ({nome, blob, durata, origine}) => messaggio di conferma

  function crea(contenitore, opzioni = {}) {
    const {
      nomeSuggerito = '',
      nomeAncheFile = false,
      etichettaSalva = 'Salva audio',
      onSalva = async () => '',
    } = opzioni;

    contenitore.innerHTML = `
      <div class="acquisizione">
        <div class="acquisizione-comandi">
          <button type="button" class="btn-primary btn-registra">
            <i class="bi bi-record-circle"></i> <span>Registra voce</span>
          </button>
          <span class="registrazione-timer" hidden>
            <i class="bi bi-record-fill lampeggia"></i> <span class="secondi">0</span> s
          </span>
          <label class="btn-secondary btn-carica">
            <i class="bi bi-file-earmark-music"></i> Carica file audio
            <input type="file" class="input-file" hidden accept="${FORMATI}" />
          </label>
        </div>
        <div class="acquisizione-anteprima" hidden>
          <p class="anteprima-titolo">
            <i class="bi bi-soundwave"></i> Anteprima (silenzio già tagliato, durata <span class="durata">-</span> s)
          </p>
          <audio controls preload="auto"></audio>
          <div class="anteprima-riga">
            <div class="form-group">
              <label>Nome *</label>
              <input type="text" class="input-nome" maxlength="150" autocomplete="off"
                placeholder="Es: Voce della mamma" />
            </div>
            <div class="anteprima-azioni">
              <button type="button" class="btn-primary btn-salva">
                <i class="bi bi-save"></i> ${Util.escapeHtml(etichettaSalva)}
              </button>
              <button type="button" class="btn-secondary btn-annulla">
                <i class="bi bi-x-lg"></i> Annulla
              </button>
            </div>
          </div>
        </div>
        <div class="status-message" role="status" aria-live="polite"></div>
      </div>
    `;

    const suggerito = () => (typeof nomeSuggerito === 'function' ? nomeSuggerito() : nomeSuggerito) || '';

    const el = {
      registra: contenitore.querySelector('.btn-registra'),
      registraTesto: contenitore.querySelector('.btn-registra span'),
      timer: contenitore.querySelector('.registrazione-timer'),
      secondi: contenitore.querySelector('.registrazione-timer .secondi'),
      file: contenitore.querySelector('.input-file'),
      anteprima: contenitore.querySelector('.acquisizione-anteprima'),
      audio: contenitore.querySelector('.acquisizione-anteprima audio'),
      durata: contenitore.querySelector('.acquisizione-anteprima .durata'),
      nome: contenitore.querySelector('.input-nome'),
      salva: contenitore.querySelector('.btn-salva'),
      annulla: contenitore.querySelector('.btn-annulla'),
      stato: contenitore.querySelector('.status-message'),
    };

    const st = {
      recorder: null,
      stream: null,
      pezzi: [],
      intervallo: null,
      secondi: 0,
      pronto: null,       // {blob, durata, origine}
      urlAnteprima: null,
    };

    function mostraStato(messaggio, tipo = '') {
      el.stato.textContent = messaggio || '';
      el.stato.className = `status-message ${messaggio ? tipo : ''}`;
    }

    function mostraAnteprima(risultato, origine, nome) {
      st.pronto = { ...risultato, origine };
      if (st.urlAnteprima) {
        URL.revokeObjectURL(st.urlAnteprima);
      }
      st.urlAnteprima = URL.createObjectURL(risultato.blob);
      el.audio.src = st.urlAnteprima;
      el.durata.textContent = risultato.durata.toFixed(1);
      el.nome.value = nome || '';
      el.anteprima.hidden = false;
      el.anteprima.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el.nome.focus();
    }

    function chiudiAnteprima() {
      st.pronto = null;
      el.audio.pause();
      el.audio.removeAttribute('src');
      if (st.urlAnteprima) {
        URL.revokeObjectURL(st.urlAnteprima);
        st.urlAnteprima = null;
      }
      el.anteprima.hidden = true;
    }

    async function avviaRegistrazione() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        mostraStato('Questo browser non permette di registrare. Usa Chrome, Edge o Safari aggiornati.', 'error');
        return;
      }
      try {
        st.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        mostraStato('Impossibile usare il microfono: controlla i permessi del browser (icona del lucchetto nella barra degli indirizzi).', 'error');
        return;
      }

      chiudiAnteprima();
      mostraStato('');
      st.pezzi = [];
      st.recorder = new MediaRecorder(st.stream);
      st.recorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) {
          st.pezzi.push(e.data);
        }
      });
      st.recorder.addEventListener('stop', async () => {
        const tipo = st.recorder.mimeType || st.pezzi[0]?.type || 'audio/webm';
        const blob = new Blob(st.pezzi, { type: tipo });
        st.stream?.getTracks().forEach((t) => t.stop());
        st.stream = null;
        st.recorder = null;
        mostraStato('⏳ Elaborazione: taglio del silenzio e conversione in MP3...', 'info');
        try {
          const risultato = await elabora(blob);
          mostraStato('');
          mostraAnteprima(risultato, 'registrazione', suggerito());
        } catch (e) {
          mostraStato(`Errore nell'elaborazione della registrazione: ${e.message}`, 'error');
        }
      });

      st.recorder.start();
      st.secondi = 0;
      el.secondi.textContent = '0';
      el.timer.hidden = false;
      el.registraTesto.textContent = 'Ferma registrazione';
      el.registra.classList.add('in-registrazione');
      st.intervallo = setInterval(() => {
        st.secondi++;
        el.secondi.textContent = String(st.secondi);
        if (st.secondi >= MAX_REGISTRAZIONE_S) {
          fermaRegistrazione();
        }
      }, 1000);
    }

    function fermaRegistrazione() {
      clearInterval(st.intervallo);
      st.intervallo = null;
      el.timer.hidden = true;
      el.registraTesto.textContent = 'Registra voce';
      el.registra.classList.remove('in-registrazione');
      if (st.recorder && st.recorder.state !== 'inactive') {
        st.recorder.stop();
      }
    }

    el.registra.addEventListener('click', () => {
      if (st.recorder && st.recorder.state === 'recording') {
        fermaRegistrazione();
      } else {
        avviaRegistrazione();
      }
    });

    el.file.addEventListener('change', async () => {
      const file = el.file.files?.[0];
      el.file.value = '';
      if (!file) {
        return;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        mostraStato(`File troppo grande (massimo ${MAX_FILE_MB} MB).`, 'error');
        return;
      }
      const whatsapp = /whatsapp|ptt-|audio-\d{8}-wa/i.test(file.name) || /ogg|opus/i.test(file.type);
      mostraStato(whatsapp
        ? '⏳ Vocale WhatsApp: conversione in MP3 e taglio del silenzio...'
        : '⏳ Elaborazione del file: taglio del silenzio e conversione in MP3...', 'info');
      try {
        const risultato = await elabora(file, { nome: file.name, onStato: (testo) => mostraStato(testo, 'info') });
        mostraStato('');
        mostraAnteprima(risultato, 'upload', (nomeAncheFile && suggerito()) || file.name.replace(/\.[^.]+$/, ''));
      } catch (e) {
        mostraStato(`Non riesco a convertire questo file: ${e.message || 'formato non riconosciuto'}.`, 'error');
      }
    });

    el.annulla.addEventListener('click', () => {
      chiudiAnteprima();
      mostraStato('');
    });

    el.salva.addEventListener('click', async () => {
      const nome = el.nome.value.trim();
      if (!st.pronto) {
        mostraStato('Registra o carica prima un audio.', 'error');
        return;
      }
      if (!nome) {
        mostraStato('Scrivi un nome per l\'audio.', 'error');
        el.nome.focus();
        return;
      }
      el.salva.disabled = true;
      try {
        const messaggio = await onSalva({ nome, ...st.pronto });
        chiudiAnteprima();
        mostraStato(messaggio || `✅ "${nome}" salvato su questo dispositivo.`, 'success');
      } catch (e) {
        mostraStato(`Errore nel salvataggio: ${e.message}`, 'error');
      } finally {
        el.salva.disabled = false;
      }
    });

    // Permette a chi usa il componente di interrompere tutto (cambio sezione)
    return {
      // Nuovo nome proposto (per esempio cambiando la categoria di un anticipatore):
      // se l'anteprima è aperta, aggiorna anche il campo del nome
      suggerisci(nome) {
        if (!el.anteprima.hidden) {
          el.nome.value = nome || '';
        }
      },
      chiudi() {
        if (st.recorder && st.recorder.state === 'recording') {
          fermaRegistrazione();
        }
        chiudiAnteprima();
      },
    };
  }

  return { elabora, crea };
})();
