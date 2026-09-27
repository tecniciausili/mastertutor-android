package it.tecniciausili.mastertutor.tapo;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

import javax.crypto.Cipher;

import org.json.JSONObject;

/**
 * Protocollo KLAP v2 delle prese Tapo con firmware recenti.
 * Traduzione di ponte/tapo/klap.js (app di CHIARA).
 *
 * 1. auth_hash = sha256(sha1(email) + sha1(password))
 * 2. handshake1: invia local_seed, riceve remote_seed + server_hash + cookie
 * 3. handshake2: invia sha256(remote_seed + local_seed + auth_hash) con cookie
 * 4. request: comandi cifrati AES-CBC con firma SHA256
 */
final class TapoKlap implements TapoDispositivo {

    private static final int TIMEOUT_MS = 5000;

    private final String ip;
    private final byte[] authHash;

    private boolean sessione = false;
    private String cookie;
    private byte[] chiave;
    private byte[] ivBase;
    private byte[] firma;
    private int seq;

    /** Segnala una sessione scaduta (HTTP 403 su una richiesta): si rifà l'handshake. */
    private static final class SessioneScaduta extends Exception {}

    TapoKlap(String ip, String email, String password) throws Exception {
        this.ip = ip;
        this.authHash = Cripto.sha256(Cripto.unisci(
            Cripto.sha1(Cripto.testo(email)),
            Cripto.sha1(Cripto.testo(password))));
    }

    private void handshake() throws Exception {
        sessione = false;
        byte[] locale = Cripto.casuali(16);

        TapoHttp.Risposta hs1 = TapoHttp.post(ip, "/app/handshake1", locale, null, false, TIMEOUT_MS);
        if (hs1.status == 403) {
            throw new Exception("403 Forbidden - Attiva \"Compatibilità terze parti\" nell'app Tapo");
        }
        if (hs1.status != 200) {
            throw new Exception("Handshake1 fallito: HTTP " + hs1.status);
        }
        if (hs1.corpo.length < 48) {
            throw new Exception("Handshake1: risposta troppo corta");
        }
        byte[] remoto = Arrays.copyOfRange(hs1.corpo, 0, 16);
        byte[] hashServer = Arrays.copyOfRange(hs1.corpo, 16, 48);
        cookie = hs1.cookie;

        byte[] atteso = Cripto.sha256(Cripto.unisci(locale, remoto, authHash));
        if (!MessageDigest.isEqual(hashServer, atteso)) {
            throw new Exception("Credenziali errate (hash mismatch)");
        }

        byte[] hs2Corpo = Cripto.sha256(Cripto.unisci(remoto, locale, authHash));
        TapoHttp.Risposta hs2 = TapoHttp.post(ip, "/app/handshake2", hs2Corpo, cookie, false, TIMEOUT_MS);
        if (hs2.status != 200) {
            throw new Exception("Handshake2 fallito: HTTP " + hs2.status);
        }

        byte[] insieme = Cripto.unisci(locale, remoto, authHash);
        chiave = Arrays.copyOf(Cripto.sha256(Cripto.unisci(Cripto.testo("lsk"), insieme)), 16);
        byte[] ivSeed = Cripto.sha256(Cripto.unisci(Cripto.testo("iv"), insieme));
        ivBase = Arrays.copyOf(ivSeed, 12);
        firma = Arrays.copyOf(Cripto.sha256(Cripto.unisci(Cripto.testo("ldk"), insieme)), 28);
        seq = ByteBuffer.wrap(ivSeed, ivSeed.length - 4, 4).getInt();   // int32 big-endian con segno
        sessione = true;
    }

    private byte[] iv(int numero) {
        return Cripto.unisci(ivBase, ByteBuffer.allocate(4).putInt(numero).array());
    }

    private JSONObject richiesta(JSONObject comando) throws Exception {
        seq += 1;
        byte[] numero = ByteBuffer.allocate(4).putInt(seq).array();
        byte[] cifrato = Cripto.aes(Cipher.ENCRYPT_MODE, chiave, iv(seq), Cripto.testo(comando.toString()));
        byte[] firmaComando = Cripto.sha256(Cripto.unisci(firma, numero, cifrato));

        TapoHttp.Risposta r = TapoHttp.post(ip, "/app/request?seq=" + seq,
            Cripto.unisci(firmaComando, cifrato), cookie, false, TIMEOUT_MS);
        if (r.status == 403) {
            throw new SessioneScaduta();
        }
        if (r.status != 200) {
            throw new Exception("Request fallita: HTTP " + r.status);
        }
        byte[] dati = Arrays.copyOfRange(r.corpo, 32, r.corpo.length);
        byte[] chiaro = Cripto.aes(Cipher.DECRYPT_MODE, chiave, iv(seq), dati);
        return new JSONObject(new String(chiaro, StandardCharsets.UTF_8));
    }

    private JSONObject invia(JSONObject comando) throws Exception {
        if (!sessione) {
            handshake();
        }
        try {
            try {
                return richiesta(comando);
            } catch (SessioneScaduta scaduta) {
                // Sessione scaduta: nuovo handshake e un solo nuovo tentativo
                handshake();
                try {
                    return richiesta(comando);
                } catch (SessioneScaduta ancora) {
                    throw new Exception("Request fallita: HTTP 403");
                }
            }
        } catch (Exception e) {
            sessione = false;   // al prossimo comando si ricomincia dall'handshake
            throw e;
        }
    }

    @Override
    public JSONObject info() throws Exception {
        return invia(new JSONObject().put("method", "get_device_info"));
    }

    @Override
    public void imposta(boolean acceso) throws Exception {
        JSONObject esito = invia(new JSONObject()
            .put("method", "set_device_info")
            .put("params", new JSONObject().put("device_on", acceso)));
        int codice = esito.optInt("error_code", 0);
        if (codice != 0) {
            throw new Exception("Comando rifiutato dalla presa (errore " + codice + ")");
        }
    }
}
