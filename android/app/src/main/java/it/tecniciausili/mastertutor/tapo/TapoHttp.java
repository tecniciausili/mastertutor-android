package it.tecniciausili.mastertutor.tapo;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * POST HTTP verso una presa Tapo della rete locale (porta 80, in chiaro: le prese
 * non parlano https). Una connessione nuova per ogni richiesta: il server della
 * presa chiude le connessioni senza avvisare e riusarne una già chiusa fa fallire
 * il comando.
 */
final class TapoHttp {

    static final class Risposta {
        final int status;
        final byte[] corpo;
        final String cookie;   // "TP_SESSIONID=..." oppure null

        Risposta(int status, byte[] corpo, String cookie) {
            this.status = status;
            this.corpo = corpo;
            this.cookie = cookie;
        }
    }

    private static final Pattern SESSIONE = Pattern.compile("(?:TP_)?SESSIONID=([^;]+)");

    private TapoHttp() {}

    /** json = true per il protocollo AES (intestazioni richieste da quei firmware). */
    static Risposta post(String ip, String percorso, byte[] corpo, String cookie, boolean json, int timeoutMs)
            throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL("http://" + ip + ":80" + percorso).openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setDoOutput(true);
            conn.setUseCaches(false);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("Connection", "close");
            if (json) {
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("requestByApp", "true");
            } else {
                conn.setRequestProperty("Content-Type", "application/octet-stream");
            }
            if (cookie != null) {
                conn.setRequestProperty("Cookie", cookie);
            }
            // La presa vuole la lunghezza esatta del corpo
            conn.setFixedLengthStreamingMode(corpo.length);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(corpo);
            }

            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            byte[] risposta = leggiTutto(in);

            String sessione = null;
            Map<String, List<String>> intestazioni = conn.getHeaderFields();
            for (Map.Entry<String, List<String>> voce : intestazioni.entrySet()) {
                if (voce.getKey() == null || !voce.getKey().equalsIgnoreCase("Set-Cookie")) {
                    continue;
                }
                for (String valore : voce.getValue()) {
                    Matcher m = SESSIONE.matcher(valore);
                    if (m.find()) {
                        sessione = "TP_SESSIONID=" + m.group(1);
                        break;
                    }
                }
            }
            return new Risposta(status, risposta, sessione);
        } finally {
            conn.disconnect();
        }
    }

    private static byte[] leggiTutto(InputStream in) throws Exception {
        if (in == null) {
            return new byte[0];
        }
        try (InputStream flusso = in) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] pezzo = new byte[4096];
            int letti;
            while ((letti = flusso.read(pezzo)) != -1) {
                buffer.write(pezzo, 0, letti);
            }
            return buffer.toByteArray();
        }
    }
}
