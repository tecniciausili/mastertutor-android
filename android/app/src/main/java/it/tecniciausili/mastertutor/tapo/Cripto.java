package it.tecniciausili.mastertutor.tapo;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Piccoli aiuti di crittografia comuni ai due protocolli. */
final class Cripto {

    private static final SecureRandom CASO = new SecureRandom();

    private Cripto() {}

    static byte[] sha1(byte[] dati) throws Exception {
        return MessageDigest.getInstance("SHA-1").digest(dati);
    }

    static byte[] sha256(byte[] dati) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(dati);
    }

    static String sha1Esadecimale(String testo) throws Exception {
        byte[] hash = sha1(testo.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : hash) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    static byte[] casuali(int quanti) {
        byte[] b = new byte[quanti];
        CASO.nextBytes(b);
        return b;
    }

    static byte[] unisci(byte[]... parti) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parti) {
            out.write(p, 0, p.length);
        }
        return out.toByteArray();
    }

    static byte[] testo(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    // AES-128-CBC con padding PKCS7 (in Java si chiama PKCS5Padding)
    static byte[] aes(int modo, byte[] chiave, byte[] iv, byte[] dati) throws Exception {
        Cipher c = Cipher.getInstance("AES/CBC/PKCS5Padding");
        c.init(modo, new SecretKeySpec(chiave, "AES"), new IvParameterSpec(iv));
        return c.doFinal(dati);
    }
}
