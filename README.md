# Mastertutor per Android (APK)

Questa cartella trasforma l'app web Mastertutor in un vero **APK** per tablet Android,
usando [Capacitor](https://capacitorjs.com): l'app web viene impacchettata dentro
un'app Android nativa. È un involucro della PWA, non una copia: il codice web è uno solo,
nel repository **mastertutor** (cartella `../versione_pwa`), e `build-www.sh` lo copia ogni
volta che si compila.

Questo repository è **mastertutor-android**. Per compilare servono i due repository
affiancati, con questi nomi di cartella:

```
mastertutor/
├── versione_pwa/       ← repository mastertutor (PWA: codice web, ponte, Azure)
└── versione_android/   ← questo repository
```

## Cosa c'è

| Percorso | Cos'è |
|---|---|
| `Mastertutor-<versione>-debug.apk` | Gli APK compilati sul Mac (non versionati: quello da scaricare sta nella PWA, in `download/`) |
| `build-www.sh` | Prepara `www/` copiando da `../versione_pwa` solo i file del tablet (niente ponte, strumenti, Azure) |
| `capacitor.config.json` | Nome, id (`it.tecniciausili.mastertutor`) e cartella web dell'app |
| `android/` | Il progetto Android generato da Capacitor (apribile in Android Studio) |
| `www/` | I file web copiati per la compilazione (rigenerati, non versionati) |

## Cosa fa l'APK

Tutto gira **sul tablet**, senza Azure e senza il ponte:

- Area Educatore e Area Utente, con le tre modalità e l'ascolto con switch.
- **Registrazione della voce** con il microfono del tablet (permesso `RECORD_AUDIO`).
- Caricamento e **conversione in MP3** di qualsiasi file audio.
- Video **YouTube** (serve internet, come sempre).
- **Esporta / Importa dati**: si configura sul computer e si passa tutto al tablet.
- Avvio automatico dei video (nell'app non serve il primo tocco richiesto da iPad).
- **Presa Tapo comandata direttamente dal tablet**: basta che tablet e prese siano nella
  stessa rete Wi-Fi. Niente ponte, niente codice di abbinamento, niente Azure.

## La presa nell'APK

Il plugin nativo `PresaTapoPlugin` (in `android/app/src/main/java/it/tecniciausili/mastertutor/`)
fa sul tablet il lavoro che nella versione web fa il ponte:

| File | Cosa fa |
|---|---|
| `PresaTapoPlugin.java` | Configurazione (account e prese), accensione con **spegnimento automatico nativo**, spegnimento, verifica |
| `tapo/TapoKlap.java` | Protocollo KLAP v2 (firmware recenti), tradotto da `../versione_pwa/ponte/tapo/klap.js` |
| `tapo/TapoAes.java` | Protocollo AES / Secure Passthrough (es. P100 1.3.7), tradotto da `../versione_pwa/ponte/tapo/passthrough.js` |
| `tapo/TapoPrese.java` | Sceglie il protocollo, una sessione per presa, comandi in fila, messaggi d'errore in italiano |
| `tapo/TapoHttp.java`, `tapo/Cripto.java` | Richieste HTTP alla presa e crittografia |

La parte web lo usa tramite `../versione_pwa/js/presa-nativa.js`, che si attiva **solo dentro l'APK**:
nel browser e nella PWA resta il collegamento con il ponte.

- **Configurazione**: menu ⋮ → *Configura le prese* (o Area Educatore → Presa). Email e
  password dell'account Tapo e indirizzo IP di ogni presa; si salvano sul tablet.
- **Password**: resta nella memoria privata dell'app e non torna mai alla parte web. Il
  backup automatico su cloud dell'app è disattivato; per spostare audio e video si usa
  *Esporta / Importa* (che la password non la contiene).
- **Sicurezza**: la presa si spegne da sola allo scadere del tempo (timer nativo, funziona
  anche con lo schermo spento). Se l'app viene chiusa di colpo con una presa accesa, al
  riavvio successivo la spegne.
- **Rete**: le prese parlano HTTP in chiaro sulla rete locale, quindi l'app lo consente
  (`usesCleartextTraffic`). Con Android 17 (target API 37) servirà anche il permesso
  `ACCESS_LOCAL_NETWORK`: oggi l'app ha target 35 e non ne ha bisogno.

**Provato** il 23/09/2026 su emulatore tablet (Android 14) con la presa di casa
(192.168.1.180, KLAP): configurazione, verifica e messaggio di password errata.

## Rigenerare l'APK

Servono: **Node.js**, **JDK 21**, **Android SDK** (compileSdk 35). Su questo Mac:

> ⚠️ `JAVA_HOME` va impostato ogni volta come sotto. Senza, Gradle usa il Java più recente
> di Homebrew (26), che si ferma con l'errore `JdkImageTransform … jlink`.

```bash
cd versione_android
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=~/Library/Android/sdk
npm install                 # solo la prima volta
npm run apk                 # prepara www/, sincronizza e compila l'APK di debug
```

L'APK esce in `android/app/build/outputs/apk/debug/app-debug.apk`. In alternativa si
apre `android/` in **Android Studio** e si compila da lì (Run o Build → Build APK).

## Installare sul tablet

- **Via cavo (adb)**: `~/Library/Android/sdk/platform-tools/adb install -r Mastertutor-*.apk`
- **Come file**: copiare l'`.apk` sul tablet e aprirlo, consentendo l'installazione da
  «origini sconosciute». Da fine 2026 Google introduce la verifica dello sviluppatore
  anche fuori dallo store: per pochi tablet basta l'account gratuito a «distribuzione
  limitata» (fino a 20 dispositivi).

## Note

- L'APK di debug è firmato con la chiave di debug di Android: va bene per le prove e per
  l'installazione diretta, **non** per la pubblicazione sul Play Store (lì serve un APK/AAB
  firmato con una propria chiave).
- Il service worker della PWA viene tolto dalla copia web: nell'app i file sono già dentro.
