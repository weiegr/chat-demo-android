package xyz.app566512.apidemo;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class ApiKeyStorage {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "api-demo-api-key-v1";
    private static final String CIPHER = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final ExecutorService STORAGE = Executors.newSingleThreadExecutor();

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final AtomicFile file;

    ApiKeyStorage(File noBackupDir) {
        file = new AtomicFile(new File(noBackupDir, "api-key-v1"));
    }

    void connect(WebView view, Uri origin, String requestId) {
        WebMessagePort[] ports = view.createWebMessageChannel();
        Runnable close = ports[0]::close;
        ui.postDelayed(close, 10_000);
        ports[0].setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override
            public void onMessage(WebMessagePort port, WebMessage message) {
                ui.removeCallbacks(close);
                STORAGE.execute(() -> {
                    String response = handleRequest(message.getData());
                    ui.post(() -> {
                        try {
                            port.postMessage(new WebMessage(response));
                        } catch (IllegalStateException ignored) {
                            // The page may have closed while storage was busy.
                        } finally {
                            port.close();
                        }
                    });
                });
            }
        });
        // The native interface delivers only a port to the app's top-level origin.
        view.postWebMessage(new WebMessage("chat-demo:api-key-storage:" + requestId,
                new WebMessagePort[]{ports[1]}), origin);
    }

    private String handleRequest(String payload) {
        try {
            JSONObject request = new JSONObject(payload);
            String apiKey = request.isNull("apiKey") ? null : request.getString("apiKey");
            switch (request.getString("operation")) {
                case "load":
                    return new JSONObject().put("ok", true)
                            .put("apiKey", JSONObject.wrap(loadOrMigrate(apiKey))).toString();
                case "save":
                    save(apiKey);
                    return "{\"ok\":true,\"apiKey\":null}";
                default:
                    return "{\"ok\":false}";
            }
        } catch (Exception ignored) {
            // Report a storage failure without copying credentials or exception details into logs.
            return "{\"ok\":false}";
        }
    }

    private String loadOrMigrate(String legacyKey) throws IOException, GeneralSecurityException {
        byte[] record;
        try {
            record = file.readFully();
        } catch (FileNotFoundException missing) {
            if (file.getBaseFile().exists()) {
                throw missing;
            }
            if (legacyKey != null) {
                save(legacyKey);
            }
            return legacyKey;
        }
        // An empty record marks an explicit clear, even if a stale legacy entry is still present.
        if (record.length == 0) {
            return null;
        }
        if (record.length <= IV_BYTES + TAG_BITS / 8) {
            throw new IOException("Invalid API key record");
        }
        SecretKey key = (SecretKey) openKeyStore().getKey(ALIAS, null);
        if (key == null) {
            throw new GeneralSecurityException("API key encryption key is unavailable");
        }
        Cipher cipher = Cipher.getInstance(CIPHER);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, record, 0, IV_BYTES));
        return new String(cipher.doFinal(record, IV_BYTES, record.length - IV_BYTES),
                StandardCharsets.UTF_8);
    }

    private void save(String apiKey) throws IOException, GeneralSecurityException {
        byte[] record = apiKey == null ? new byte[0] : encrypt(apiKey);
        FileOutputStream stream = file.startWrite();
        try {
            stream.write(record);
            stream.getFD().sync();
        } catch (IOException failure) {
            file.failWrite(stream);
            throw failure;
        }
        file.finishWrite(stream);
        if (!Arrays.equals(record, file.readFully())) {
            throw new IOException("API key write did not complete");
        }
    }

    private byte[] encrypt(String apiKey) throws IOException, GeneralSecurityException {
        KeyStore store = openKeyStore();
        SecretKey key = (SecretKey) store.getKey(ALIAS, null);
        Cipher cipher = Cipher.getInstance(CIPHER);
        try {
            cipher.init(Cipher.ENCRYPT_MODE, key == null ? generateKey() : key);
        } catch (KeyPermanentlyInvalidatedException invalidated) {
            store.deleteEntry(ALIAS);
            cipher.init(Cipher.ENCRYPT_MODE, generateKey());
        }
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(apiKey.getBytes(StandardCharsets.UTF_8));
        byte[] record = Arrays.copyOf(iv, iv.length + ciphertext.length);
        System.arraycopy(ciphertext, 0, record, iv.length, ciphertext.length);
        return record;
    }

    private static KeyStore openKeyStore() throws IOException, GeneralSecurityException {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        return store;
    }

    private static SecretKey generateKey() throws GeneralSecurityException {
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }
}
