package __PACKAGE__;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;

/**
 * Shown instead of the app silently closing.
 *
 * <p>Runs in its own process (android:process=":crash") so it is not taken down by the
 * crash that opened it. It shows the saved startup report and lets the user copy it in one
 * tap: that text is exactly what is needed to fix the underlying problem.
 */
public class CrashReportActivity extends Activity {

    public static final String EXTRA_TEXT = "medai_crash_text";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String text = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_TEXT);
        if (text == null || text.trim().length() == 0) text = readSaved();
        if (text == null || text.trim().length() == 0) {
            text = "MedAI Hospital could not start, and no details were saved.\n\n"
                 + "Please update Android System WebView from the Play Store, reinstall the app, "
                 + "and try again.";
        }
        buildUi(text);
    }

    private String readSaved() {
        try {
            File file = MedAIApplication.crashFile(this);
            if (!file.exists()) return null;
            BufferedReader reader = new BufferedReader(new FileReader(file));
            StringBuilder out = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) out.append(line).append('\n');
            reader.close();
            return out.toString();
        } catch (Throwable t) {
            return null;
        }
    }

    private void buildUi(final String text) {
        int pad = Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, 18, getResources().getDisplayMetrics()));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("MedAI Hospital needs one more fix");
        title.setTextSize(20);
        title.setTextColor(Color.parseColor("#092b46"));
        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView hint = new TextView(this);
        hint.setText("The app saved the reason it could not start. Copy it and send it to support — "
                + "that text is what makes it fixable.");
        hint.setTextSize(14);
        hint.setTextColor(Color.parseColor("#33475b"));
        hint.setPadding(0, pad / 2, 0, pad / 2);
        root.addView(hint, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(this);
        TextView details = new TextView(this);
        details.setText(text);
        details.setTextSize(12);
        details.setTextIsSelectable(true);
        details.setTextColor(Color.parseColor("#1d2b36"));
        details.setBackgroundColor(Color.parseColor("#fff6e0"));
        details.setPadding(pad, pad, pad, pad);
        scroll.addView(details, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        scrollParams.topMargin = pad / 2;
        root.addView(scroll, scrollParams);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setPadding(0, pad, 0, 0);

        Button copy = new Button(this);
        copy.setText("Copy report");
        copy.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                try {
                    ClipboardManager clip = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    clip.setPrimaryClip(ClipData.newPlainText("MedAI crash report", text));
                    Toast.makeText(CrashReportActivity.this, "Copied. Paste it to support.", Toast.LENGTH_LONG).show();
                } catch (Throwable t) {
                    Toast.makeText(CrashReportActivity.this, "Could not copy. Take a screenshot instead.", Toast.LENGTH_LONG).show();
                }
            }
        });
        buttons.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button close = new Button(this);
        close.setText("Close");
        close.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                finish();
            }
        });
        buttons.addView(close, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        root.addView(buttons, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(root);
    }
}
