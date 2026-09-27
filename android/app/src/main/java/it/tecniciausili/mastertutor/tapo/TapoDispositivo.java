package it.tecniciausili.mastertutor.tapo;

import org.json.JSONObject;

/** Una presa Tapo raggiunta con uno dei due protocolli (KLAP o AES). */
interface TapoDispositivo {

    /** Risposta di get_device_info (campo "result" con device_on, nickname, model...). */
    JSONObject info() throws Exception;

    /** Accende (true) o spegne (false). */
    void imposta(boolean acceso) throws Exception;
}
