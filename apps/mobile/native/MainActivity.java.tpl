package __PACKAGE__;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * MedAI Hospital Android shell.
 *
 * <p>Native abilities given to the web app (both are impossible in a plain browser):
 * <ul>
 *   <li>{@code window.MedAIAndroid.saveBase64(name, mime, base64)} — save a downloaded file
 *       (prescription PDF, report, photo…) to Downloads and open it.</li>
 *   <li>{@code window.MedAIAndroid.printHtml(html, title)} — open the Android print dialog
 *       (Save as PDF / print).</li>
 * </ul>
 *
 * <p>Every start-up step is wrapped: a phone with a broken or disabled Android System WebView,
 * or one Capacitor plugin that fails while loading, used to take the whole app down at launch
 * ("app installs but closes immediately"). Now the failure is recorded and shown, and the app
 * stays open whenever the bridge itself survived.
 */
public class MainActivity extends BridgeActivity {
    private WebView printWebView;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        try {
            super.onCreate(savedInstanceState);
        } catch (Throwable error) {
            startupFailed(error);
            return;
        }
        attachNativeBridge();
    }

    /**
     * Capacitor builds the WebView bridge and loads every native plugin in here. A single
     * failing plugin (or a missing WebView package) throws from this call and killed the app,
     * so it is caught and reported instead of closing.
     */
    @Override
    protected void load() {
        try {
            super.load();
        } catch (Throwable error) {
            startupFailed(error);
        }
    }

    // After a failed start the bridge can be missing, and Capacitor's own lifecycle code
    // dereferences it without a null check in these four places. Guarding them keeps the
    // error screen visible instead of crashing a second time.
    @Override
    public void onRestart() {
        try {
            super.onRestart();
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        try {
            super.onNewIntent(intent);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onSaveInstanceState(Bundle outState) {
        try {
            super.onSaveInstanceState(outState);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onDestroy() {
        try {
            super.onDestroy();
        } catch (Throwable ignored) {
        }
    }

    private void attachNativeBridge() {
        try {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView != null) {
                webView.addJavascriptInterface(new NativeBridge(), "MedAIAndroid");
            }
        } catch (Throwable error) {
            MedAIApplication.recordCrash(this, error);
        }
    }

    /** Saves the reason, shows it on screen, and opens the copyable report. */
    private void startupFailed(Throwable error) {
        String text = MedAIApplication.recordCrash(this, error);
        try {
            showStartupError(text);
        } catch (Throwable ignored) {
            // nothing else can be done if even a TextView cannot be shown
        }
        try {
            Intent intent = new Intent(this, CrashReportActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            intent.putExtra(CrashReportActivity.EXTRA_TEXT, text);
            startActivity(intent);
        } catch (Throwable ignored) {
        }
    }

    private void showStartupError(String text) {
        int pad = Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, 18, getResources().getDisplayMetrics()));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("MedAI Hospital could not start");
        title.setTextSize(20);
        title.setTextColor(Color.parseColor("#092b46"));

        TextView hint = new TextView(this);
        hint.setText("Update \"Android System WebView\" from the Play Store, then reopen the app.\n\n"
                + "If it still happens, copy the text below and send it to support.");
        hint.setTextSize(14);
        hint.setTextColor(Color.parseColor("#33475b"));
        hint.setPadding(0, pad / 2, 0, pad / 2);

        ScrollView scroll = new ScrollView(this);
        TextView details = new TextView(this);
        details.setText(text);
        details.setTextSize(12);
        details.setTextIsSelectable(true);
        details.setBackgroundColor(Color.parseColor("#fff6e0"));
        details.setPadding(pad, pad, pad, pad);
        scroll.addView(details, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(hint, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    private class NativeBridge {
        @JavascriptInterface
        public void saveBase64(String name, String mime, String b64) {
            try {
                String safe = (name == null ? "" : name).replaceAll("[\\\\/:*?\"<>|]", "_").trim();
                if (safe.length() == 0) safe = "medai-file";
                String type = (mime == null || mime.length() == 0) ? "application/octet-stream" : mime;
                byte[] data = Base64.decode(b64, Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    values.put(MediaStore.Downloads.MIME_TYPE, type);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    final Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new Exception("Could not create the file");
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    os.write(data);
                    os.close();
                    toast("Saved to Downloads: " + safe);
                    final String openType = type;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                Intent view = new Intent(Intent.ACTION_VIEW);
                                view.setDataAndType(uri, openType);
                                view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(view);
                            } catch (Exception ignored) {
                                // no app to open this type: the file is still saved in Downloads
                            }
                        }
                    });
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) dir = getFilesDir();
                    dir.mkdirs();
                    File out = new File(dir, safe);
                    FileOutputStream fos = new FileOutputStream(out);
                    fos.write(data);
                    fos.close();
                    toast("Saved: " + out.getAbsolutePath());
                }
            } catch (Exception e) {
                toast("Download failed: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void printHtml(final String html, final String title) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        printWebView = new WebView(MainActivity.this);
                        printWebView.setWebViewClient(new WebViewClient() {
                            @Override
                            public void onPageFinished(WebView view, String url) {
                                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                                PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(title);
                                pm.print(title, adapter, new PrintAttributes.Builder().build());
                            }
                        });
                        printWebView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                    } catch (Exception e) {
                        toast("Print failed: " + e.getMessage());
                    }
                }
            });
        }
    }
}
