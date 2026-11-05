package app.notoz.android;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ── 120Hz to 144Hz High-Refresh-Rate Display Mode Negotiation ──
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Window window = getWindow();
                Display display = getWindowManager().getDefaultDisplay();
                Display.Mode[] modes = display.getSupportedModes();
                Display.Mode maxMode = null;
                float maxRate = 60.0f;
                for (Display.Mode mode : modes) {
                    if (mode.getRefreshRate() > maxRate) {
                        maxRate = mode.getRefreshRate();
                        maxMode = mode;
                    }
                }
                if (maxMode != null) {
                    WindowManager.LayoutParams lp = window.getAttributes();
                    lp.preferredDisplayModeId = maxMode.getModeId();
                    window.setAttributes(lp);
                }
            } catch (Exception ignored) {}
        }

        // Apply WebView stability and performance hardening
        if (getBridge() != null) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();

                // ── Performance ──
                settings.setCacheMode(WebSettings.LOAD_DEFAULT);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setAllowFileAccess(true);

                // ── JavaScript ──
                settings.setJavaScriptEnabled(true);
                settings.setJavaScriptCanOpenWindowsAutomatically(false);

                // ── Rendering ──
                settings.setLoadWithOverviewMode(true);
                settings.setUseWideViewPort(true);
                settings.setSupportMultipleWindows(false);

                // ── Text / Encoding ──
                settings.setDefaultTextEncodingName("UTF-8");

                // ── Media ──
                settings.setMediaPlaybackRequiresUserGesture(false);

                // ── Mixed content: block (all HTTPS) ──
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

                // ── Safe browsing ──
                settings.setSafeBrowsingEnabled(true);

                // ── Prevent horizontal scroll bounce ──
                webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

                // ── Hardware acceleration ──
                webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
            }
        }
    }
}
