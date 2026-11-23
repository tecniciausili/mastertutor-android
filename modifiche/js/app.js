// ==================== MASTERTUTOR - AVVIO E NAVIGAZIONE ====================
// App statica per Azure Static Web Apps, installabile come PWA su computer e tablet.
// Un dispositivo = un utente: i dati restano nel browser (vedi js/archivio.js).

const APP_CONFIG = {
  nome: 'Mastertutor',
  versione: '1.0.16',
};
window.APP_CONFIG = APP_CONFIG;

const App = (() => {
  let areaCorrente = null; // 'educatore' | 'utente' | null
  let richiestaInstallazione = null;

  function principale() {
    return document.getElementById('appMain');
  }

  function lasciaAreaCorrente() {
    if (areaCorrente === 'educatore') {
      Educatore.chiudi();
    } else if (areaCorrente === 'utente') {
      Utente.chiudi();
    }
    areaCorrente = null;
    document.body.classList.remove('educator-mode', 'user-mode-active');
  }

  function mostraEducatore() {
    lasciaAreaCorrente();
    areaCorrente = 'educatore';
    document.body.classList.add('educator-mode');
    Educatore.apri(principale());
    window.scrollTo(0, 0);
  }

  function mostraUtente() {
    lasciaAreaCorrente();
    areaCorrente = 'utente';
    document.body.classList.add('user-mode-active');
    Utente.apri(principale());
    window.scrollTo(0, 0);
  }

  function mostraBenvenuto() {
    lasciaAreaCorrente();
    principale().innerHTML = document.getElementById('modelloBenvenuto').innerHTML;
  }

  // ==================== MENU E FINESTRE ====================

  function alternaMenu(forza) {
    const menu = document.getElementById('sideMenu');
    const apri = typeof forza === 'boolean' ? forza : !menu.classList.contains('active');
    menu.classList.toggle('active', apri);
    document.getElementById('overlay').classList.toggle('active', apri);
  }

  function apriFinestra(id) {
    alternaMenu(false);
    document.getElementById(id)?.classList.add('active');
  }

  function chiudiFinestra(id) {
    document.getElementById(id)?.classList.remove('active');
  }

  async function mostraInformazioni() {
    apriFinestra('infoModal');
    document.getElementById('infoVersione').textContent = APP_CONFIG.versione;
    const box = document.getElementById('infoStorage');
    const info = await Archivio.storageInfo();
    if (info) {
      const mb = (n) => (n / (1024 * 1024)).toFixed(1);
      box.innerHTML = `<strong>Spazio dati:</strong> ${mb(info.usati)} MB usati su ${mb(info.disponibili)} MB disponibili`;
    } else {
      box.hidden = true;
    }
  }

  // ==================== ESPORTA / IMPORTA DATI ====================

  function dataPerNomeFile() {
    const d = new Date();
    const due = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;
  }

  async function esporta() {
    alternaMenu(false);
    try {
      const dati = await Archivio.esportaDati();
      const blob = new Blob([JSON.stringify(dati)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mastertutor-dati-${dataPerNomeFile()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert(`❌ Esportazione non riuscita: ${e.message}`);
    }
  }

  function importa() {
    alternaMenu(false);
    if (!confirm('📥 IMPORTA DATI\n\nI dati del file (audio, video, impostazioni e ordine) '
      + 'sostituiranno quelli attuali di questo dispositivo.\n\n'
      + 'Il registro delle sessioni e il collegamento al ponte NON vengono toccati.\n\nContinuare?')) {
      return;
    }
    const campo = document.getElementById('fileImporta');
    campo.value = '';
    campo.click();
  }

  async function alFileImporta(e) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const testo = await file.text();
      const oggetto = JSON.parse(testo);
      const esito = await Archivio.importaDati(oggetto);
      alert(`✅ Dati importati: ${esito.audio} audio e ${esito.youtube} video.\n\nL'app viene ricaricata.`);
      window.location.reload();
    } catch (err) {
      alert(`❌ Importazione non riuscita: ${err.message}`);
    }
  }

  // ==================== PWA: INSTALLA E AGGIORNA ====================

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    richiestaInstallazione = e;
  });

  function installa() {
    if (richiestaInstallazione) {
      richiestaInstallazione.prompt();
      richiestaInstallazione.userChoice.finally(() => {
        richiestaInstallazione = null;
      });
      return;
    }
    const installata = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (installata) {
      alert('✅ L\'app è già installata su questo dispositivo.');
    } else {
      alert('📱 INSTALLA APP\n\n'
        + '🌐 Chrome/Edge sul computer: icona di installazione nella barra degli indirizzi, oppure Menu (⋮) → "Installa app"\n'
        + '📱 Android: Menu (⋮) → "Aggiungi a schermata Home"\n'
        + '🍎 iPad/iPhone con Safari: Condividi → "Aggiungi alla schermata Home"');
    }
  }

  // Svuota solo la cache dei file di questa app: audio, video e registro restano.
  // Sullo stesso indirizzo ci sono altre app della raccolta: i loro
  // service worker e le loro cache non vanno toccati.
  async function aggiorna() {
    alternaMenu(false);
    if (!confirm('🔄 AGGIORNA APP\n\nScarica l\'ultima versione dell\'applicazione.\n\nAudio, video, impostazioni e registro NON vengono toccati.\n\nContinuare?')) {
      return;
    }
    try {
      if ('serviceWorker' in navigator) {
        const miaCartella = new URL('./', window.location.href).href;
        const registrazioni = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrazioni.filter((r) => r.scope === miaCartella).map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const nomi = await caches.keys();
        await Promise.all(nomi.filter((n) => n.startsWith('mastertutor_')).map((n) => caches.delete(n)));
      }
      window.location.reload();
    } catch (e) {
      alert(`❌ Errore durante l'aggiornamento: ${e.message}`);
    }
  }

  // ==================== AVVIO ====================

  function avvia() {
    Archivio.richiediStoragePersistente();
    document.getElementById('fileImporta')?.addEventListener('change', alFileImporta);

    // Dispositivo già abbinato a un ponte: mi ricollego in sottofondo
    const codicePonte = Archivio.getImpostazioni().presa.codice;
    if (codicePonte && Presa.configurabile()) {
      Presa.collega({ codice: codicePonte }).catch((e) => console.warn('Presa:', e.message));
    }

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-app]');
      if (!el) {
        return;
      }
      const azione = el.dataset.app;
      const azioni = {
        educatore: mostraEducatore,
        utente: mostraUtente,
        home: mostraBenvenuto,
        menu: () => alternaMenu(),
        'chiudi-menu': () => alternaMenu(false),
        opzioni: () => Utente.alternaOpzioni(),
        'configura-prese': () => {
          alternaMenu(false);
          ConfiguraPrese.apri();
        },
        istruzioni: () => apriFinestra('instructionsModal'),
        informazioni: mostraInformazioni,
        esporta,
        importa,
        installa,
        aggiorna,
        'chiudi-finestra': () => chiudiFinestra(el.dataset.finestra),
      };
      azioni[azione]?.();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        chiudiFinestra('infoModal');
        chiudiFinestra('instructionsModal');
        alternaMenu(false);
      }
    });

    apriPaginaIniziale();
    console.log(`${APP_CONFIG.nome} v${APP_CONFIG.versione}`);
  }

  // ==================== PAGINA D'APERTURA ====================
  // Se c'è già un esercizio pronto (almeno uno stimolo nel gioco tra quelli usati) l'app si apre
  // direttamente sull'esercizio (Area Utente); altrimenti sulla Configurazione. La schermata
  // iniziale resta raggiungibile dal menu.
  async function esercizioPronto() {
    const ev = Archivio.getImpostazioni().stimolazione.eventi;
    if (ev.audio) {
      try {
        if ((await Archivio.audioLista()).some((a) => a.attivo && a.blob && !a.anticipa)) {
          return true;
        }
      } catch (e) { /* archivio non leggibile: risulta vuoto */ }
    }
    if (ev.youtube && Archivio.getYoutube().some((v) => v.attivo && !Riproduttore.erroreDefinitivo(v.errore))) {
      return true;
    }
    if (ev.presa) {
      if (Presa.disponibile()) {
        return true;
      }
      // Nell'app (Windows, Android) le prese sono configurate sul dispositivo
      if (Presa.locale) {
        try {
          return ((await Presa.leggiConfigurazione()).prese || []).length > 0;
        } catch (e) { /* configurazione non leggibile */ }
      }
    }
    return false;
  }

  async function apriPaginaIniziale() {
    let pronto = false;
    try {
      pronto = await esercizioPronto();
    } catch (e) {
      console.warn('Controllo dell\'esercizio non riuscito:', e);
    }
    if (pronto) {
      mostraUtente();
    } else {
      mostraEducatore();
    }
  }

  document.addEventListener('DOMContentLoaded', avvia);

  return { mostraEducatore, mostraUtente, mostraBenvenuto };
})();

// La YouTube IFrame API chiama questa funzione quando è pronta
window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  console.log('YouTube IFrame API pronta');
};
