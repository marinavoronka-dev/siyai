package ru.siyai.mia;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.*;
import android.widget.*;

public class MainActivity extends Activity {
    private static final String HOME = "https://marinavoronka-dev.github.io/siyai/";
    private WebView web;
    private ProgressBar progress;
    private LinearLayout error;
    private ValueCallback<Uri[]> picker;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(244,230,250));
        getWindow().setNavigationBarColor(Color.rgb(244,230,250));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(244,230,250));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText("  Сияй! Мия"); title.setTextSize(18); title.setTextColor(Color.rgb(99,54,124));
        bar.addView(title, new LinearLayout.LayoutParams(0, dp(44), 1));
        Button menu = new Button(this); menu.setText("⋮");
        bar.addView(menu, new LinearLayout.LayoutParams(dp(52),dp(44)));
        menu.setOnClickListener(v -> {
            PopupMenu popup = new PopupMenu(this, menu);
            popup.getMenu().add("Обновить").setOnMenuItemClickListener(item -> { web.reload(); return true; });
            popup.getMenu().add("Открыть в браузере").setOnMenuItemClickListener(item -> { external(Uri.parse(web.getUrl() == null ? HOME : web.getUrl())); return true; });
            popup.show();
        });
        root.addView(bar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        FrameLayout content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        web = new WebView(this);
        content.addView(web, new FrameLayout.LayoutParams(-1,-1));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(true);
        CookieManager.getInstance().setAcceptCookie(true);
        error = new LinearLayout(this); error.setOrientation(LinearLayout.VERTICAL); error.setGravity(Gravity.CENTER);
        error.setPadding(dp(24),dp(24),dp(24),dp(24)); error.setBackgroundColor(Color.rgb(255,248,252));
        TextView message = new TextView(this); message.setText("Не удалось загрузить страницу.\nПроверь подключение к интернету и попробуй снова.");
        message.setGravity(Gravity.CENTER); message.setTextSize(18); error.addView(message);
        Button retry = new Button(this); retry.setText("Попробовать снова"); error.addView(retry);
        retry.setOnClickListener(v -> web.loadUrl(HOME));
        content.addView(error,new FrameLayout.LayoutParams(-1,-1)); error.setVisibility(View.GONE);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && Uri.parse(HOME).getHost().equals(uri.getHost())) return false;
                external(uri); return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                error.setVisibility(View.GONE); progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError issue) {
                if (request.isForMainFrame()) { error.setVisibility(View.VISIBLE); progress.setVisibility(View.GONE); }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) error.setVisibility(View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value); if (value == 100) progress.setVisibility(View.GONE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picker != null) picker.onReceiveValue(null);
                picker = callback;
                try { startActivityForResult(params.createIntent(), 100); }
                catch (Exception e) { picker.onReceiveValue(null); picker = null; }
                return true;
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message result) {
                if (!gesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        external(req.getUrl()); v.destroy(); return true;
                    }
                });
                ((WebView.WebViewTransport)result.obj).setWebView(popup); result.sendToTarget(); return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, size) -> {
            if (url.startsWith("https://")) external(Uri.parse(url));
            else Toast.makeText(this,"Для сохранения файла открой сайт через меню «Открыть в браузере».",Toast.LENGTH_LONG).show();
        });
        setContentView(root);
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }
    private int dp(int value) { return (int)(value * getResources().getDisplayMetrics().density + 0.5f); }
    private void external(Uri uri) {
        String scheme = uri.getScheme();
        if (!("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme) || "tg".equals(scheme))) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (Exception e) { Toast.makeText(this,"Нет приложения для открытия ссылки",Toast.LENGTH_SHORT).show(); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request,result,data);
        if (request == 100 && picker != null) { picker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data)); picker = null; }
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); web.saveState(state); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onPause() { super.onPause(); web.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onResume() { super.onResume(); if(web != null) web.onResume(); }
    @Override protected void onDestroy() { if(picker != null) picker.onReceiveValue(null); web.destroy(); super.onDestroy(); }
}
