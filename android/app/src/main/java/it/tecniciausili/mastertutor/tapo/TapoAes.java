package it.tecniciausili.mastertutor.tapo;

import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.util.Arrays;

import javax.crypto.Cipher;

import org.json.JSONObject;

/**
 * Protocollo "Secure Passthrough" (AES) delle prese Tapo con firmware meno recenti,
 * per esempio la P100 1.3.7. Traduzione di ponte/tapo/passthrough.js, a sua volta
 * scritto sul modello di AesTransport di python-kasa:
 *
 * 1. POST /app handshake con la chiave pubblica RSA (PEM su una riga) → chiave AES cifrata
 * 2. login_device cifrato: versione 2 (password2 = base64(sha1 esadecimale)), poi 1
 * 3. comandi cifrati su /app?token=...
 */
final class TapoAes implements TapoDispositivo {

    private static final int TIMEOUT_MS = 8000;
    private static final int ERRORE_CREDENZIALI = -1501;

    private final String ip;
    private final String email;
    private final String password;
    private final String terminale;

    private byte[] chiave;
    private byte[] iv;
    private String cookie;
    private String token;
    private int versioneLogin = 0;   // 2 o 1, ricordata dopo il primo login riuscito

    /** Errore restituito dalla presa, con il suo codice numerico. */
    private static final class ErrorePresa extends Exception {
        final int codice;

        ErrorePresa(String messaggio, int codice) {
            super(messaggio);
            this.codice = codice;
        }
    }

    TapoAes(String ip, String email, String password) throws Exception {
        this.ip = ip;
        this.email = email;
        this.password = password;
        this.terminale = Base64.encodeToString(
            MessageDigest.getInstance("MD5").digest(Cripto.casuali(16)), Base64.NO_WRAP);
    }

    private static String b64(byte[] dati) {
        return Base64.encodeToString(dati, Base64.NO_WRAP);
    }

    // org.json scrive "/" come "\/": alcune prese vogliono esattamente il formato di python-kasa
    private static String json(JSONObject o) {
        return o.toString().replace("\\/", "/");
    }

    private void handshake() throws Exception {
        token = null;
        chiave = null;
        KeyPairGenerator generatore = KeyPairGenerator.getInstance("RSA");
        generatore.initialize(1024);
        KeyPair coppia = generatore.generateKeyPair();
        // getEncoded() della chiave pubblica è già SubjectPublicKeyInfo (DER)
        String pem = "-----BEGIN PUBLIC KEY-----\n" + b64(coppia.getPublic().getEncoded()) + "\n-----END PUBLIC KEY-----\n";
        // Corpo scritto a mano, identico a python-kasa (314 byte per RSA-1024)
        String corpo = "{\"method\":\"handshake\",\"params\":{\"key\":\"" + pem.replace("\n", "\\n") + "\"}}";

        TapoHttp.Risposta r = TapoHttp.post(ip, "/app", corpo.getBytes(StandardCharsets.UTF_8), null, true, TIMEOUT_MS);
        if (r.status == 404) {
            throw new Exception("PASSTHROUGH_NOT_SUPPORTED");
        }
        if (r.status != 200) {
            throw new Exception("Passthrough handshake fallito: HTTP " + r.status);
        }
        JSONObject esito = leggiJson(r, "handshake");
        if (esito.optInt("error_code", -1) != 0) {
            throw new Exception("Passthrough handshake errore: " + esito.optInt("error_code", -1));
        }

        Cipher rsa = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        rsa.init(Cipher.DECRYPT_MODE, coppia.getPrivate());
        byte[] chiaveIv = rsa.doFinal(Base64.decode(esito.getJSONObject("result").getString("key"), Base64.DEFAULT));
        chiave = Arrays.copyOfRange(chiaveIv, 0, 16);
        iv = Arrays.copyOfRange(chiaveIv, 16, 32);
        cookie = r.cookie;
    }

    private static JSONObject leggiJson(TapoHttp.Risposta r, String fase) throws Exception {
        try {
            return new JSONObject(new String(r.corpo, StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new Exception("Passthrough " + fase + ": risposta non JSON (HTTP " + r.status + ")");
        }
    }

    /** Invia un messaggio cifrato e restituisce la risposta decifrata della presa. */
    private JSONObject passthrough(JSONObject messaggio) throws Exception {
        String richiesta = b64(Cripto.aes(Cipher.ENCRYPT_MODE, chiave, iv, Cripto.testo(json(messaggio))));
        String corpo = "{\"method\":\"securePassthrough\",\"params\":{\"request\":\"" + richiesta + "\"}}";
        String percorso = token != null ? "/app?token=" + token : "/app";

        TapoHttp.Risposta r = TapoHttp.post(ip, percorso, corpo.getBytes(StandardCharsets.UTF_8), cookie, true, TIMEOUT_MS);
        if (r.status != 200) {
            throw new Exception("Passthrough request fallita: HTTP " + r.status);
        }
        JSONObject esterno = leggiJson(r, "request");
        int codice = esterno.optInt("error_code", -1);
        if (codice != 0) {
            throw new ErrorePresa("Passthrough risposta errore: " + codice, codice);
        }
        String risposta = esterno.getJSONObject("result").getString("response");
        try {
            byte[] chiaro = Cripto.aes(Cipher.DECRYPT_MODE, chiave, iv, Base64.decode(risposta, Base64.DEFAULT));
            return new JSONObject(new String(chiaro, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONObject(risposta);   // alcuni firmware rispondono in chiaro
        }
    }

    private JSONObject parametriLogin(int versione) throws Exception {
        String utente = b64(Cripto.testo(Cripto.sha1Esadecimale(email)));
        JSONObject p = new JSONObject().put("username", utente);
        if (versione == 2) {
            p.put("password2", b64(Cripto.testo(Cripto.sha1Esadecimale(password))));
        } else {
            p.put("password", b64(Cripto.testo(password)));
        }
        return p;
    }

    private void login() throws Exception {
        int[] versioni = versioneLogin != 0 ? new int[] {versioneLogin} : new int[] {2, 1};
        Integer codice = null;
        for (int versione : versioni) {
            // Dopo un login fallito la presa vuole un nuovo handshake
            if (codice != null) {
                handshake();
            }
            JSONObject risposta;
            try {
                risposta = passthrough(new JSONObject()
                    .put("method", "login_device")
                    .put("params", parametriLogin(versione))
                    .put("request_time_milis", System.currentTimeMillis()));
            } catch (ErrorePresa e) {
                risposta = new JSONObject().put("error_code", e.codice);
            }
            int esito = risposta.optInt("error_code", -1);
            JSONObject result = risposta.optJSONObject("result");
            if (esito == 0 && result != null && result.has("token")) {
                token = result.getString("token");
                versioneLogin = versione;
                return;
            }
            codice = esito;
        }
        chiave = null;
        if (codice != null && codice == ERRORE_CREDENZIALI) {
            throw new Exception("Passthrough login: credenziali errate (hash mismatch)");
        }
        throw new Exception("Passthrough login errore: " + codice);
    }

    private JSONObject invia(JSONObject comando, int tentativiRimasti) throws Exception {
        boolean sessioneNuova = token == null || chiave == null;
        if (sessioneNuova) {
            handshake();
            login();
        }
        try {
            comando.put("request_time_milis", System.currentTimeMillis());
            comando.put("terminal_uuid", terminale);
            JSONObject risposta = passthrough(comando);
            int codice = risposta.optInt("error_code", 0);
            if (codice != 0) {
                throw new Exception("Passthrough comando errore: " + codice);
            }
            return risposta;
        } catch (Exception e) {
            token = null;
            chiave = null;
            // Sessione scaduta (dura circa un giorno) o presa riavviata: un solo nuovo tentativo
            if (!sessioneNuova && tentativiRimasti > 0) {
                return invia(comando, tentativiRimasti - 1);
            }
            throw e;
        }
    }

    @Override
    public JSONObject info() throws Exception {
        return invia(new JSONObject().put("method", "get_device_info"), 1);
    }

    @Override
    public void imposta(boolean acceso) throws Exception {
        invia(new JSONObject()
            .put("method", "set_device_info")
            .put("params", new JSONObject().put("device_on", acceso)), 1);
    }
}
