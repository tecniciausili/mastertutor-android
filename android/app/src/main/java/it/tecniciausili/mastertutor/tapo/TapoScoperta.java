package it.tecniciausili.mastertutor.tapo;

import android.util.Base64;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.util.Arrays;
import java.util.zip.CRC32;

import org.json.JSONObject;

/**
 * «Scoperta» di una presa Tapo con il messaggio TDP (UDP, porta 20002), lo stesso che manda
 * l'app Tapo del telefono. Traduzione di tapo/scoperta.js della versione Windows.
 *
 * Serve per i firmware 1.4.x delle P110 (2026):
 *  1. dopo l'accensione la presa non avvia il servizio locale (porta 80) finché non riceve
 *     questo messaggio: senza, per 8-9 minuti rifiuta i collegamenti;
 *  2. la risposta dice il protocollo: KLAP, AES oppure TPAP. TPAP è quello che la presa usa
 *     quando nell'app Tapo è spenta la «Compatibilità con terze parti».
 */
final class TapoScoperta {

    private static final int PORTA = 20002;
    private static final int SEGNAPOSTO_CRC = 0x5A6B7C8D;

    /** Quello che la presa dice di sé. */
    static final class Esito {
        final String protocollo;   // "KLAP", "AES", "TPAP" oppure ""

        Esito(String protocollo) {
            this.protocollo = protocollo;
        }
    }

    private static byte[] pacchetto;

    private TapoScoperta() {}

    private static synchronized byte[] pacchetto() throws Exception {
        if (pacchetto == null) {
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048);
            String b64 = Base64.encodeToString(g.generateKeyPair().getPublic().getEncoded(), Base64.NO_WRAP);
            StringBuilder pem = new StringBuilder("-----BEGIN PUBLIC KEY-----\n");
            for (int i = 0; i < b64.length(); i += 64) {
                pem.append(b64, i, Math.min(b64.length(), i + 64)).append('\n');
            }
            pem.append("-----END PUBLIC KEY-----\n");
            byte[] corpo = new JSONObject()
                .put("params", new JSONObject().put("rsa_key", pem.toString()))
                .toString().getBytes(StandardCharsets.UTF_8);

            ByteBuffer b = ByteBuffer.allocate(16 + corpo.length);
            b.put((byte) 2).put((byte) 0).putShort((short) 1).putShort((short) corpo.length)
                .put((byte) 17).put((byte) 0)
                .putInt(ByteBuffer.wrap(Cripto.casuali(4)).getInt())
                .putInt(SEGNAPOSTO_CRC)
                .put(corpo);
            byte[] tutto = b.array();
            CRC32 crc = new CRC32();
            crc.update(tutto);
            ByteBuffer.wrap(tutto, 12, 4).putInt((int) crc.getValue());
            pacchetto = tutto;
        }
        return pacchetto;
    }

    /** Manda la scoperta alla presa e aspetta la risposta per al massimo attesaMs; null se tace. */
    static Esito scopri(String ip, int attesaMs) {
        try (DatagramSocket socket = new DatagramSocket()) {
            byte[] dati = pacchetto();
            InetAddress indirizzo = InetAddress.getByName(ip);
            long fine = System.currentTimeMillis() + attesaMs;
            byte[] ricevuti = new byte[4096];
            // Più invii: l'UDP può perdersi e la presa appena accesa può non sentire il primo
            for (int invio = 0; invio < 3; invio++) {
                socket.send(new DatagramPacket(dati, dati.length, indirizzo, PORTA));
                long finestra = Math.min(fine, System.currentTimeMillis() + (invio < 2 ? 400 : attesaMs));
                while (true) {
                    int resta = (int) (finestra - System.currentTimeMillis());
                    if (resta <= 0) {
                        break;
                    }
                    socket.setSoTimeout(resta);
                    DatagramPacket risposta = new DatagramPacket(ricevuti, ricevuti.length);
                    try {
                        socket.receive(risposta);
                    } catch (SocketTimeoutException t) {
                        break;
                    }
                    if (!risposta.getAddress().equals(indirizzo) || risposta.getLength() <= 16) {
                        continue;
                    }
                    String json = new String(Arrays.copyOfRange(ricevuti, 16, risposta.getLength()), StandardCharsets.UTF_8);
                    JSONObject result = new JSONObject(json).optJSONObject("result");
                    JSONObject schema = result == null ? null : result.optJSONObject("mgt_encrypt_schm");
                    String protocollo = schema == null ? "" : schema.optString("encrypt_type", "");
                    return new Esito(protocollo.toUpperCase());
                }
                if (System.currentTimeMillis() >= fine) {
                    break;
                }
            }
        } catch (Exception e) {
            // La scoperta è solo un aiuto: se non va si prova comunque a collegarsi
        }
        return null;
    }
}
