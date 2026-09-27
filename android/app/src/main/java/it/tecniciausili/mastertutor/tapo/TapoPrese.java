package it.tecniciausili.mastertutor.tapo;

import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Callable;

import org.json.JSONObject;

/**
 * Accesso alle prese Tapo dal tablet. Traduzione di ponte/tapo/prese.js:
 * - si prova KLAP (firmware recenti), poi AES (firmware vecchi), e si ricorda l'esito;
 * - una sessione per ogni indirizzo;
 * - i comandi alla stessa presa vanno in fila, con almeno ATTESA_MINIMA_MS tra due:
 *   la presa è un interruttore che scatta davvero.
 */
public final class TapoPrese {

    private static final long ATTESA_MINIMA_MS = 500;

    public static final class Stato {
        public final boolean acceso;
        public final String protocollo;
        public final String nome;

        Stato(boolean acceso, String protocollo, String nome) {
            this.acceso = acceso;
            this.protocollo = protocollo;
            this.nome = nome;
        }
    }

    private static final class Sessione {
        final String chiave;
        final String protocollo;
        final TapoDispositivo dispositivo;

        Sessione(String chiave, String protocollo, TapoDispositivo dispositivo) {
            this.chiave = chiave;
            this.protocollo = protocollo;
            this.dispositivo = dispositivo;
        }
    }

    private static final class Fila {
        long ultimoComando = 0;
    }

    private static final Map<String, Sessione> sessioni = new HashMap<>();
    private static final Map<String, Fila> file = new HashMap<>();

    private TapoPrese() {}

    /** Dimentica la sessione di una presa (o di tutte con null): il prossimo comando rifà l'handshake. */
    public static void dimentica(String ip) {
        synchronized (sessioni) {
            if (ip == null) {
                sessioni.clear();
            } else {
                sessioni.remove(ip);
            }
        }
    }

    private static <T> T inFila(String ip, Callable<T> operazione) throws Exception {
        Fila fila;
        synchronized (file) {
            fila = file.get(ip);
            if (fila == null) {
                fila = new Fila();
                file.put(ip, fila);
            }
        }
        synchronized (fila) {
            long trascorso = System.currentTimeMillis() - fila.ultimoComando;
            if (trascorso < ATTESA_MINIMA_MS) {
                Thread.sleep(ATTESA_MINIMA_MS - trascorso);
            }
            try {
                return operazione.call();
            } finally {
                fila.ultimoComando = System.currentTimeMillis();
            }
        }
    }

    private static Sessione apri(String ip, String email, String password) throws Exception {
        String chiave = ip + "|" + email + "|" + password;
        synchronized (sessioni) {
            Sessione esistente = sessioni.get(ip);
            if (esistente != null && esistente.chiave.equals(chiave)) {
                return esistente;
            }
        }
        Sessione nuova;
        try {
            TapoDispositivo klap = new TapoKlap(ip, email, password);
            klap.info();
            nuova = new Sessione(chiave, "klap", klap);
        } catch (Exception erroreKlap) {
            try {
                TapoDispositivo aes = new TapoAes(ip, email, password);
                aes.info();
                nuova = new Sessione(chiave, "aes", aes);
            } catch (Exception erroreAes) {
                throw new Exception(descriviErrore(erroreKlap, erroreAes));
            }
        }
        synchronized (sessioni) {
            sessioni.put(ip, nuova);
        }
        return nuova;
    }

    private static String testo(Exception e) {
        String m = e.getMessage();
        return e.getClass().getSimpleName() + ": " + (m == null ? "" : m);
    }

    /** Traduce in una frase leggibile il fallimento di entrambi i protocolli. */
    static String descriviErrore(Exception erroreKlap, Exception erroreAes) {
        String klap = testo(erroreKlap);
        String aes = testo(erroreAes);
        // Le prese con firmware vecchio non conoscono KLAP (404): conta l'errore dell'altro protocollo
        String t = klap.contains("HTTP 404") ? aes : klap;

        if (klap.contains("403")) {
            return "La presa rifiuta il collegamento. Nell'app Tapo del telefono va attivata "
                + "\"Compatibilità terze parti\" (Impostazioni della presa, in fondo).";
        }
        if (t.contains("hash mismatch")) {
            return "Email o password non corrispondono all'account Tapo. "
                + "Sono le stesse credenziali usate per accedere all'app Tapo sul telefono.";
        }
        if (t.contains("EHOSTUNREACH") || t.contains("ENETUNREACH") || t.contains("NoRouteToHost")
                || t.contains("EHOSTDOWN")) {
            return "Indirizzo irraggiungibile: la presa non è nella stessa rete Wi-Fi del tablet.";
        }
        if (t.contains("ECONNREFUSED") || t.contains("Connection refused")) {
            return "Nessuna presa risponde a questo indirizzo.";
        }
        if (t.contains("SocketTimeout") || t.contains("timed out") || t.contains("ETIMEDOUT")) {
            return "La presa non risponde: controllare che l'indirizzo sia corretto e che la presa sia alimentata.";
        }
        if (t.contains("CLEARTEXT")) {
            return "L'app non ha il permesso di collegarsi alle prese in rete locale.";
        }
        return "Collegamento non riuscito. KLAP: " + klap + " | AES: " + aes;
    }

    /** Il nome dato alla presa nell'app Tapo viaggia codificato in base64. */
    private static String nome(String nickname) {
        if (nickname == null || nickname.isEmpty()) {
            return "";
        }
        try {
            return new String(Base64.decode(nickname, Base64.DEFAULT), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    /** Legge dalla presa se è accesa. */
    public static Stato leggiStato(final String ip, final String email, final String password) throws Exception {
        return inFila(ip, () -> {
            Sessione s = apri(ip, email, password);
            try {
                JSONObject risposta = s.dispositivo.info();
                JSONObject info = risposta.optJSONObject("result");
                if (info == null) {
                    info = new JSONObject();
                }
                return new Stato(info.optBoolean("device_on", false), s.protocollo, nome(info.optString("nickname", "")));
            } catch (Exception e) {
                dimentica(ip);
                throw e;
            }
        });
    }

    /** Accende (true) o spegne (false) la presa. Restituisce il protocollo usato. */
    public static String comanda(final String ip, final String email, final String password, final boolean acceso)
            throws Exception {
        return inFila(ip, () -> {
            Sessione s = apri(ip, email, password);
            try {
                s.dispositivo.imposta(acceso);
                return s.protocollo;
            } catch (Exception e) {
                // Sessione scaduta o presa scollegata: al prossimo comando si ricomincia
                dimentica(ip);
                throw e;
            }
        });
    }
}
