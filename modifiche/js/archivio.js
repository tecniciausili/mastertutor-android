// ==================== ARCHIVIO LOCALE ====================
// Come nelle altre app autonome: UN DISPOSITIVO = UN UTENTE, nessun server.
//
//  - Video YouTube, impostazioni, registro sessioni → localStorage (JSON)
//  - Audio registrati o caricati (blob MP3)         → IndexedDB
//
// Quello che si registra sul tablet resta sul tablet, quello che si registra
// sul computer resta sul computer.

const Archivio = (() => {
  const CHIAVI = {
    youtube: 'mt_youtube',
    impostazioni: 'mt_impostazioni',
    registro: 'mt_registro',
    ordine: 'mt_ordine',
  };

  const DB_NOME = 'mastertutor';
  const DB_VERSIONE = 1;
  const STORE_AUDIO = 'audio';
  const MAX_SESSIONI = 200;

  const IMPOSTAZIONI_DEFAULT = {
    // Anticipatore GENERALE: 'predefinito' (suono incluso nell'app) | 'nessuno' | id di un audio
    anticipatore: 'predefinito',
    // Anticipatore di ogni tipo di stimolo: 'generale' (= quello qui sopra) | 'nessuno' |
    // 'predefinito' | id di un audio. Le prese ne hanno uno ciascuna: prese[idPresa]
    anticipatori: {
      audio: 'generale',       // voci registrate
      youtube: 'generale',     // musica e video YouTube
      prese: {},
    },
    stimolazione: {
      attesa_min: 15,          // secondi di attesa casuale tra due stimoli (minimo)
      attesa_max: 20,          // ... (massimo) — valori del programma originale in sede
      durata_max: 0,           // durata massima di audio e video, 0 = fino alla fine
      eventi: { audio: true, youtube: true, presa: true },
      risposta_timeout: 10,    // stimolo su richiesta: secondi per premere lo switch, 0 = senza limite
      ordine: 'successivo',    // 'successivo' (come nella lista dell'Area Utente) | 'random'
    },
    presa: {
      codice: '',              // codice di abbinamento mostrato dal ponte
      prese: [],               // id delle prese da accendere (vuoto = tutte)
      secondi: 30,             // quanto resta accesa la presa a ogni stimolo (valore in sede)
    },
    utente: {                  // ultime scelte fatte nell'Area Utente
      modalita: 'casuale',     // 'casuale' | 'richiesta' | 'switch'
      ascolto: 'diretto',      // 'diretto' | 'random' | 'temporizzato' | 'persistente' | 'navigazione'
      ordine: 'successivo',    // temporizzato e persistente: 'successivo' | 'random'
      timer: 30,
      attesa_navigazione: 10,
      spazio_navigazione: 'next', // 'next' | 'ignore' | 'disabled'
      switch2_audio: false,    // freccia DESTRA dedicata agli audio registrati
      pannello_chiuso: false,
      categoria: '',
    },
  };

  // ==================== localStorage ====================

  function leggiJSON(chiave, predefinito) {
    try {
      const valore = localStorage.getItem(chiave);
      return valore ? JSON.parse(valore) : predefinito;
    } catch (e) {
      console.error(`Errore lettura ${chiave}:`, e);
      return predefinito;
    }
  }

  function scriviJSON(chiave, valore) {
    localStorage.setItem(chiave, JSON.stringify(valore));
  }

  function eOggetto(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
  }

  // Unione profonda: i valori salvati prevalgono, i campi mancanti prendono il default
  function unisci(base, sopra) {
    const risultato = { ...base };
    if (!eOggetto(sopra)) {
      return risultato;
    }
    for (const [chiave, valore] of Object.entries(sopra)) {
      risultato[chiave] = eOggetto(base[chiave]) && eOggetto(valore)
        ? unisci(base[chiave], valore)
        : valore;
    }
    return risultato;
  }

  // ==================== IMPOSTAZIONI ====================

  function getImpostazioni() {
    const imp = unisci(IMPOSTAZIONI_DEFAULT, leggiJSON(CHIAVI.impostazioni, {}));
    // Valori numerici sempre validi, anche se modificati a mano
    const st = imp.stimolazione;
    st.attesa_min = Math.max(1, Number(st.attesa_min) || IMPOSTAZIONI_DEFAULT.stimolazione.attesa_min);
    st.attesa_max = Math.max(st.attesa_min, Number(st.attesa_max) || st.attesa_min);
    st.durata_max = Math.max(0, Number(st.durata_max) || 0);
    st.risposta_timeout = Math.max(0, Number(st.risposta_timeout) || 0);
    imp.presa.secondi = Math.min(600, Math.max(1, Number(imp.presa.secondi) || 30));
    return imp;
  }

  function salvaImpostazioni(parziale) {
    const nuove = unisci(getImpostazioni(), parziale);
    scriviJSON(CHIAVI.impostazioni, nuove);
    return nuove;
  }

  // ==================== VIDEO YOUTUBE ====================

  function getYoutube() {
    const lista = leggiJSON(CHIAVI.youtube, []);
    return Array.isArray(lista) ? lista : [];
  }

  function salvaYoutube(lista) {
    scriviJSON(CHIAVI.youtube, lista);
  }

  function aggiungiYoutube(dati) {
    const lista = getYoutube();
    const doppione = lista.some((v) => v.video_id === dati.video_id
      && (v.inizio || 0) === (dati.inizio || 0) && (v.fine || 0) === (dati.fine || 0));
    if (doppione) {
      throw new Error('Questo video (con gli stessi tempi) è già nella lista.');
    }
    const record = {
      id: lista.reduce((max, v) => Math.max(max, v.id || 0), 0) + 1,
      nome: dati.nome,
      categoria: dati.categoria || '',
      link: dati.link,
      video_id: dati.video_id,
      inizio: Math.max(0, parseInt(dati.inizio, 10) || 0),
      fine: Math.max(0, parseInt(dati.fine, 10) || 0),
      solo_audio: !!dati.solo_audio,
      intero: !!dati.intero,    // ignora la durata massima generale
      playlist_id: dati.playlist_id || null,
      playlist_nome: dati.playlist_nome || '',
      attivo: true,
      data_creazione: Date.now(),
    };
    lista.push(record);
    salvaYoutube(lista);
    return record;
  }

  function aggiornaYoutube(id, campi) {
    const lista = getYoutube().map((v) => (v.id === id ? { ...v, ...campi } : v));
    salvaYoutube(lista);
  }

  function eliminaYoutube(id) {
    salvaYoutube(getYoutube().filter((v) => v.id !== id));
    // L'id può tornare a un video nuovo: non deve ereditare il posto nella sequenza
    salvaOrdine(getOrdine().filter((k) => k !== `y${id}`));
  }

  // Elimina in un colpo solo tutti i video importati da una stessa playlist.
  // Restituisce quanti ne ha rimossi.
  function eliminaYoutubePlaylist(playlistId) {
    if (!playlistId) {
      return 0;
    }
    const daRimuovere = getYoutube().filter((v) => v.playlist_id === playlistId);
    if (daRimuovere.length === 0) {
      return 0;
    }
    const idRimossi = new Set(daRimuovere.map((v) => `y${v.id}`));
    salvaYoutube(getYoutube().filter((v) => v.playlist_id !== playlistId));
    salvaOrdine(getOrdine().filter((k) => !idRimossi.has(k)));
    return daRimuovere.length;
  }

  function getCategorie() {
    return Array.from(new Set(getYoutube().map((v) => v.categoria).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'it'));
  }

  // ==================== AUDIO (IndexedDB) ====================

  let db = null;

  function apriDB() {
    if (db) {
      return Promise.resolve(db);
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NOME, DB_VERSIONE);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE_AUDIO)) {
          database.createObjectStore(STORE_AUDIO, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => {
        db = req.result;
        // Se un'altra scheda aggiorna il database, chiudo per non bloccarla
        db.onversionchange = () => {
          db.close();
          db = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(new Error('Impossibile aprire il database audio del dispositivo.'));
    });
  }

  async function transazione(modo, operazione) {
    const database = await apriDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_AUDIO, modo);
      const store = tx.objectStore(STORE_AUDIO);
      let risultato;
      operazione(store, (valore) => {
        risultato = valore;
      });
      tx.oncomplete = () => resolve(risultato);
      tx.onerror = () => reject(tx.error || new Error('Errore del database audio.'));
      tx.onabort = () => reject(tx.error || new Error('Operazione sul database audio annullata.'));
    });
  }

  // audio: {nome, origine: 'registrazione'|'upload', durata, blob, attivo?, data_creazione?, anticipa?}
  // anticipa: per gli audio anticipatori, la categoria per cui sono stati registrati
  //   'generale' | 'audio' | 'youtube' | 'presa:<id della presa>' (null = audio normale, uno stimolo)
  async function audioAggiungi(audio) {
    const record = {
      anticipa: typeof audio.anticipa === 'string' && audio.anticipa ? audio.anticipa : null,
      nome: audio.nome,
      origine: audio.origine === 'registrazione' ? 'registrazione' : 'upload',
      durata: Number(audio.durata) || 0,
      attivo: audio.attivo !== false,
      intero: !!audio.intero,   // ignora la durata massima generale: si ascolta sempre tutto
      data_creazione: Number(audio.data_creazione) || Date.now(),
      blob: audio.blob,
    };
    const id = await transazione('readwrite', (store, fine) => {
      const req = store.add(record);
      req.onsuccess = () => fine(req.result);
    });
    return { ...record, id };
  }

  function audioLista() {
    return transazione('readonly', (store, fine) => {
      const req = store.getAll();
      req.onsuccess = () => fine(req.result || []);
    });
  }

  function audioGet(id) {
    return transazione('readonly', (store, fine) => {
      const req = store.get(id);
      req.onsuccess = () => fine(req.result || null);
    });
  }

  function audioAggiorna(id, campi) {
    return transazione('readwrite', (store) => {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          store.put({ ...req.result, ...campi, id });
        }
      };
    });
  }

  function audioElimina(id) {
    salvaOrdine(getOrdine().filter((k) => k !== `a${id}`));
    return transazione('readwrite', (store) => {
      store.delete(id);
    });
  }

  // ==================== ORDINE DEGLI STIMOLI ====================
  // Chiavi degli stimoli nell'ordine scelto trascinandoli nell'Area Utente
  // ('a12' = audio, 'y5' = video YouTube, 'presa'). Vale ovunque: stimolazione,
  // ascolto con switch, navigazione assistita ed elenchi dell'Area Educatore.

  function getOrdine() {
    const lista = leggiJSON(CHIAVI.ordine, []);
    return Array.isArray(lista) ? lista.filter((k) => typeof k === 'string') : [];
  }

  function salvaOrdine(chiavi) {
    scriviJSON(CHIAVI.ordine, Array.from(new Set(chiavi)));
  }

  // Mette una lista nell'ordine scelto; chi non c'è ancora (appena aggiunto) va in fondo
  function inOrdine(lista, chiaveDi) {
    const posizione = new Map(getOrdine().map((k, i) => [k, i]));
    return lista
      .map((el, i) => ({ el, i, p: posizione.get(chiaveDi(el)) ?? Infinity }))
      .sort((a, b) => (a.p !== b.p ? a.p - b.p : a.i - b.i))
      .map((x) => x.el);
  }

  // ==================== REGISTRO SESSIONI ====================

  function getRegistro() {
    const lista = leggiJSON(CHIAVI.registro, []);
    return Array.isArray(lista) ? lista : [];
  }

  // Inserisce o aggiorna una sessione (salvata anche durante lo svolgimento,
  // così i dati non si perdono se l'app viene chiusa all'improvviso)
  function salvaSessione(sessione) {
    const lista = getRegistro().filter((s) => s.id !== sessione.id);
    lista.push(sessione);
    lista.sort((a, b) => a.inizio - b.inizio);
    scriviJSON(CHIAVI.registro, lista.slice(-MAX_SESSIONI));
  }

  function azzeraRegistro() {
    localStorage.removeItem(CHIAVI.registro);
  }

  // ==================== ESPORTA / IMPORTA ====================
  // Un solo file .json con tutto il necessario per riconfigurare un dispositivo:
  // impostazioni, video YouTube, ordine degli stimoli e gli audio (inclusi nel file).
  // NON contiene il registro delle sessioni né la password delle prese (che sta solo
  // nel ponte). Il codice di abbinamento del ponte viene escluso: ogni casa ha il suo.

  const FORMATO_BACKUP = 1;

  function blobInBase64(blob) {
    return new Promise((resolve, reject) => {
      if (!blob) {
        resolve('');
        return;
      }
      const lettore = new FileReader();
      lettore.onload = () => resolve(String(lettore.result).split(',')[1] || '');
      lettore.onerror = () => reject(new Error('Lettura di un audio non riuscita.'));
      lettore.readAsDataURL(blob);
    });
  }

  function base64InBlob(base64, tipo) {
    const binario = atob(base64 || '');
    const byte = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) {
      byte[i] = binario.charCodeAt(i);
    }
    return new Blob([byte], { type: tipo || 'audio/mpeg' });
  }

  async function esportaDati() {
    const impostazioni = getImpostazioni();
    // Il codice del ponte resta legato al singolo dispositivo: non viaggia nel file
    impostazioni.presa = { ...impostazioni.presa, codice: '' };

    const audio = await audioLista();
    const audioEsportati = await Promise.all(audio.map(async (a) => ({
      id: a.id,
      nome: a.nome,
      origine: a.origine,
      durata: a.durata,
      attivo: a.attivo,
      intero: !!a.intero,
      anticipa: a.anticipa || null,
      data_creazione: a.data_creazione,
      tipo: a.blob?.type || 'audio/mpeg',
      dati: await blobInBase64(a.blob),
    })));

    return {
      app: 'mastertutor',
      formato: FORMATO_BACKUP,
      versione_app: window.APP_CONFIG?.versione || '',
      esportato: Date.now(),
      impostazioni,
      youtube: getYoutube(),
      ordine: getOrdine(),
      audio: audioEsportati,
    };
  }

  // Sostituisce impostazioni, video, ordine e audio con quelli del file.
  // Mantiene il codice del ponte già presente su questo dispositivo e non tocca il registro.
  async function importaDati(oggetto) {
    if (!eOggetto(oggetto) || oggetto.app !== 'mastertutor' || !Number.isInteger(oggetto.formato)) {
      throw new Error('Questo file non è un backup di Mastertutor.');
    }
    if (oggetto.formato > FORMATO_BACKUP) {
      throw new Error('Il file è stato creato con una versione più recente dell\'app. Aggiorna l\'app e riprova.');
    }

    // Impostazioni: quelle del file prevalgono, il codice del ponte resta quello locale
    const codicePonteLocale = getImpostazioni().presa.codice;
    const impFinale = unisci(IMPOSTAZIONI_DEFAULT, eOggetto(oggetto.impostazioni) ? oggetto.impostazioni : {});
    impFinale.presa.codice = codicePonteLocale;
    scriviJSON(CHIAVI.impostazioni, impFinale);

    // Video YouTube: gli id restano quelli del file, così l'ordine y* è ancora valido
    scriviJSON(CHIAVI.youtube, Array.isArray(oggetto.youtube) ? oggetto.youtube : []);

    // Audio: svuoto e re-inserisco. Gli id di IndexedDB cambiano, quindi tengo la
    // corrispondenza vecchio → nuovo per rimettere a posto l'ordine.
    await transazione('readwrite', (store) => {
      store.clear();
    });
    const mappaAudio = new Map();
    const mappaId = new Map();   // vecchio id numerico → nuovo
    for (const a of (Array.isArray(oggetto.audio) ? oggetto.audio : [])) {
      const blob = base64InBlob(a.dati, a.tipo);
      const nuovo = await audioAggiungi({
        nome: a.nome,
        origine: a.origine,
        durata: a.durata,
        attivo: a.attivo,
        intero: a.intero,
        anticipa: a.anticipa,
        data_creazione: a.data_creazione,
        blob,
      });
      if (a.id != null) {
        mappaAudio.set(`a${a.id}`, `a${nuovo.id}`);
        mappaId.set(Number(a.id), nuovo.id);
      }
    }

    // Gli anticipatori scelti puntano agli id degli audio: li rimappo come l'ordine
    // (prima l'anticipatore scelto si perdeva dopo un'importazione)
    const rimappa = (v) => (typeof v === 'number' ? (mappaId.get(v) ?? 'predefinito') : v);
    const imp = getImpostazioni();
    const prese = {};
    for (const [id, v] of Object.entries(imp.anticipatori.prese || {})) {
      prese[id] = rimappa(v);
    }
    scriviJSON(CHIAVI.impostazioni, {
      ...imp,
      anticipatore: rimappa(imp.anticipatore),
      anticipatori: { audio: rimappa(imp.anticipatori.audio), youtube: rimappa(imp.anticipatori.youtube), prese },
    });

    // Ordine: rimappo le chiavi audio, lascio invariate quelle video ('y*') e 'presa'
    const ordine = (Array.isArray(oggetto.ordine) ? oggetto.ordine : [])
      .map((k) => mappaAudio.get(k) || k);
    salvaOrdine(ordine);

    return {
      audio: mappaAudio.size,
      youtube: Array.isArray(oggetto.youtube) ? oggetto.youtube.length : 0,
    };
  }

  // ==================== SPAZIO E PERSISTENZA ====================

  // Chiede al browser di non cancellare mai da solo i dati (registrazioni comprese)
  async function richiediStoragePersistente() {
    try {
      if (navigator.storage?.persist) {
        if (await navigator.storage.persisted()) {
          return true;
        }
        return await navigator.storage.persist();
      }
    } catch (e) {
      console.warn('Richiesta di storage persistente non riuscita:', e);
    }
    return false;
  }

  async function storageInfo() {
    try {
      if (navigator.storage?.estimate) {
        const stima = await navigator.storage.estimate();
        return { usati: stima.usage || 0, disponibili: stima.quota || 0 };
      }
    } catch (e) { /* non supportato */ }
    return null;
  }

  return {
    getImpostazioni,
    salvaImpostazioni,
    getYoutube,
    aggiungiYoutube,
    aggiornaYoutube,
    eliminaYoutube,
    eliminaYoutubePlaylist,
    getCategorie,
    audioAggiungi,
    audioLista,
    audioGet,
    audioAggiorna,
    audioElimina,
    getOrdine,
    salvaOrdine,
    inOrdine,
    esportaDati,
    importaDati,
    getRegistro,
    salvaSessione,
    azzeraRegistro,
    richiediStoragePersistente,
    storageInfo,
  };
})();
