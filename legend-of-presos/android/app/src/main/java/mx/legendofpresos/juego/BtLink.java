package mx.legendofpresos.juego;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * RETO BLUETOOTH: Bluetooth clásico (RFCOMM) entre dos teléfonos con el juego.
 *  - host(): se hace visible ~2 min y espera una conexión (sockets seguro e "inseguro" a la vez: el primero que llega gana;
 *    el inseguro evita pedir vinculación en la mayoría de los teléfonos).
 *  - scan(): manda primero los teléfonos ya vinculados y luego busca los cercanos.
 *  - connect(dir): se conecta a la sala de ese teléfono.
 *  - send(línea) / mensajes recibidos: una línea JSON por mensaje (el protocolo vive en engine/pg_net.js).
 * Avisos al juego (Sink): hosting, device, scanDone, connected, line, closed, error.
 */
@SuppressLint("MissingPermission")   // MainActivity pide los permisos antes de llamar a cualquier método de aquí
final class BtLink {
    interface Sink { void emit(String type, String data); }

    static final UUID ID = UUID.fromString("5c6f2b1e-7a4d-4c1e-9f3a-2d8b6e0a1c42");   // servicio del juego (fijo)
    private static final String NAME = "LegendOfPresos";
    static final int REQ_ENABLE = 51, REQ_VISIBLE = 52;

    private final Activity act;
    private final Sink sink;
    private final BluetoothAdapter adapter;
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private BluetoothServerSocket srvA, srvB;
    private BluetoothSocket sock;
    private OutputStream out;
    private BroadcastReceiver finder;
    private Runnable afterEnable;
    private volatile int gen = 0;   // cada sesión nueva invalida los hilos de la anterior

    BtLink(Activity a, Sink s) {
        act = a; sink = s;
        BluetoothManager m = (BluetoothManager) a.getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = m != null ? m.getAdapter() : null;
    }
    boolean hasAdapter() { return adapter != null; }

    private static String json(Object... kv) {
        JSONObject o = new JSONObject();
        try { for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]); } catch (Exception ignored) { }
        return o.toString();
    }
    private void error(String msg) { sink.emit("error", json("message", msg)); }

    /** Bluetooth apagado: se pide encenderlo y la acción sigue al volver. */
    private boolean ready(Runnable again) {
        if (adapter == null) { error("Este teléfono no tiene Bluetooth."); return false; }
        if (!adapter.isEnabled()) { afterEnable = again; act.startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQ_ENABLE); return false; }
        return true;
    }
    void onActivityResult(int req, int res) {
        if (req == REQ_ENABLE) { Runnable r = afterEnable; afterEnable = null; if (adapter != null && adapter.isEnabled() && r != null) r.run(); else if (r != null) error("Hay que encender el Bluetooth."); }
    }

    // ------------------------------------------------------------------ anfitrión
    void host() {
        if (!ready(this::host)) return;
        close(false);
        final int g = ++gen;
        try {
            srvA = adapter.listenUsingInsecureRfcommWithServiceRecord(NAME, ID);
            try { srvB = adapter.listenUsingRfcommWithServiceRecord(NAME + "S", ID); } catch (IOException e) { srvB = null; }
        } catch (IOException e) { error("No se pudo abrir la sala: " + e.getMessage()); return; }
        Intent vis = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE).putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 120);
        try { act.startActivityForResult(vis, REQ_VISIBLE); } catch (Exception ignored) { }
        sink.emit("hosting", json("name", adapter.getName()));
        for (final BluetoothServerSocket srv : new BluetoothServerSocket[]{srvA, srvB}) {
            if (srv == null) continue;
            new Thread(() -> {
                try { BluetoothSocket s = srv.accept(); if (g == gen && sock == null) attach(s, true, g); else s.close(); }
                catch (IOException e) { /* cerrado por close() o por el otro socket que ganó */ }
            }, "bt-accept").start();
        }
    }

    // ------------------------------------------------------------------ invitado
    void scan() {
        if (!ready(this::scan)) return;
        stopFinder();
        for (BluetoothDevice d : adapter.getBondedDevices()) sink.emit("device", json("name", d.getName(), "address", d.getAddress(), "bonded", true));
        finder = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                if (BluetoothDevice.ACTION_FOUND.equals(i.getAction())) {
                    BluetoothDevice d = i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (d != null) sink.emit("device", json("name", d.getName() == null ? "" : d.getName(), "address", d.getAddress(), "bonded", d.getBondState() == BluetoothDevice.BOND_BONDED));
                } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(i.getAction())) { sink.emit("scanDone", "{}"); }
            }
        };
        IntentFilter f = new IntentFilter(BluetoothDevice.ACTION_FOUND); f.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        act.registerReceiver(finder, f);
        if (adapter.isDiscovering()) adapter.cancelDiscovery();
        if (!adapter.startDiscovery()) { error("No se pudo buscar dispositivos (¿ubicación o permisos apagados?)."); }
    }
    private void stopFinder() {
        if (finder != null) { try { act.unregisterReceiver(finder); } catch (Exception ignored) { } finder = null; }
        if (adapter != null && adapter.isDiscovering()) adapter.cancelDiscovery();
    }

    void connect(final String address) {
        if (!ready(() -> connect(address))) return;
        stopFinder();
        close(false);
        final int g = ++gen;
        final BluetoothDevice dev;
        try { dev = adapter.getRemoteDevice(address); } catch (IllegalArgumentException e) { error("Dirección inválida."); return; }
        new Thread(() -> {
            IOException last = null;
            for (int k = 0; k < 2 && g == gen; k++) {   // primero sin vinculación; si el teléfono no lo permite, con vinculación
                BluetoothSocket s = null;
                try {
                    s = k == 0 ? dev.createInsecureRfcommSocketToServiceRecord(ID) : dev.createRfcommSocketToServiceRecord(ID);
                    s.connect();
                    if (g == gen) { attach(s, false, g); return; }
                    s.close(); return;
                } catch (IOException e) { last = e; if (s != null) try { s.close(); } catch (IOException ignored) { } }
            }
            if (g == gen) error("No se pudo conectar" + (last != null ? " (" + last.getMessage() + ")" : "") + ". ¿Tu amigo creó la sala?");
        }, "bt-connect").start();
    }

    // ------------------------------------------------------------------ conexión abierta
    private void attach(BluetoothSocket s, boolean host, final int g) throws IOException {
        sock = s; out = s.getOutputStream();
        closeServers();
        String name = s.getRemoteDevice() != null ? s.getRemoteDevice().getName() : "rival";
        sink.emit("connected", json("name", name == null ? "rival" : name, "host", host));
        final BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
        new Thread(() -> {
            try { String line; while (g == gen && (line = in.readLine()) != null) sink.emit("line", line); }
            catch (IOException ignored) { }
            if (g == gen) { close(false); sink.emit("closed", "{}"); }
        }, "bt-read").start();
    }

    void send(final String line) {
        final OutputStream o = out; if (o == null || line == null) return;
        writer.execute(() -> {
            try { o.write((line.replace('\n', ' ') + "\n").getBytes(StandardCharsets.UTF_8)); o.flush(); }
            catch (IOException e) { if (o == out) { close(false); sink.emit("closed", "{}"); } }
        });
    }

    private void closeServers() {
        try { if (srvA != null) srvA.close(); } catch (IOException ignored) { }
        try { if (srvB != null) srvB.close(); } catch (IOException ignored) { }
        srvA = srvB = null;
    }
    void close() { close(true); }
    private synchronized void close(boolean notify) {
        boolean had = sock != null || srvA != null || srvB != null;
        gen++;
        stopFinder();
        closeServers();
        try { if (sock != null) sock.close(); } catch (IOException ignored) { }
        sock = null; out = null;
        if (notify && had) sink.emit("closed", "{}");
    }
}
