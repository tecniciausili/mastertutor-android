package it.tecniciausili.mastertutor;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import org.json.JSONArray;
import org.json.JSONObject;

import it.tecniciausili.mastertutor.tapo.TapoPrese;

/**
 * Il "ponte" dentro il tablet: nell'APK la presa Tapo si comanda direttamente,
 * senza Azure e senza il programma ponte su un computer. Offre alla parte web
 * (js/presa-nativa.js) le stesse funzioni del ponte:
 *
 *   leggiConfigurazione  account (senza password) e prese
 *   salvaConfigurazione  salva account e prese, poi prova ogni presa
 *   accendi              accende per N secondi; lo spegnimento è programmato qui
 *   spegni               spegne subito
 *   verifica             elenco delle prese
 *
 * La password resta nella memoria privata dell'app e non torna mai alla parte web.
 */
@CapacitorPlugin(name = "PresaTapo")
public class PresaTapoPlugin extends Plugin {

    private static final String TAG = "PresaTapo";
    private static final String PREFS = "presa_tapo";
    private static final int MAX_PRESE = 10;
    private static final int MAX_SECONDI = 600;
    private static final int TENTATIVI_SPEGNIMENTO = 3;
    private static final Pattern IPV4 =
        Pattern.compile("^(25[0-5]|2[0-4]\\d|1?\\d?\\d)(\\.(25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}$");

    private final ExecutorService lavoro = Executors.newCachedThreadPool();
    private final ScheduledExecutorService orologio = Executors.newSingleThreadScheduledExecutor();
    private final Map<String, ScheduledFuture<?>> accese = new HashMap<>();   // id → spegnimento programmato

    // ==================== CONFIGURAZIONE ====================

    private static final class PresaConf {
        final String id;
        final String nome;
        final String ip;

        PresaConf(String id, String nome, String ip) {
            this.id = id;
            this.nome = nome;
            this.ip = ip;
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String email() {
        return prefs().getString("email", "");
    }

    private String password() {
        return prefs().getString("password", "");
    }

    private List<PresaConf> prese() {
        List<PresaConf> elenco = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs().getString("prese", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                elenco.add(new PresaConf(o.getString("id"), o.getString("nome"), o.getString("ip")));
            }
        } catch (Exception e) {
            Log.w(TAG, "Configurazione delle prese non leggibile", e);
        }
        return elenco;
    }

    private static JSArray elencoPubblico(List<PresaConf> elenco) {
        JSArray a = new JSArray();
        for (PresaConf p : elenco) {
            JSObject o = new JSObject();
            o.put("id", p.id);
            o.put("nome", p.nome);
            o.put("ip", p.ip);
            a.put(o);
        }
        return a;
    }

    private JSObject configurazionePubblica() {
        JSObject account = new JSObject();
        account.put("email", email());
        account.put("passwordImpostata", !password().isEmpty());
        JSObject conf = new JSObject();
        conf.put("account", account);
        conf.put("prese", elencoPubblico(prese()));
        conf.put("versione", versione());
        conf.put("simulazione", false);
        conf.put("locale", true);
        return conf;
    }

    private String versione() {
        try {
            return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** Messaggio se manca qualcosa per comandare le prese, altrimenti "". */
    private String manca() {
        if (prese().isEmpty()) {
            return "Non ci sono prese configurate: premi «Configura le prese».";
        }
        if (email().isEmpty() || password().isEmpty()) {
            return "Manca l'account Tapo (email e password): premi «Configura le prese».";
        }
        return "";
    }

    // ==================== AVVIO E CHIUSURA ====================

    @Override
    public void load() {
        // Se l'app è stata chiusa di colpo con una presa accesa, la spengo adesso
        final Set<String> rimaste = new HashSet<>(prefs().getStringSet("accese", new HashSet<String>()));
        if (!rimaste.isEmpty()) {
            lavoro.submit(() -> {
                for (PresaConf p : prese()) {
                    if (rimaste.contains(p.id)) {
                        spegniUna(p, "riavvio dell'app", TENTATIVI_SPEGNIMENTO);
                    }
                }
            });
        }
    }

    @Override
    protected void handleOnDestroy() {
        // Chiusura dell'app: spengo quelle accese da noi
        final List<PresaConf> daSpegnere = new ArrayList<>();
        synchronized (accese) {
            for (PresaConf p : prese()) {
                if (accese.containsKey(p.id)) {
                    daSpegnere.add(p);
                }
            }
        }
        for (PresaConf p : daSpegnere) {
            lavoro.submit(() -> spegniUna(p, "chiusura dell'app", 1));
        }
        super.handleOnDestroy();
    }

    private void segnaAccesa(String id, boolean accesa) {
        synchronized (accese) {
            Set<String> insieme = new HashSet<>(prefs().getStringSet("accese", new HashSet<String>()));
            if (accesa) {
                insieme.add(id);
            } else {
                insieme.remove(id);
            }
            prefs().edit().putStringSet("accese", insieme).apply();
        }
    }

    // ==================== COMANDI ====================

    /** Prese richieste; se l'elenco è vuoto (o non corrisponde) valgono tutte. */
    private List<PresaConf> selezione(JSArray ids) {
        List<PresaConf> tutte = prese();
        Set<String> richieste = new HashSet<>();
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) {
                richieste.add(ids.optString(i));
            }
        }
        if (richieste.isEmpty()) {
            return tutte;
        }
        List<PresaConf> scelte = new ArrayList<>();
        for (PresaConf p : tutte) {
            if (richieste.contains(p.id)) {
                scelte.add(p);
            }
        }
        return scelte.isEmpty() ? tutte : scelte;
    }

    private JSObject riassunto(List<PresaConf> elenco, List<String> errori) {
        JSArray risultati = new JSArray();
        List<String> messaggi = new ArrayList<>();
        boolean qualcunaOk = false;
        for (int i = 0; i < elenco.size(); i++) {
            JSObject r = new JSObject();
            r.put("id", elenco.get(i).id);
            String errore = errori.get(i);
            r.put("ok", errore == null);
            if (errore == null) {
                qualcunaOk = true;
            } else {
                r.put("errore", errore);
                messaggi.add(elenco.get(i).nome + ": " + errore);
            }
            risultati.put(r);
        }
        JSObject esito = new JSObject();
        esito.put("ok", qualcunaOk);
        esito.put("prese", risultati);
        esito.put("errore", android.text.TextUtils.join(" · ", messaggi));
        return esito;
    }

    /** Esegue un compito per ogni presa in parallelo; restituisce l'errore di ognuna (null = ok). */
    private List<String> perOgniPresa(List<PresaConf> elenco, PerPresa compito) {
        List<Future<String>> futuri = new ArrayList<>();
        for (final PresaConf p : elenco) {
            futuri.add(lavoro.submit(() -> {
                try {
                    compito.esegui(p);
                    return null;
                } catch (Exception e) {
                    return e.getMessage() == null ? e.toString() : e.getMessage();
                }
            }));
        }
        List<String> errori = new ArrayList<>();
        for (Future<String> f : futuri) {
            try {
                errori.add(f.get());
            } catch (Exception e) {
                errori.add(e.toString());
            }
        }
        return errori;
    }

    private interface PerPresa {
        void esegui(PresaConf p) throws Exception;
    }

    private void programmaSpegnimento(final PresaConf p, int secondi) {
        synchronized (accese) {
            ScheduledFuture<?> prima = accese.remove(p.id);
            if (prima != null) {
                prima.cancel(false);
            }
            accese.put(p.id, orologio.schedule(
                () -> lavoro.submit(() -> spegniUna(p, "tempo scaduto", TENTATIVI_SPEGNIMENTO)),
                secondi, TimeUnit.SECONDS));
        }
        segnaAccesa(p.id, true);
    }

    /** Spegnimento con qualche nuovo tentativo: una presa non deve restare accesa per un errore di rete. */
    private String spegniUna(final PresaConf p, final String motivo, final int tentativiRimasti) {
        synchronized (accese) {
            ScheduledFuture<?> programmato = accese.remove(p.id);
            if (programmato != null) {
                programmato.cancel(false);
            }
        }
        try {
            TapoPrese.comanda(p.ip, email(), password(), false);
            segnaAccesa(p.id, false);
            Log.i(TAG, "Spenta: " + p.nome + " (" + motivo + ")");
            JSObject evento = new JSObject();
            evento.put("prese", new JSArray().put(p.id));
            notifyListeners("spenta", evento);
            return null;
        } catch (Exception e) {
            if (tentativiRimasti > 1) {
                Log.w(TAG, "Spegnimento di " + p.nome + " non riuscito: riprovo tra 3 secondi", e);
                orologio.schedule(() -> lavoro.submit(() -> spegniUna(p, motivo, tentativiRimasti - 1)),
                    3, TimeUnit.SECONDS);
            } else {
                Log.e(TAG, "ATTENZIONE: " + p.nome + " potrebbe essere rimasta ACCESA", e);
            }
            return e.getMessage();
        }
    }

    // ==================== METODI PER LA PARTE WEB ====================

    @PluginMethod
    public void leggiConfigurazione(PluginCall call) {
        call.resolve(configurazionePubblica());
    }

    @PluginMethod
    public void verifica(PluginCall call) {
        JSObject r = new JSObject();
        r.put("prese", elencoPubblico(prese()));
        r.put("versione", versione());
        call.resolve(r);
    }

    @PluginMethod
    public void accendi(final PluginCall call) {
        final JSArray ids = call.getArray("prese", new JSArray());
        final int secondi = Math.min(MAX_SECONDI, Math.max(1, call.getInt("secondi", 5)));
        lavoro.submit(() -> {
            String problema = manca();
            if (!problema.isEmpty()) {
                JSObject esito = new JSObject();
                esito.put("ok", false);
                esito.put("errore", problema);
                call.resolve(esito);
                return;
            }
            final String e = email();
            final String pw = password();
            List<PresaConf> elenco = selezione(ids);
            List<String> errori = perOgniPresa(elenco, (p) -> {
                boolean giaAccesa;
                synchronized (accese) {
                    giaAccesa = accese.containsKey(p.id);
                }
                if (!giaAccesa) {
                    TapoPrese.comanda(p.ip, e, pw, true);
                }
                // Già accesa: allungo soltanto il tempo
                programmaSpegnimento(p, secondi);
            });
            call.resolve(riassunto(elenco, errori));
        });
    }

    @PluginMethod
    public void spegni(final PluginCall call) {
        final JSArray ids = call.getArray("prese", new JSArray());
        lavoro.submit(() -> {
            if (!manca().isEmpty()) {
                JSObject esito = new JSObject();
                esito.put("ok", true);
                esito.put("prese", new JSArray());
                esito.put("errore", "");
                call.resolve(esito);
                return;
            }
            List<PresaConf> elenco = selezione(ids);
            List<String> errori = new ArrayList<>();
            for (PresaConf p : elenco) {
                errori.add(spegniUna(p, "comando dall'app", TENTATIVI_SPEGNIMENTO));
            }
            call.resolve(riassunto(elenco, errori));
        });
    }

    @PluginMethod
    public void salvaConfigurazione(final PluginCall call) {
        final JSObject account = call.getObject("account", new JSObject());
        final JSArray elenco = call.getArray("prese", new JSArray());
        lavoro.submit(() -> {
            try {
                String nuovaEmail = account.optString("email", "").trim();
                if (nuovaEmail.isEmpty()) {
                    throw new Exception("Manca l'email dell'account Tapo.");
                }
                String nuovaPassword = account.optString("password", "");
                List<PresaConf> nuove = validaPrese(elenco);

                // Prima di cambiare spengo quelle accese: il comando deve arrivare alla presa vecchia
                List<PresaConf> vecchie = prese();
                for (PresaConf p : vecchie) {
                    boolean accesa;
                    synchronized (accese) {
                        accesa = accese.containsKey(p.id);
                    }
                    if (accesa) {
                        spegniUna(p, "nuova configurazione", 1);
                    }
                }

                JSONArray salvate = new JSONArray();
                for (PresaConf p : nuove) {
                    salvate.put(new JSONObject().put("id", p.id).put("nome", p.nome).put("ip", p.ip));
                }
                SharedPreferences.Editor ed = prefs().edit()
                    .putString("email", nuovaEmail)
                    .putString("prese", salvate.toString());
                if (!nuovaPassword.isEmpty()) {
                    ed.putString("password", nuovaPassword);   // vuota = tieni quella salvata
                }
                ed.apply();
                TapoPrese.dimentica(null);
                Log.i(TAG, "Configurazione aggiornata: " + nuove.size() + " prese");

                // Provo subito ogni presa, così chi configura sa se è tutto a posto
                final String problema = manca();
                final String e = email();
                final String pw = password();
                final List<JSObject> verifiche = new ArrayList<>();
                for (int i = 0; i < nuove.size(); i++) {
                    verifiche.add(null);
                }
                List<Future<?>> futuri = new ArrayList<>();
                for (int i = 0; i < nuove.size(); i++) {
                    final int indice = i;
                    final PresaConf p = nuove.get(i);
                    futuri.add(lavoro.submit(() -> {
                        JSObject v = new JSObject();
                        v.put("id", p.id);
                        v.put("nome", p.nome);
                        v.put("ip", p.ip);
                        if (!problema.isEmpty()) {
                            v.put("ok", false);
                            v.put("errore", problema);
                        } else {
                            try {
                                TapoPrese.Stato s = TapoPrese.leggiStato(p.ip, e, pw);
                                v.put("ok", true);
                                v.put("acceso", s.acceso);
                                v.put("protocollo", s.protocollo);
                            } catch (Exception ex) {
                                v.put("ok", false);
                                v.put("errore", ex.getMessage());
                            }
                        }
                        synchronized (verifiche) {
                            verifiche.set(indice, v);
                        }
                    }));
                }
                for (Future<?> f : futuri) {
                    f.get();
                }
                JSObject esito = configurazionePubblica();
                JSArray lista = new JSArray();
                for (JSObject v : verifiche) {
                    lista.put(v);
                }
                esito.put("verifiche", lista);
                esito.put("ok", true);
                call.resolve(esito);
            } catch (Exception ex) {
                call.reject(ex.getMessage() == null ? ex.toString() : ex.getMessage());
            }
        });
    }

    /** Controlla e normalizza l'elenco delle prese; mantiene l'id di quelle già note. */
    private List<PresaConf> validaPrese(JSArray elenco) throws Exception {
        if (elenco.length() > MAX_PRESE) {
            throw new Exception("Al massimo " + MAX_PRESE + " prese.");
        }
        List<PresaConf> note = prese();
        Set<String> usati = new HashSet<>();
        Set<String> indirizzi = new HashSet<>();
        List<PresaConf> risultato = new ArrayList<>();
        for (int i = 0; i < elenco.length(); i++) {
            JSONObject voce = elenco.optJSONObject(i);
            if (voce == null) {
                throw new Exception("Elenco delle prese non valido.");
            }
            String nome = voce.optString("nome", "").trim();
            if (nome.length() > 60) {
                nome = nome.substring(0, 60);
            }
            String ip = voce.optString("ip", "").trim();
            String idRichiesto = voce.optString("id", "");
            if (nome.isEmpty()) {
                throw new Exception("Presa " + (i + 1) + ": manca il nome.");
            }
            if (!IPV4.matcher(ip).matches()) {
                throw new Exception("\"" + nome + "\": l'indirizzo IP \"" + ip + "\" non è valido (esempio: 192.168.1.65).");
            }
            if (!indirizzi.add(ip)) {
                throw new Exception("L'indirizzo " + ip + " compare due volte.");
            }
            String id = "";
            for (PresaConf p : note) {
                if ((p.id.equals(idRichiesto) || p.ip.equals(ip)) && !usati.contains(p.id)) {
                    id = p.id;
                    break;
                }
            }
            if (id.isEmpty()) {
                int n = 1;
                while (usati.contains("presa" + n) || idUsatoDaAltra(note, "presa" + n, ip)) {
                    n++;
                }
                id = "presa" + n;
            }
            usati.add(id);
            risultato.add(new PresaConf(id, nome, ip));
        }
        return risultato;
    }

    private static boolean idUsatoDaAltra(List<PresaConf> note, String id, String ip) {
        for (PresaConf p : note) {
            if (p.id.equals(id) && !p.ip.equals(ip)) {
                return true;
            }
        }
        return false;
    }
}
