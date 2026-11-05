package app.notoz.android;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();

        // ── 1. True Edge-to-Edge: Draw behind Status Bar & Navigation Bar ──
        WindowCompat.setDecorFitsSystemWindows(window, false);

        window.clearFlags(
            WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS |
            WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION
        );
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        // Disable Android 10+ (API 29+) contrast scrim so navbar is 100% transparent
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }

        // Allow drawing into cutout / notch / punch-hole area
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }

        // ── 2. 120Hz to 144Hz High-Refresh-Rate Display Mode Negotiation ──
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
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
                // Ensure WebView background is transparent so app wallpaper shines through edge-to-edge
                webView.setBackgroundColor(Color.TRANSPARENT);

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
