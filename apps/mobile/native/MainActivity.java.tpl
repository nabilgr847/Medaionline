package __PACKAGE__;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * MedAI Hospital Android shell.
 * Gives the web app two native abilities that a plain WebView does not have:
 *  - window.MedAIAndroid.saveBase64(name, mime, base64): save a downloaded file (prescription PDF, report, photo...) to Downloads and open it
 *  - window.MedAIAndroid.printHtml(html, title): open the Android print dialog (Save as PDF / print)
 */
public class MainActivity extends BridgeActivity {
    private WebView printWebView;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new NativeBridge(), "MedAIAndroid");
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
