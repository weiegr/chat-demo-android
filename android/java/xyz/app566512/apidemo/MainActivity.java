package xyz.app566512.apidemo;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.util.Size;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsAnimation;
import android.view.WindowInsetsController;
import android.view.inputmethod.InputMethodManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_ORIGIN = "https://" + APP_HOST;
    private static final String MEDIA_PREFIX = "/__android_media__/";
    private static final String PROXY_PATH = "/__android_proxy__";
    private static final String PREF_IME_LAYOUT = "ime_layout_prefs";
    private static final String KEY_LAST_IME_RAISE_CSS = "last_ime_raise_css";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_AUDIO_PERMISSION = 1002;
    private static final int REQ_GALLERY_PERMISSION = 1003;
    private static final int REQ_LOCATION_PERMISSION = 1004;
    private static final int REQ_GEOLOCATION_PROMPT = 1005;

    private final ExecutorService mediaExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, Uri> recentMediaUris = new ConcurrentHashMap<>();
    private final VideoAudio videoAudio = new VideoAudio();

    private FrameLayout rootContainer;
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingPermissionRequest;
    private GeolocationPermissions.Callback pendingGeolocationCallback;
    private String pendingGeolocationOrigin;
    private Integer pendingLocationRequestId;
    private Runnable cancelActiveLocation;
    private long lastLocationPermissionRequestAt = 0L;
    private boolean lastLocationPermissionHadCoarse = false;
    private Uri pendingCameraUri;
    private volatile String nextPickerMode = "file";
    private volatile String nextVideoAudioSelection;
    private String pendingVideoAudioSelection;
    private volatile String cachedUserAgent = "Mozilla/5.0";
    private int safeTopCss = 24;
    private int safeBottomCss = 0;
    private int imePaddingPx = 0;
    private int lastNavBottomPx = 0;
    private volatile int lastKnownImeRaiseCss = 0;
    private boolean imeAnimating = false;
    private boolean isImeVisible = false;
    private boolean wasImeVisibleBeforeAnim = false;
    private boolean lastSyncedImeOpen = false;
    private WindowInsets pendingNonAnimInsets = null;
    private final Runnable applyPendingNonAnimInsets = () -> {
        WindowInsets pending = pendingNonAnimInsets;
        pendingNonAnimInsets = null;
        if (!imeAnimating && pending != null) {
            applyWindowInsetsNow(pending, false);
        }
    };
    private final Runnable imeAnimWatchdog = () -> {
        imeAnimating = false;
        if (rootContainer != null) {
            WindowInsets rootInsets = rootContainer.getRootWindowInsets();
            if (rootInsets != null) {
                applyWindowInsetsNow(rootInsets, false);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        lastKnownImeRaiseCss = getSharedPreferences(PREF_IME_LAYOUT, MODE_PRIVATE)
                .getInt(KEY_LAST_IME_RAISE_CSS, 0);

        boolean isDark = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int bgColor = isDark ? Color.BLACK : Color.WHITE;

        rootContainer = new FrameLayout(this);
        rootContainer.setBackgroundColor(bgColor);
        webView = new WebView(this);
        webView.setBackgroundColor(bgColor);
        rootContainer.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(rootContainer);
        setupEdgeToEdge();
        applySystemBarsTheme(isDark);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportMultipleWindows(true);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        cachedUserAgent = settings.getUserAgentString();

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidHost");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost())) {
                    String path = uri.getPath();
                    if (PROXY_PATH.equals(path)) {
                        return proxyExternalGet(request, uri);
                    }
                    if (path != null && path.startsWith(MEDIA_PREFIX)) {
                        return serveMediaUri(path.substring(MEDIA_PREFIX.length()));
                    }
                    if (path != null && path.startsWith(VideoAudio.PATH_PREFIX)) {
                        if (request.isForMainFrame() || !"GET".equals(request.getMethod())) {
                            return notFoundResponse();
                        }
                        return videoAudio.serve(
                                getContentResolver(), path.substring(VideoAudio.PATH_PREFIX.length()));
                    }
                    if (path == null || path.isEmpty() || "/".equals(path)) {
                        path = "/index.html";
                    }
                    String assetPath = "web" + path;
                    try {
                        InputStream stream = getAssets().open(assetPath);
                        String mimeType = guessMimeType(path);
                        String encoding = mimeType.startsWith("text/") || mimeType.contains("javascript") || mimeType.contains("json")
                                ? "UTF-8"
                                : null;
                        WebResourceResponse response = new WebResourceResponse(mimeType, encoding, stream);
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Access-Control-Allow-Origin", APP_ORIGIN);
                        headers.put("Cache-Control", "no-cache");
                        response.setResponseHeaders(headers);
                        return response;
                    } catch (IOException e) {
                        return notFoundResponse();
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) {
                    return false;
                }
                if ("https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost())) {
                    return false;
                }
                openExternalUri(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectThemeAndDownloadHooks();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            } else {
                                pendingPermissionRequest = request;
                                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO_PERMISSION);
                            }
                            return;
                        }
                    }
                    request.deny();
                });
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                cancelFileCallback();
                MainActivity.this.filePathCallback = filePathCallback;

                String mode = nextPickerMode;
                nextPickerMode = "file";
                String selection = nextVideoAudioSelection;
                nextVideoAudioSelection = null;
                if ("video".equals(mode)) {
                    pendingVideoAudioSelection = selection;
                } else {
                    videoAudio.releaseSelection(selection);
                }
                if ("file".equals(mode) && fileChooserParams != null && fileChooserParams.isCaptureEnabled()) {
                    mode = "camera";
                }

                if ("camera".equals(mode)) {
                    return launchCameraChooser();
                }
                if ("gallery".equals(mode)) {
                    return launchGalleryChooser(fileChooserParams);
                }
                if ("video".equals(mode)) {
                    return launchVideoChooser();
                }
                return launchGenericFileChooser(fileChooserParams);
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView.HitTestResult result = view.getHitTestResult();
                String data = result != null ? result.getExtra() : null;
                if (data != null && !data.startsWith("blob:")) {
                    openExternalUri(Uri.parse(data));
                    return false;
                }
                WebView tempView = new WebView(MainActivity.this);
                tempView.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        Uri u = req.getUrl();
                        if (u != null && !"blob".equals(u.getScheme())) {
                            openExternalUri(u);
                        }
                        v.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(tempView);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(final String origin, final GeolocationPermissions.Callback callback) {
                runOnUiThread(() -> {
                    if (origin == null || !origin.startsWith(APP_ORIGIN)) {
                        callback.invoke(origin, false, false);
                        return;
                    }
                    if (checkLocationPermission()) {
                        callback.invoke(origin, true, false);
                        return;
                    }
                    pendingGeolocationCallback = callback;
                    pendingGeolocationOrigin = origin;
                    requestPermissions(
                            new String[]{
                                    Manifest.permission.ACCESS_FINE_LOCATION,
                                    Manifest.permission.ACCESS_COARSE_LOCATION
                            },
                            REQ_GEOLOCATION_PROMPT
                    );
                });
            }
        });

        webView.loadUrl(APP_ORIGIN + "/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 从系统设置修改权限切回应用时，主动同步最新定位授权级别给设置页
        if (webView != null) {
            dispatchLocationPermissionState(false);
        }
    }

    @Override
    protected void onDestroy() {
        if (cancelActiveLocation != null) {
            cancelActiveLocation.run();
            cancelActiveLocation = null;
        }
        mainHandler.removeCallbacksAndMessages(null);
        videoAudio.clear();
        mediaExecutor.shutdownNow();
        super.onDestroy();
    }

    private WebResourceResponse errorTextResponse(int statusCode, String reason, String body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", APP_ORIGIN);
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(
                "text/plain",
                "UTF-8",
                statusCode,
                reason,
                headers,
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8))
        );
    }

    private WebResourceResponse proxyExternalGet(WebResourceRequest request, Uri requestUri) {
        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            return errorTextResponse(405, "Method Not Allowed", "Method Not Allowed");
        }
        String rawUrl = requestUri.getQueryParameter("url");
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            return errorTextResponse(400, "Bad Request", "Missing url");
        }
        HttpURLConnection conn = null;
        try {
            URL currentUrl = new URL(rawUrl.trim());
            for (int redirects = 0; redirects < 6; redirects++) {
                String scheme = currentUrl.getProtocol().toLowerCase(Locale.US);
                if (!"http".equals(scheme) && !"https".equals(scheme)) {
                    return errorTextResponse(400, "Bad Request", "Unsupported URL scheme");
                }
                if (APP_HOST.equalsIgnoreCase(currentUrl.getHost())) {
                    return errorTextResponse(400, "Bad Request", "Invalid target host");
                }
                conn = (HttpURLConnection) currentUrl.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("User-Agent", cachedUserAgent);
                int status = conn.getResponseCode();
                if (status == HttpURLConnection.HTTP_MOVED_PERM
                        || status == HttpURLConnection.HTTP_MOVED_TEMP
                        || status == HttpURLConnection.HTTP_SEE_OTHER
                        || status == 307
                        || status == 308) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null || location.isEmpty()) {
                        return errorTextResponse(502, "Bad Gateway", "Redirect missing Location");
                    }
                    currentUrl = new URL(currentUrl, location);
                    continue;
                }

                String reason = conn.getResponseMessage();
                if (reason == null || reason.trim().isEmpty()) {
                    reason = status >= 400 ? "Error" : "OK";
                } else {
                    reason = reason.replace('\r', ' ').replace('\n', ' ').trim();
                }

                String rawContentType = conn.getContentType();
                String mimeType = "application/octet-stream";
                String encoding = null;
                if (rawContentType != null && !rawContentType.trim().isEmpty()) {
                    String[] parts = rawContentType.split(";");
                    if (parts[0] != null && !parts[0].trim().isEmpty()) {
                        mimeType = parts[0].trim();
                    }
                    for (int i = 1; i < parts.length; i++) {
                        String part = parts[i].trim();
                        if (part.toLowerCase(Locale.US).startsWith("charset=")) {
                            encoding = part.substring(8).trim().replace("\"", "");
                            break;
                        }
                    }
                }

                InputStream rawStream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", APP_ORIGIN);
                headers.put("Cache-Control", "no-store");
                long contentLength = conn.getContentLengthLong();
                if (contentLength >= 0) {
                    headers.put("Content-Length", String.valueOf(contentLength));
                }

                if (rawStream == null) {
                    conn.disconnect();
                    return new WebResourceResponse(
                            mimeType,
                            encoding,
                            status,
                            reason,
                            headers,
                            new ByteArrayInputStream(new byte[0])
                    );
                }

                final HttpURLConnection activeConn = conn;
                InputStream wrappedStream = new FilterInputStream(rawStream) {
                    @Override
                    public void close() throws IOException {
                        try {
                            super.close();
                        } finally {
                            activeConn.disconnect();
                        }
                    }
                };
                return new WebResourceResponse(mimeType, encoding, status, reason, headers, wrappedStream);
            }
            return errorTextResponse(502, "Bad Gateway", "Too many redirects");
        } catch (Exception e) {
            if (conn != null) {
                conn.disconnect();
            }
            Log.w("ApiDemoProxy", "Proxy GET failed", e);
            String msg = e.getMessage() != null ? e.getMessage() : "Download failed";
            return errorTextResponse(502, "Bad Gateway", msg);
        }
    }

    private WebResourceResponse notFoundResponse() {
        return new WebResourceResponse(
                "text/plain",
                "UTF-8",
                404,
                "Not Found",
                null,
                new ByteArrayInputStream("Not Found".getBytes(StandardCharsets.UTF_8))
        );
    }

    private WebResourceResponse serveMediaUri(String id) {
        Uri mediaUri = recentMediaUris.get(id);
        if (mediaUri == null) {
            return notFoundResponse();
        }
        try {
            InputStream stream = getContentResolver().openInputStream(mediaUri);
            if (stream == null) {
                return notFoundResponse();
            }
            String mimeType = getContentResolver().getType(mediaUri);
            if (mimeType == null || mimeType.isEmpty()) {
                mimeType = "image/jpeg";
            }
            WebResourceResponse response = new WebResourceResponse(mimeType, null, stream);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", APP_ORIGIN);
            headers.put("Cache-Control", "no-store");
            response.setResponseHeaders(headers);
            return response;
        } catch (Exception e) {
            return notFoundResponse();
        }
    }

    private boolean launchCameraChooser() {
        clearPendingCameraUri();
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "IMG_" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES);
            }
            Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                cancelFileCallback();
                return false;
            }
            pendingCameraUri = uri;
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(intent, REQ_FILE_CHOOSER);
            return true;
        } catch (Exception e) {
            clearPendingCameraUri();
            cancelFileCallback();
            Toast.makeText(this, "无法打开相机", Toast.LENGTH_SHORT).show();
            return false;
        }
    }

    private boolean launchGalleryChooser(WebChromeClient.FileChooserParams params) {
        boolean allowMultiple = params == null || params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                Intent intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
                intent.setType("image/*");
                if (allowMultiple) {
                    intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 9);
                }
                startActivityForResult(intent, REQ_FILE_CHOOSER);
                return true;
            } catch (Exception ignored) {
            }
        }
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        if (allowMultiple) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            startActivityForResult(Intent.createChooser(intent, null), REQ_FILE_CHOOSER);
            return true;
        } catch (Exception e) {
            cancelFileCallback();
            return false;
        }
    }

    private boolean launchVideoChooser() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                Intent intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
                intent.setType("video/*");
                startActivityForResult(intent, REQ_FILE_CHOOSER);
                return true;
            } catch (ActivityNotFoundException ignored) {
            }
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video/*");
        try {
            startActivityForResult(intent, REQ_FILE_CHOOSER);
        } catch (ActivityNotFoundException ignored) {
            cancelFileCallback();
        }
        return true;
    }

    private boolean launchGenericFileChooser(WebChromeClient.FileChooserParams params) {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        if (params != null && params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            startActivityForResult(Intent.createChooser(intent, null), REQ_FILE_CHOOSER);
            return true;
        } catch (Exception e) {
            cancelFileCallback();
            return false;
        }
    }

    private void cancelFileCallback() {
        videoAudio.releaseSelection(pendingVideoAudioSelection);
        pendingVideoAudioSelection = null;
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
    }

    private void clearPendingCameraUri() {
        if (pendingCameraUri != null) {
            try {
                getContentResolver().delete(pendingCameraUri, null, null);
            } catch (Exception ignored) {
            }
            pendingCameraUri = null;
        }
    }

    private boolean checkGalleryPermission() {
        if (Build.VERSION.SDK_INT >= 34) {
            return checkSelfPermission("android.permission.READ_MEDIA_IMAGES") == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission("android.permission.READ_MEDIA_VISUAL_USER_SELECTED") == PackageManager.PERMISSION_GRANTED;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return checkSelfPermission("android.permission.READ_MEDIA_IMAGES") == PackageManager.PERMISSION_GRANTED;
        }
        return checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void loadRecentPhotosAsync(final int limit) {
        if (!checkGalleryPermission()) {
            return;
        }
        mediaExecutor.execute(() -> {
            JSONArray array = new JSONArray();
            String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.MIME_TYPE,
                    MediaStore.Images.Media.SIZE
            };
            String sortOrder = MediaStore.Images.Media.DATE_ADDED + " DESC";
            try (Cursor cursor = getContentResolver().query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    null,
                    null,
                    sortOrder
            )) {
                if (cursor != null) {
                    int idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                    int nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
                    int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE);
                    int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE);
                    while (cursor.moveToNext() && array.length() < limit) {
                        long id = cursor.getLong(idCol);
                        long size = cursor.getLong(sizeCol);
                        if (size <= 0) {
                            continue;
                        }
                        String idStr = String.valueOf(id);
                        Uri contentUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
                        String thumb = loadThumbnailDataUrl(contentUri, id);
                        if (thumb == null) {
                            continue;
                        }
                        recentMediaUris.put(idStr, contentUri);
                        String name = cursor.getString(nameCol);
                        if (name == null || name.isEmpty()) {
                            name = "image_" + idStr + ".jpg";
                        }
                        String mimeType = cursor.getString(mimeCol);
                        if (mimeType == null || mimeType.isEmpty()) {
                            mimeType = "image/jpeg";
                        }
                        JSONObject item = new JSONObject();
                        item.put("id", idStr);
                        item.put("name", name);
                        item.put("mimeType", mimeType);
                        item.put("url", APP_ORIGIN + MEDIA_PREFIX + idStr);
                        item.put("thumb", thumb);
                        array.put(item);
                    }
                }
            } catch (Exception ignored) {
            }
            final String payload = array.toString();
            runOnUiThread(() -> {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('android-recent-photos',{detail:" + payload + "}));",
                            null
                    );
                }
            });
        });
    }

    @SuppressWarnings("deprecation")
    private String loadThumbnailDataUrl(Uri uri, long id) {
        Bitmap bitmap = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                bitmap = getContentResolver().loadThumbnail(uri, new Size(200, 200), null);
            } else {
                bitmap = MediaStore.Images.Thumbnails.getThumbnail(
                        getContentResolver(),
                        id,
                        MediaStore.Images.Thumbnails.MINI_KIND,
                        null
                );
            }
            if (bitmap == null) {
                return null;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 75, out);
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception ignored) {
            return null;
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) {
                bitmap.recycle();
            }
        }
    }

    private void setupEdgeToEdge() {
        Window window = getWindow();
        View decor = window.getDecorView();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
        } else {
            int flags = decor.getSystemUiVisibility()
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            decor.setSystemUiVisibility(flags);
        }
        rootContainer.setOnApplyWindowInsetsListener((v, insets) -> {
            if (imeAnimating) {
                syncTopSafeAreaFromInsets(insets);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    && (extractImeBottomPx(insets) > extractNavBottomPx(insets)) != isImeVisible) {
                // 延迟 1 帧确认是否进入 WindowInsetsAnimation，避免个别 ROM 在 onPrepare 前先闪一帧终值高度。
                syncTopSafeAreaFromInsets(insets);
                pendingNonAnimInsets = insets;
                rootContainer.removeCallbacks(applyPendingNonAnimInsets);
                rootContainer.postOnAnimation(applyPendingNonAnimInsets);
            } else {
                pendingNonAnimInsets = null;
                rootContainer.removeCallbacks(applyPendingNonAnimInsets);
                applyWindowInsetsNow(insets, false);
            }
            return consumeBottomInsets(insets, imePaddingPx);
        });

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            final Set<WindowInsetsAnimation> activeImeAnims = new HashSet<>();
            rootContainer.setWindowInsetsAnimationCallback(new WindowInsetsAnimation.Callback(
                    WindowInsetsAnimation.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                @Override
                public void onPrepare(WindowInsetsAnimation animation) {
                    if ((animation.getTypeMask() & WindowInsets.Type.ime()) == 0) {
                        return;
                    }
                    pendingNonAnimInsets = null;
                    rootContainer.removeCallbacks(applyPendingNonAnimInsets);
                    if (activeImeAnims.isEmpty()) {
                        wasImeVisibleBeforeAnim = isImeVisible;
                    }
                    activeImeAnims.add(animation);
                    imeAnimating = true;
                    mainHandler.removeCallbacks(imeAnimWatchdog);
                    mainHandler.postDelayed(imeAnimWatchdog, 600L);
                }

                @Override
                public WindowInsetsAnimation.Bounds onStart(
                        WindowInsetsAnimation animation, WindowInsetsAnimation.Bounds bounds) {
                    if ((animation.getTypeMask() & WindowInsets.Type.ime()) != 0) {
                        if (!wasImeVisibleBeforeAnim) {
                            float density = getResources().getDisplayMetrics().density;
                            if (density <= 0f) {
                                density = 1f;
                            }
                            int targetRaisePx = Math.max(0, bounds.getUpperBound().bottom - lastNavBottomPx);
                            int targetRaiseCss = Math.round(targetRaisePx / density);
                            if (targetRaiseCss > 80) {
                                rememberKeyboardRaiseCss(targetRaiseCss);
                            }
                            long rawDuration = animation.getDurationMillis();
                            long duration = rawDuration > 0 ? Math.max(180L, Math.min(360L, rawDuration)) : 220L;
                            dispatchImeStart(duration, targetRaiseCss);
                        } else {
                            // 键盘开始收起瞬间即恢复底距状态，避免落底后滞后弹一下。
                            syncImeOpenAttr(false, false);
                        }
                    }
                    return bounds;
                }

                @Override
                public WindowInsets onProgress(WindowInsets insets, List<WindowInsetsAnimation> runningAnimations) {
                    boolean hasImeAnim = false;
                    for (WindowInsetsAnimation anim : runningAnimations) {
                        if ((anim.getTypeMask() & WindowInsets.Type.ime()) != 0) {
                            hasImeAnim = true;
                            break;
                        }
                    }
                    if (hasImeAnim) {
                        applyWindowInsetsNow(insets, true);
                    }
                    return consumeBottomInsets(insets, imePaddingPx);
                }

                @Override
                public void onEnd(WindowInsetsAnimation animation) {
                    if ((animation.getTypeMask() & WindowInsets.Type.ime()) == 0) {
                        return;
                    }
                    activeImeAnims.remove(animation);
                    if (!activeImeAnims.isEmpty()) {
                        return;
                    }
                    mainHandler.removeCallbacks(imeAnimWatchdog);
                    imeAnimating = false;
                    WindowInsets rootInsets = rootContainer.getRootWindowInsets();
                    if (rootInsets != null) {
                        applyWindowInsetsNow(rootInsets, true);
                    }
                    syncImeOpenAttr(isImeVisible, false);
                    if (wasImeVisibleBeforeAnim && !isImeVisible) {
                        dispatchImeHidden();
                    } else if (!wasImeVisibleBeforeAnim && isImeVisible) {
                        dispatchImeShown();
                    }
                }
            });
        }
        rootContainer.requestApplyInsets();
    }

    private void rememberKeyboardRaiseCss(int raiseCss) {
        if (raiseCss <= 80 || raiseCss == lastKnownImeRaiseCss) {
            return;
        }
        lastKnownImeRaiseCss = raiseCss;
        SharedPreferences prefs = getSharedPreferences(PREF_IME_LAYOUT, MODE_PRIVATE);
        prefs.edit().putInt(KEY_LAST_IME_RAISE_CSS, raiseCss).apply();
    }

    @SuppressWarnings("deprecation")
    private int extractStatusTopPx(WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return insets.getInsets(WindowInsets.Type.statusBars()).top;
        }
        return insets.getSystemWindowInsetTop();
    }

    @SuppressWarnings("deprecation")
    private int extractNavBottomPx(WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
        }
        return Math.min(insets.getSystemWindowInsetBottom(), insets.getStableInsetBottom());
    }

    @SuppressWarnings("deprecation")
    private int extractImeBottomPx(WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return insets.getInsets(WindowInsets.Type.ime()).bottom;
        }
        int sysBottom = insets.getSystemWindowInsetBottom();
        int stableBottom = insets.getStableInsetBottom();
        return sysBottom > stableBottom ? sysBottom : 0;
    }

    private void syncTopSafeAreaFromInsets(WindowInsets insets) {
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) {
            density = 1f;
        }
        int nextSafeTop = Math.round(extractStatusTopPx(insets) / density);
        if (nextSafeTop != safeTopCss) {
            safeTopCss = nextSafeTop;
            syncSafeAreaToWeb();
        }
    }

    private void applyWindowInsetsNow(WindowInsets insets, boolean fromAnimation) {
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) {
            density = 1f;
        }
        int topPx = extractStatusTopPx(insets);
        int navBottomPx = extractNavBottomPx(insets);
        int imeBottomPx = extractImeBottomPx(insets);
        lastNavBottomPx = navBottomPx;

        boolean prevVisible = isImeVisible;
        isImeVisible = imeBottomPx > navBottomPx;
        // 原生容器始终以 max(navBottomPx, imeBottomPx) 托底，Web 侧 --safe-bottom 恒定为 0px；
        // 键盘收起落到导航栏上沿即自然停住，彻底消除原生归零与 JS 恢复安全区异步错帧导致的回弹。
        int nextBottomPadding = Math.max(Math.max(0, navBottomPx), Math.max(0, imeBottomPx));
        int nextSafeTop = Math.round(topPx / density);
        int nextSafeBottom = 0;
        boolean safeChanged = nextSafeTop != safeTopCss || nextSafeBottom != safeBottomCss;
        safeTopCss = nextSafeTop;
        safeBottomCss = nextSafeBottom;

        if (isImeVisible && !imeAnimating) {
            int raiseCss = Math.round((imeBottomPx - navBottomPx) / density);
            if (raiseCss > 80) {
                rememberKeyboardRaiseCss(raiseCss);
            }
        }

        if (rootContainer != null && imePaddingPx != nextBottomPadding) {
            imePaddingPx = nextBottomPadding;
            rootContainer.setPadding(0, 0, 0, imePaddingPx);
        }
        if (safeChanged && webView != null) {
            syncSafeAreaToWeb();
        }
        if (!imeAnimating) {
            syncImeOpenAttr(isImeVisible, false);
        } else if (!wasImeVisibleBeforeAnim && imeBottomPx > navBottomPx + Math.round(16f * density)) {
            // 待键盘实际抬升超过 16dp 后再同步收窄底距，确保不出现第 0 帧向下跳 6~8dp。
            syncImeOpenAttr(true, false);
        }
        if (!fromAnimation) {
            if (!prevVisible && isImeVisible) {
                int targetRaiseCss = Math.round(Math.max(0, imeBottomPx - navBottomPx) / density);
                lastSyncedImeOpen = true;
                dispatchImeStartWithAttr(180L, targetRaiseCss);
                dispatchImeShown();
            } else if (prevVisible && !isImeVisible) {
                syncImeOpenAttr(false, false);
                dispatchImeHidden();
            }
        }
    }

    @SuppressWarnings("deprecation")
    private WindowInsets consumeBottomInsets(WindowInsets insets, int consumedBottomPx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsets base = consumedBottomPx > 0 ? insets.inset(0, 0, 0, consumedBottomPx) : insets;
            return new WindowInsets.Builder(base)
                    .setInsets(WindowInsets.Type.ime(), Insets.NONE)
                    .build();
        }
        if (consumedBottomPx <= 0) {
            return insets;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return insets.inset(0, 0, 0, consumedBottomPx);
        }
        return insets.replaceSystemWindowInsets(
                insets.getSystemWindowInsetLeft(),
                insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(),
                Math.max(0, insets.getSystemWindowInsetBottom() - consumedBottomPx));
    }

    private void syncImeOpenAttr(boolean visible, boolean force) {
        if ((!force && visible == lastSyncedImeOpen) || webView == null) {
            return;
        }
        lastSyncedImeOpen = visible;
        String js = visible
                ? "document.documentElement.dataset.imeOpen='true';"
                : "delete document.documentElement.dataset.imeOpen;";
        webView.evaluateJavascript(js, null);
    }

    private void dispatchImeStart(long durationMs, int targetRaiseCss) {
        if (webView != null) {
            webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('android-ime-start',{detail:{durationMs:"
                            + durationMs + ",targetRaiseCss:" + targetRaiseCss + "}}));",
                    null);
        }
    }

    private void dispatchImeStartWithAttr(long durationMs, int targetRaiseCss) {
        if (webView != null) {
            webView.evaluateJavascript(
                    "document.documentElement.dataset.imeOpen='true';"
                            + "window.dispatchEvent(new CustomEvent('android-ime-start',{detail:{durationMs:"
                            + durationMs + ",targetRaiseCss:" + targetRaiseCss + "}}));",
                    null);
        }
    }

    private void dispatchImeShown() {
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('android-ime-shown'));", null);
        }
    }

    private void dispatchImeHidden() {
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('android-ime-hidden'));", null);
        }
    }

    private void syncSafeAreaToWeb() {
        if (webView == null) {
            return;
        }
        String js = "document.documentElement.style.setProperty('--safe-top','" + safeTopCss + "px');"
                + "document.documentElement.style.setProperty('--safe-bottom','" + safeBottomCss + "px');";
        webView.evaluateJavascript(js, null);
    }

    private void injectThemeAndDownloadHooks() {
        syncSafeAreaToWeb();
        syncImeOpenAttr(isImeVisible, true);
        String js = "(function(){"
                + "if(window.__androidHooksInstalled)return;"
                + "window.__androidHooksInstalled=true;"
                + "var syncTheme=function(){"
                + "var dark=Boolean(document.body&&document.body.hasAttribute('data-ds-dark-theme'));"
                + "if(window.AndroidHost&&window.AndroidHost.onThemeChanged){window.AndroidHost.onThemeChanged(dark);}"
                + "};"
                + "syncTheme();"
                + "if(document.body){new MutationObserver(syncTheme).observe(document.body,{attributes:true,attributeFilter:['data-ds-dark-theme','class']});}"
                + "document.addEventListener('click',function(e){"
                + "var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;"
                + "if(a&&a.href&&a.href.indexOf('blob:')===0&&window.AndroidHost){"
                + "e.preventDefault();"
                + "var name=a.getAttribute('download')||'chat-history.zip';"
                + "fetch(a.href).then(function(r){return r.blob();}).then(function(b){"
                + "var reader=new FileReader();"
                + "reader.onloadend=function(){"
                + "var res=String(reader.result||'');"
                + "var idx=res.indexOf(',');"
                + "if(idx!==-1){window.AndroidHost.saveBlobBase64(res.slice(idx+1),name,b.type||'application/zip');}"
                + "};"
                + "reader.readAsDataURL(b);"
                + "});"
                + "}"
                + "},true);"
                + "})();";
        webView.evaluateJavascript(js, null);
    }

    private void applySystemBarsTheme(boolean isDark) {
        Window window = getWindow();
        View decor = window.getDecorView();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = decor.getWindowInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(isDark ? 0 : mask, mask);
            }
        } else {
            int flags = decor.getSystemUiVisibility();
            if (isDark) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            } else {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }
    }

    private boolean tryStartActivity(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void openExternalUri(Uri uri) {
        tryStartActivity(new Intent(Intent.ACTION_VIEW, uri));
    }

    private String guessMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('os-theme-change'));", null);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        String checkJs = "(function(){"
                + "var hasLayer=Boolean(document.querySelector('[role=\"dialog\"][aria-modal=\"true\"]')||document.querySelector('[data-open=\"true\"]')||document.querySelector('aside[class*=\"panel\"]'));"
                + "if(hasLayer){"
                + "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));"
                + "return true;"
                + "}"
                + "return false;"
                + "})()";
        webView.evaluateJavascript(checkJs, value -> {
            if (!"true".equals(value)) {
                runOnUiThread(MainActivity.super::onBackPressed);
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback == null) {
                clearPendingCameraUri();
                cancelFileCallback();
                return;
            }
            Uri[] results = null;
            if (pendingCameraUri != null) {
                if (resultCode == Activity.RESULT_OK) {
                    results = new Uri[]{pendingCameraUri};
                    pendingCameraUri = null;
                } else {
                    clearPendingCameraUri();
                }
            } else if (resultCode == Activity.RESULT_OK && data != null) {
                ClipData clipData = data.getClipData();
                if (clipData != null && clipData.getItemCount() > 0) {
                    results = new Uri[clipData.getItemCount()];
                    for (int i = 0; i < clipData.getItemCount(); i++) {
                        results[i] = clipData.getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            videoAudio.acceptSelection(pendingVideoAudioSelection,
                    results != null && results.length == 1 ? results[0] : null);
            pendingVideoAudioSelection = null;
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_AUDIO_PERMISSION) {
            if (pendingPermissionRequest != null) {
                if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                    pendingPermissionRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    pendingPermissionRequest.deny();
                }
                pendingPermissionRequest = null;
            }
            return;
        }
        if (requestCode == REQ_GALLERY_PERMISSION) {
            boolean granted = checkGalleryPermission();
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('android-gallery-permission',{detail:{granted:" + granted + "}}));",
                        null
                );
            }
            if (granted) {
                loadRecentPhotosAsync(10);
            }
            return;
        }
        if (requestCode == REQ_LOCATION_PERMISSION) {
            boolean granted = checkLocationPermission();
            boolean fineGranted = checkFineLocationPermission();
            long elapsed = lastLocationPermissionRequestAt > 0L
                    ? System.currentTimeMillis() - lastLocationPermissionRequestAt
                    : Long.MAX_VALUE;
            boolean hadCoarse = lastLocationPermissionHadCoarse;
            lastLocationPermissionRequestAt = 0L;
            lastLocationPermissionHadCoarse = false;
            boolean blockedUpgrade = !fineGranted && elapsed < 250L && (
                    hadCoarse || !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)
            );
            dispatchLocationPermissionState(blockedUpgrade);
            Integer reqId = pendingLocationRequestId;
            pendingLocationRequestId = null;
            if (reqId != null) {
                if (granted) {
                    fetchCurrentLocationAsync(reqId);
                } else {
                    dispatchLocationError(reqId, "permission_denied", "Location permission denied");
                }
            }
            return;
        }
        if (requestCode == REQ_GEOLOCATION_PROMPT) {
            boolean granted = checkLocationPermission();
            if (pendingGeolocationCallback != null) {
                pendingGeolocationCallback.invoke(pendingGeolocationOrigin, granted, false);
                pendingGeolocationCallback = null;
                pendingGeolocationOrigin = null;
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    private boolean checkFineLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean checkLocationPermission() {
        return checkFineLocationPermission()
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private String getLocationPermissionLevelInternal() {
        if (checkFineLocationPermission()) {
            return "fine";
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            return "coarse";
        }
        return "none";
    }

    private void dispatchLocationPermissionState(final boolean blockedUpgrade) {
        final boolean granted = checkLocationPermission();
        final boolean fineGranted = checkFineLocationPermission();
        final String level = getLocationPermissionLevelInternal();
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('android-location-permission',{detail:{granted:"
                                + granted
                                + ",fineGranted:"
                                + fineGranted
                                + ",level:'"
                                + level
                                + "',blockedUpgrade:"
                                + blockedUpgrade
                                + "}}));",
                        null
                );
            }
        });
    }

    private boolean isSystemLocationEnabled(LocationManager manager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return manager.isLocationEnabled();
        }
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    @SuppressWarnings("MissingPermission")
    private void fetchCurrentLocationAsync(final int requestId) {
        if (cancelActiveLocation != null) {
            cancelActiveLocation.run();
            cancelActiveLocation = null;
        }
        LocationManager manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            dispatchLocationError(requestId, "unavailable", "Location service unavailable");
            return;
        }

        final boolean hasFine = checkFineLocationPermission();
        if (!hasFine && !checkLocationPermission()) {
            dispatchLocationError(requestId, "permission_denied", "Location permission denied");
            return;
        }
        if (!isSystemLocationEnabled(manager)) {
            dispatchLocationError(requestId, "location_disabled", "System location services are disabled");
            return;
        }

        List<String> providers = new ArrayList<>();
        // 仅在授予精确位置时使用 GPS_PROVIDER；仅大致位置时若强行注册 GPS 会被系统静默挂起并拖到超时
        if (hasFine && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            providers.add(LocationManager.GPS_PROVIDER);
        }
        if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
            providers.add(LocationManager.NETWORK_PROVIDER);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.isProviderEnabled(LocationManager.FUSED_PROVIDER)) {
            providers.add(LocationManager.FUSED_PROVIDER);
        }
        if (providers.isEmpty()) {
            Location fallback = pickBestLastKnownLocation(manager, hasFine);
            if (fallback != null) {
                resolveAndDispatchLocation(requestId, fallback, !hasFine);
                return;
            }
            if (!hasFine) {
                dispatchLocationError(
                        requestId,
                        "precise_location_required",
                        "Only approximate location permission is granted and no network fix is available"
                );
            } else {
                dispatchLocationError(requestId, "location_disabled", "System location services are disabled");
            }
            return;
        }

        final AtomicBoolean finished = new AtomicBoolean(false);
        final List<Runnable> cleanups = new ArrayList<>();
        final Runnable cleanupAll = () -> {
            List<Runnable> snapshot = new ArrayList<>(cleanups);
            cleanups.clear();
            for (Runnable cleanup : snapshot) {
                try {
                    cleanup.run();
                } catch (Exception ignored) {
                }
            }
        };

        final Runnable finishWithTimeout = () -> {
            if (!finished.compareAndSet(false, true)) {
                return;
            }
            cleanupAll.run();
            cancelActiveLocation = null;
            Location fallback = pickBestLastKnownLocation(manager, hasFine);
            if (fallback != null) {
                resolveAndDispatchLocation(requestId, fallback, !hasFine);
            } else if (!hasFine) {
                dispatchLocationError(
                        requestId,
                        "precise_location_required",
                        "Approximate location timed out; precise location permission is required"
                );
            } else {
                dispatchLocationError(requestId, "timeout", "Location request timed out");
            }
        };

        cancelActiveLocation = () -> {
            if (finished.compareAndSet(false, true)) {
                mainHandler.removeCallbacks(finishWithTimeout);
                cleanupAll.run();
            }
        };

        mainHandler.postDelayed(finishWithTimeout, hasFine ? 6500 : 2500);

        for (String provider : providers) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                CancellationSignal signal = new CancellationSignal();
                cleanups.add(signal::cancel);
                try {
                    manager.getCurrentLocation(provider, signal, mainHandler::post, location -> {
                        if (location != null && finished.compareAndSet(false, true)) {
                            mainHandler.removeCallbacks(finishWithTimeout);
                            cleanupAll.run();
                            cancelActiveLocation = null;
                            resolveAndDispatchLocation(requestId, location, !hasFine);
                        }
                    });
                } catch (Exception ignored) {
                }
            } else {
                LocationListener listener = new LocationListener() {
                    @Override
                    public void onLocationChanged(Location location) {
                        if (location != null && finished.compareAndSet(false, true)) {
                            mainHandler.removeCallbacks(finishWithTimeout);
                            cleanupAll.run();
                            cancelActiveLocation = null;
                            resolveAndDispatchLocation(requestId, location, !hasFine);
                        }
                    }

                    @Override
                    public void onStatusChanged(String p, int status, Bundle extras) {}

                    @Override
                    public void onProviderEnabled(String p) {}

                    @Override
                    public void onProviderDisabled(String p) {}
                };
                cleanups.add(() -> manager.removeUpdates(listener));
                try {
                    requestSingleUpdateLegacy(manager, provider, listener);
                } catch (Exception ignored) {
                }
            }
        }
    }

    @SuppressWarnings({"deprecation", "MissingPermission"})
    private void requestSingleUpdateLegacy(LocationManager manager, String provider, LocationListener listener) {
        manager.requestSingleUpdate(provider, listener, Looper.getMainLooper());
    }

    @SuppressWarnings("MissingPermission")
    private Location pickBestLastKnownLocation(LocationManager manager, boolean hasFine) {
        Location best = null;
        for (String provider : manager.getAllProviders()) {
            if (!hasFine && LocationManager.GPS_PROVIDER.equals(provider)) {
                continue;
            }
            try {
                Location candidate = manager.getLastKnownLocation(provider);
                if (candidate == null) {
                    continue;
                }
                if (best == null || candidate.getTime() > best.getTime()) {
                    best = candidate;
                }
            } catch (Exception ignored) {
            }
        }
        return best;
    }

    private void resolveAndDispatchLocation(final int requestId, final Location location, final boolean approximate) {
        mediaExecutor.execute(() -> {
            JSONObject payload = new JSONObject();
            try {
                payload.put("requestId", requestId);
                payload.put("ok", true);
                payload.put("latitude", location.getLatitude());
                payload.put("longitude", location.getLongitude());
                if (approximate) {
                    payload.put("approximate", true);
                }
                if (location.hasAccuracy() && location.getAccuracy() > 0) {
                    payload.put("accuracy", location.getAccuracy());
                }
                long rawTs = location.getTime();
                payload.put("timestamp", rawTs >= 1500000000000L ? rawTs : System.currentTimeMillis());

                Address addr = reverseGeocode(location.getLatitude(), location.getLongitude());
                if (addr != null) {
                    if (addr.getCountryName() != null) payload.put("country", addr.getCountryName());
                    if (addr.getAdminArea() != null) payload.put("province", addr.getAdminArea());
                    String city = addr.getLocality() != null ? addr.getLocality() : addr.getSubAdminArea();
                    if (city != null) payload.put("city", city);
                    if (addr.getSubLocality() != null) payload.put("district", addr.getSubLocality());
                    if (addr.getMaxAddressLineIndex() >= 0) {
                        payload.put("address", addr.getAddressLine(0));
                    }
                }
            } catch (Exception ignored) {
            }
            dispatchLocationJson(payload);
        });
    }

    @SuppressWarnings("deprecation")
    private Address reverseGeocode(double lat, double lon) {
        if (!Geocoder.isPresent()) {
            return null;
        }
        // 在无谷歌服务的环境下原生 Geocoder.getFromLocation 可能长时间阻塞，限时 1.5s 防拖慢工具响应
        final AtomicReference<Address> resolved = new AtomicReference<>();
        final CountDownLatch latch = new CountDownLatch(1);
        Thread worker = new Thread(() -> {
            try {
                Geocoder geocoder = new Geocoder(this, Locale.getDefault());
                List<Address> results = geocoder.getFromLocation(lat, lon, 1);
                if (results != null && !results.isEmpty()) {
                    resolved.set(results.get(0));
                }
            } catch (Exception ignored) {
            } finally {
                latch.countDown();
            }
        }, "reverse-geocode");
        worker.setDaemon(true);
        worker.start();
        try {
            latch.await(1500, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        return resolved.get();
    }

    private void dispatchLocationError(int requestId, String errorCode, String message) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("requestId", requestId);
            payload.put("ok", false);
            payload.put("errorCode", errorCode);
            payload.put("message", message);
        } catch (Exception ignored) {
        }
        dispatchLocationJson(payload);
    }

    private void dispatchLocationJson(final JSONObject payload) {
        final String json = payload.toString();
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('android-location-result',{detail:" + json + "}));",
                        null
                );
            }
        });
    }

    private class AndroidBridge {
        @JavascriptInterface
        public boolean hasUrlDownloadProxy() {
            return true;
        }

        @JavascriptInterface
        public boolean isKeyboardVisible() {
            return isImeVisible;
        }

        @JavascriptInterface
        public int getKeyboardHeightCss() {
            return lastKnownImeRaiseCss;
        }

        @JavascriptInterface
        public void hideKeyboard() {
            runOnUiThread(() -> {
                if (webView == null) {
                    return;
                }
                syncImeOpenAttr(false, false);
                webView.clearFocus();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowInsetsController controller = webView.getWindowInsetsController();
                    if (controller != null) {
                        controller.hide(WindowInsets.Type.ime());
                    }
                }
                InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) {
                    imm.hideSoftInputFromWindow(webView.getWindowToken(), 0);
                }
            });
        }

        @JavascriptInterface
        public boolean isSystemDark() {
            return (getResources().getConfiguration().uiMode
                    & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        }

        @JavascriptInterface
        public void onThemeChanged(final boolean isDark) {
            runOnUiThread(() -> {
                applySystemBarsTheme(isDark);
                int bgColor = isDark ? Color.BLACK : Color.WHITE;
                if (rootContainer != null) {
                    rootContainer.setBackgroundColor(bgColor);
                }
                if (webView != null) {
                    webView.setBackgroundColor(bgColor);
                }
            });
        }

        @JavascriptInterface
        public void setNextPickerMode(String mode) {
            videoAudio.releaseSelection(nextVideoAudioSelection);
            nextVideoAudioSelection = null;
            if ("camera".equals(mode) || "gallery".equals(mode) || "file".equals(mode) || "video".equals(mode)) {
                nextPickerMode = mode;
            } else {
                nextPickerMode = "file";
            }
        }

        @JavascriptInterface
        public boolean supportsVideoAudio() {
            return true;
        }

        @JavascriptInterface
        public boolean prepareVideoAudioPicker(String selectionId) {
            if (!videoAudio.reserveSelection(selectionId)) {
                return false;
            }
            videoAudio.releaseSelection(nextVideoAudioSelection);
            nextVideoAudioSelection = selectionId;
            nextPickerMode = "video";
            return true;
        }

        @JavascriptInterface
        public void releaseVideoAudioSelection(String selectionId) {
            videoAudio.releaseSelection(selectionId);
        }

        @JavascriptInterface
        public boolean prepareVideoAudioRequest(String selectionId, String requestId) {
            return videoAudio.reserveRequest(selectionId, requestId);
        }

        @JavascriptInterface
        public void cancelVideoAudioRequest(String requestId) {
            videoAudio.cancelRequest(requestId);
        }

        @JavascriptInterface
        public boolean hasGalleryPermission() {
            return checkGalleryPermission();
        }

        @JavascriptInterface
        public void requestGalleryPermission() {
            runOnUiThread(() -> {
                if (checkGalleryPermission()) {
                    loadRecentPhotosAsync(10);
                    return;
                }
                if (Build.VERSION.SDK_INT >= 34) {
                    requestPermissions(
                            new String[]{
                                    "android.permission.READ_MEDIA_IMAGES",
                                    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
                            },
                            REQ_GALLERY_PERMISSION
                    );
                } else if (Build.VERSION.SDK_INT >= 33) {
                    requestPermissions(
                            new String[]{"android.permission.READ_MEDIA_IMAGES"},
                            REQ_GALLERY_PERMISSION
                    );
                } else {
                    requestPermissions(
                            new String[]{Manifest.permission.READ_EXTERNAL_STORAGE},
                            REQ_GALLERY_PERMISSION
                    );
                }
            });
        }

        @JavascriptInterface
        public void requestRecentPhotos(int limit) {
            loadRecentPhotosAsync(Math.max(1, Math.min(limit, 20)));
        }

        @JavascriptInterface
        public boolean hasLocationPermission() {
            return checkLocationPermission();
        }

        @JavascriptInterface
        public String getLocationPermissionLevel() {
            return getLocationPermissionLevelInternal();
        }

        @JavascriptInterface
        public void openAppLocationSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.fromParts("package", getPackageName(), null));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            });
        }

        @JavascriptInterface
        public void requestLocationPermission() {
            runOnUiThread(() -> {
                // 仅在已经获得精确位置时直接确认；如果此前只给了大致位置，继续向系统申请升级
                if (checkFineLocationPermission()) {
                    dispatchLocationPermissionState(false);
                    return;
                }
                lastLocationPermissionHadCoarse = checkLocationPermission();
                lastLocationPermissionRequestAt = System.currentTimeMillis();
                requestPermissions(
                        new String[]{
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                        },
                        REQ_LOCATION_PERMISSION
                );
            });
        }

        @JavascriptInterface
        public void requestCurrentLocation(final int requestId) {
            runOnUiThread(() -> {
                if (!checkLocationPermission()) {
                    pendingLocationRequestId = requestId;
                    lastLocationPermissionHadCoarse = false;
                    lastLocationPermissionRequestAt = System.currentTimeMillis();
                    requestPermissions(
                            new String[]{
                                    Manifest.permission.ACCESS_FINE_LOCATION,
                                    Manifest.permission.ACCESS_COARSE_LOCATION
                            },
                            REQ_LOCATION_PERMISSION
                    );
                    return;
                }
                fetchCurrentLocationAsync(requestId);
            });
        }

    private String sanitizeDownloadName(String fileName) {
        if (fileName == null) {
            return "deepseek_data.zip";
        }
        String clean = fileName.replaceAll("[/\\\\:*?\"<>|\\r\\n]", "_").trim();
        return clean.isEmpty() || ".".equals(clean) || "..".equals(clean) ? "deepseek_data.zip" : clean;
    }

    private File resolveUniqueDownloadFile(File dir, String fileName) {
        File candidate = new File(dir, fileName);
        if (!candidate.exists()) {
            return candidate;
        }
        int dot = fileName.lastIndexOf('.');
        String stem = dot > 0 ? fileName.substring(0, dot) : fileName;
        String ext = dot > 0 ? fileName.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            File next = new File(dir, stem + " (" + i + ")" + ext);
            if (!next.exists()) {
                return next;
            }
        }
        return new File(dir, stem + "_" + System.currentTimeMillis() + ext);
    }

    @SuppressWarnings("deprecation")
    private String[] writeBytesToDownloads(byte[] bytes, String rawFileName, String rawMimeType) throws IOException {
        String safeName = sanitizeDownloadName(rawFileName);
        String safeMime = (rawMimeType == null || rawMimeType.trim().isEmpty())
                ? "application/zip"
                : rawMimeType.trim();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
            values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                throw new IOException("无法创建下载目录文件");
            }
            try {
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) {
                        throw new IOException("无法打开下载输出流");
                    }
                    out.write(bytes);
                    out.flush();
                }
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, ready, null, null);
            } catch (Exception e) {
                try {
                    getContentResolver().delete(uri, null, null);
                } catch (Exception ignored) {
                }
                if (e instanceof IOException) {
                    throw (IOException) e;
                }
                throw new IOException(e.getMessage(), e);
            }

            String actualName = safeName;
            String actualPath = Environment.DIRECTORY_DOWNLOADS + "/" + safeName;
            String[] projection = {
                    MediaStore.Downloads.DISPLAY_NAME,
                    MediaStore.Downloads.RELATIVE_PATH,
                    MediaStore.MediaColumns.DATA
            };
            try (Cursor cursor = getContentResolver().query(uri, projection, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIdx = cursor.getColumnIndex(MediaStore.Downloads.DISPLAY_NAME);
                    int relIdx = cursor.getColumnIndex(MediaStore.Downloads.RELATIVE_PATH);
                    int dataIdx = cursor.getColumnIndex(MediaStore.MediaColumns.DATA);
                    if (nameIdx >= 0 && cursor.getString(nameIdx) != null) {
                        actualName = cursor.getString(nameIdx);
                    }
                    String dataPath = dataIdx >= 0 ? cursor.getString(dataIdx) : null;
                    if (dataPath != null && !dataPath.trim().isEmpty()) {
                        actualPath = dataPath.trim();
                    } else {
                        String relPath = relIdx >= 0 ? cursor.getString(relIdx) : Environment.DIRECTORY_DOWNLOADS;
                        if (relPath == null || relPath.isEmpty()) {
                            relPath = Environment.DIRECTORY_DOWNLOADS;
                        }
                        if (!relPath.endsWith("/")) {
                            relPath = relPath + "/";
                        }
                        actualPath = relPath + actualName;
                    }
                }
            } catch (Exception ignored) {
            }
            return new String[]{actualName, actualPath};
        }

        File targetDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!targetDir.exists() && !targetDir.mkdirs()) {
            targetDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        }
        if (targetDir == null) {
            throw new IOException("下载目录不可用");
        }
        File targetFile;
        try {
            targetFile = resolveUniqueDownloadFile(targetDir, safeName);
            try (FileOutputStream out = new FileOutputStream(targetFile)) {
                out.write(bytes);
                out.flush();
            }
        } catch (SecurityException se) {
            File appDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (appDir == null || (!appDir.exists() && !appDir.mkdirs())) {
                throw new IOException("没有下载目录写入权限", se);
            }
            targetFile = resolveUniqueDownloadFile(appDir, safeName);
            try (FileOutputStream out = new FileOutputStream(targetFile)) {
                out.write(bytes);
                out.flush();
            }
        }
        return new String[]{targetFile.getName(), targetFile.getAbsolutePath()};
    }

    private void dispatchExportJson(final JSONObject payload) {
        final String json = payload.toString();
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('android-export-result',{detail:" + json + "}));",
                        null
                );
            }
        });
    }

    private void performSaveExportFile(int requestId, String base64, String fileName, String mimeType) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("requestId", requestId);
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            String[] saved = writeBytesToDownloads(bytes, fileName, mimeType);
            payload.put("ok", true);
            payload.put("fileName", saved[0]);
            payload.put("path", saved[1]);
        } catch (Exception e) {
            try {
                payload.put("ok", false);
                payload.put("message", e.getMessage() != null ? e.getMessage() : "写入文件失败");
            } catch (Exception ignored) {
            }
        }
        dispatchExportJson(payload);
    }

        @JavascriptInterface
        public void saveExportFile(final int requestId, final String base64, final String fileName, final String mimeType) {
            mediaExecutor.execute(() -> performSaveExportFile(requestId, base64, fileName, mimeType));
        }

        @JavascriptInterface
        public boolean openDownloadsFolder() {
            if (tryStartActivity(new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))) {
                return true;
            }
            Intent docsIntent = new Intent(Intent.ACTION_VIEW);
            docsIntent.setDataAndType(
                    Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload"),
                    "vnd.android.document/directory"
            );
            if (tryStartActivity(docsIntent)) {
                return true;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                Intent filesIntent = Intent.makeMainSelectorActivity(
                        Intent.ACTION_MAIN,
                        Intent.CATEGORY_APP_FILES
                );
                if (tryStartActivity(filesIntent)) {
                    return true;
                }
            }
            return false;
        }

        @JavascriptInterface
        public void saveBlobBase64(final String base64, final String fileName, final String mimeType) {
            mediaExecutor.execute(() -> {
                try {
                    byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                    String[] saved = writeBytesToDownloads(bytes, fileName, mimeType);
                    runOnUiThread(() -> Toast.makeText(
                            MainActivity.this,
                            "已导出至: " + saved[1],
                            Toast.LENGTH_SHORT
                    ).show());
                } catch (Exception e) {
                    runOnUiThread(() -> Toast.makeText(
                            MainActivity.this,
                            "导出失败: " + e.getMessage(),
                            Toast.LENGTH_SHORT
                    ).show());
                }
            });
        }
    }
}
