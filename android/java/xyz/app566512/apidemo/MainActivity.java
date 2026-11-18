package xyz.app566512.apidemo;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_ORIGIN = "https://" + APP_HOST;
    private static final String MEDIA_PREFIX = "/__android_media__/";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_AUDIO_PERMISSION = 1002;
    private static final int REQ_GALLERY_PERMISSION = 1003;

    private final ExecutorService mediaExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, Uri> recentMediaUris = new ConcurrentHashMap<>();

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingPermissionRequest;
    private Uri pendingCameraUri;
    private String nextPickerMode = "file";
    private int safeTopCss = 24;
    private int safeBottomCss = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        boolean isDark = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;

        webView = new WebView(this);
        webView.setBackgroundColor(isDark ? Color.BLACK : Color.WHITE);
        setContentView(webView);
        setupEdgeToEdge();
        applySystemBarsTheme(isDark);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportMultipleWindows(true);
        settings.setTextZoom(100);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidHost");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost())) {
                    String path = uri.getPath();
                    if (path != null && path.startsWith(MEDIA_PREFIX)) {
                        return serveMediaUri(path.substring(MEDIA_PREFIX.length()));
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
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                String mode = nextPickerMode;
                nextPickerMode = "file";
                if ("file".equals(mode) && fileChooserParams != null && fileChooserParams.isCaptureEnabled()) {
                    mode = "camera";
                }

                if ("camera".equals(mode)) {
                    return launchCameraChooser();
                }
                if ("gallery".equals(mode)) {
                    return launchGalleryChooser(fileChooserParams);
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
        });

        webView.loadUrl(APP_ORIGIN + "/index.html");
    }

    @Override
    protected void onDestroy() {
        mediaExecutor.shutdownNow();
        super.onDestroy();
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
        decor.setOnApplyWindowInsetsListener((v, insets) -> {
            float density = getResources().getDisplayMetrics().density;
            if (density <= 0f) {
                density = 1f;
            }
            int topPx;
            int navBottomPx;
            int imeBottomPx;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                topPx = insets.getInsets(WindowInsets.Type.statusBars()).top;
                navBottomPx = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
                imeBottomPx = insets.getInsets(WindowInsets.Type.ime()).bottom;
            } else {
                topPx = insets.getSystemWindowInsetTop();
                navBottomPx = insets.getSystemWindowInsetBottom();
                imeBottomPx = navBottomPx;
            }
            safeTopCss = Math.round(topPx / density);
            boolean imeVisible = imeBottomPx > navBottomPx;
            safeBottomCss = imeVisible ? 0 : Math.round(navBottomPx / density);
            if (webView != null) {
                webView.setPadding(0, 0, 0, imeVisible ? imeBottomPx : 0);
                syncSafeAreaToWeb();
            }
            return insets;
        });
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

    private void openExternalUri(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
        }
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
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    private class AndroidBridge {
        @JavascriptInterface
        public boolean isSystemDark() {
            return (getResources().getConfiguration().uiMode
                    & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        }

        @JavascriptInterface
        public void onThemeChanged(final boolean isDark) {
            runOnUiThread(() -> {
                applySystemBarsTheme(isDark);
                if (webView != null) {
                    webView.setBackgroundColor(isDark ? Color.BLACK : Color.WHITE);
                }
            });
        }

        @JavascriptInterface
        public void setNextPickerMode(String mode) {
            if ("camera".equals(mode) || "gallery".equals(mode) || "file".equals(mode)) {
                nextPickerMode = mode;
            } else {
                nextPickerMode = "file";
            }
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
        public void saveBlobBase64(String base64, String fileName, String mimeType) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                            if (out != null) {
                                out.write(bytes);
                            }
                        }
                    }
                }
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "已导出至系统下载目录: " + fileName, Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "导出失败: " + e.getMessage(), Toast.LENGTH_SHORT).show());
            }
        }
    }
}
