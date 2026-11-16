package mx.legendofpresos.juego;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

/**
 * Legend of Presos en Android: el juego web corre en un WebView a pantalla completa y en horizontal.
 * Los archivos se sirven con WebViewAssetLoader (https://appassets.androidplatform.net/assets/...): así el juego puede
 * leer sus JSON con fetch() igual que en un servidor (con file:// no podría).
 * Puente JS "AndroidBridge": vibración (playHaptic) y RETO BLUETOOTH (bt*: ver BtLink).
 */
public class MainActivity extends Activity {
    private static final String START = "https://appassets.androidplatform.net/assets/game.html";
    private static final int REQ_BT = 41;
    private WebView web;
    private BtLink bt;
    private Runnable pendingBt;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        setContentView(web);
        immersive();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) { return serve(r.getUrl()); }
        });
        web.setWebChromeClient(new WebChromeClient());
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        bt = new BtLink(this, this::toJs);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        if (b != null) web.restoreState(b); else web.loadUrl(START);
    }

    // Archivos del juego desde los assets del APK con un origen https (equivale a WebViewAssetLoader, sin depender de
    // androidx.webkit): https://appassets.androidplatform.net/assets/<ruta> -> assets/<ruta>
    private static final HashMap<String, String> MIME = new HashMap<>();
    static {
        String[][] m = {{"html", "text/html"}, {"js", "application/javascript"}, {"css", "text/css"}, {"json", "application/json"},
            {"webmanifest", "application/manifest+json"}, {"png", "image/png"}, {"webp", "image/webp"}, {"jpg", "image/jpeg"},
            {"svg", "image/svg+xml"}, {"wav", "audio/wav"}, {"ogg", "audio/ogg"}, {"mp3", "audio/mpeg"}, {"woff", "font/woff"},
            {"woff2", "font/woff2"}, {"otf", "font/otf"}, {"ttf", "font/ttf"}, {"txt", "text/plain"}};
        for (String[] e : m) MIME.put(e[0], e[1]);
    }
    private WebResourceResponse serve(android.net.Uri u) {
        if (u == null || !"appassets.androidplatform.net".equals(u.getHost()) || u.getPath() == null || !u.getPath().startsWith("/assets/")) return null;
        String path = u.getPath().substring("/assets/".length());
        if (path.contains("..")) return null;
        String ext = path.lastIndexOf('.') >= 0 ? path.substring(path.lastIndexOf('.') + 1).toLowerCase() : "";
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        boolean text = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json");
        try {
            InputStream in = getAssets().open(path);
            WebResourceResponse r = new WebResourceResponse(mime, text ? "utf-8" : null, in);
            java.util.Map<String, String> h = new HashMap<>(); h.put("Access-Control-Allow-Origin", "*"); r.setResponseHeaders(h);
            return r;
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
    }

    /** Avisa al juego: window.PGNet._native(tipo, datos). Siempre desde el hilo de la interfaz. */
    void toJs(String type, String data) {
        final String js = "window.PGNet&&PGNet._native(" + JSONObject.quote(type) + "," + JSONObject.quote(data == null ? "{}" : data) + ")";
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    private void immersive() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }
    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); immersive(); }
    @Override protected void onDestroy() { if (bt != null) bt.close(); if (web != null) { web.destroy(); web = null; } super.onDestroy(); }

    /** Botón ATRÁS = tecla Esc del juego (pausa / volver). El juego decide; nunca cierra la app de golpe en pleno combate. */
    @Override public boolean onKeyDown(int code, KeyEvent e) {
        if (code == KeyEvent.KEYCODE_BACK) {
            web.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}))", null);
            return true;
        }
        return super.onKeyDown(code, e);
    }

    // ------------------------------------------------------------------ permisos de Bluetooth
    private String[] btPerms() {
        if (Build.VERSION.SDK_INT >= 31) return new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE};
        return new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
    }
    /** Ejecuta la acción si ya hay permisos; si no, los pide y la ejecuta al recibirlos. */
    private void withBt(Runnable r) {
        List<String> miss = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 23) for (String p : btPerms()) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) miss.add(p);
        if (miss.isEmpty()) { r.run(); return; }
        pendingBt = r;
        requestPermissions(miss.toArray(new String[0]), REQ_BT);
    }
    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        super.onRequestPermissionsResult(req, perms, res);
        if (req != REQ_BT) return;
        boolean ok = res.length > 0;
        for (int g : res) ok &= g == PackageManager.PERMISSION_GRANTED;
        Runnable r = pendingBt; pendingBt = null;
        if (ok && r != null) r.run();
        else toJs("error", "{\"message\":\"Sin permiso de Bluetooth (dispositivos cercanos). Actívalo en Ajustes › Apps › Legend of Presos › Permisos.\"}");
    }
    @Override protected void onActivityResult(int req, int res, android.content.Intent data) { super.onActivityResult(req, res, data); bt.onActivityResult(req, res); }

    // ------------------------------------------------------------------ puente JS
    private final class Bridge {
        @JavascriptInterface public void playHaptic(String type) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            long ms = "ko".equals(type) ? 120 : "super".equals(type) ? 70 : "heavy".equals(type) || "crush".equals(type) ? 40
                    : "block".equals(type) ? 14 : "button".equals(type) ? 8 : "light".equals(type) || "head".equals(type) || "counter".equals(type) ? 22 : 0;
            if (ms <= 0) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)); else v.vibrate(ms);
        }
        @JavascriptInterface public boolean btAvailable() { return bt.hasAdapter(); }
        @JavascriptInterface public void btHost() { runOnUiThread(() -> withBt(bt::host)); }
        @JavascriptInterface public void btScan() { runOnUiThread(() -> withBt(bt::scan)); }
        @JavascriptInterface public void btConnect(String addr) { runOnUiThread(() -> withBt(() -> bt.connect(addr))); }
        @JavascriptInterface public void btSend(String line) { bt.send(line); }
        @JavascriptInterface public void btClose() { bt.close(); }
    }
}
