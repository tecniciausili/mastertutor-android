package it.tecniciausili.mastertutor;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // La presa Tapo comandata direttamente dal tablet (senza Azure né ponte)
        registerPlugin(PresaTapoPlugin.class);
        super.onCreate(savedInstanceState);
        // La WebView Android, di default, lascia partire da sola solo la riproduzione MUTA:
        // così i video YouTube partivano senza audio (l'unMute veniva ignorato). Con questo
        // permesso i video partono con l'audio, senza bisogno di toccare ogni volta lo schermo.
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
