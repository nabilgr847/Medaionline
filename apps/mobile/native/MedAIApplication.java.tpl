package __PACKAGE__;

import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * MedAI Hospital application object.
 *
 * <p>Installed as android:name=".MedAIApplication" in the manifest so it runs before any
 * activity. Its only job is to stop the app from vanishing without a word: every uncaught
 * exception is written to last-crash.txt and shown in CrashReportActivity (a separate
 * process, so it survives the crash) instead of the phone simply closing the app.
 *
 * <p>Reported symptom this exists for: "APK installs, but tapping the icon closes the app
 * immediately" — with no log there is nothing to fix, so the app now shows its own reason.
 */
public class MedAIApplication extends Application {

    private static final String TAG = "MedAI";
    public static final String CRASH_FILE = "last-crash.txt";

    @Override
    public void onCreate() {
        super.onCreate();
        installCrashGuard();
    }

    private void installCrashGuard() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, Throwable error) {
                try {
                    recordCrash(MedAIApplication.this, error);
                } catch (Throwable ignored) {
                    // recording must never make things worse
                }
                try {
                    openReporter(error);
                } catch (Throwable ignored) {
                    // if even the reporter cannot start, fall through to the normal death
                }
                if (previous != null) {
                    previous.uncaughtException(thread, error);
                } else {
                    android.os.Process.killProcess(android.os.Process.myPid());
                    System.exit(10);
                }
            }
        });
    }

    /** Shows the saved report in a separate process, so it is still visible after the crash. */
    private void openReporter(Throwable error) {
        Intent intent = new Intent(this, CrashReportActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        intent.putExtra(CrashReportActivity.EXTRA_TEXT, describe(error));
        startActivity(intent);
    }

    /** Where the crash text lives, so a user can send it back to us. */
    public static File crashFile(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), CRASH_FILE);
    }

    /** A copy the user can reach with a file manager / from the report screen. */
    public static File sharedCrashFile(Context context) {
        try {
            File dir = context.getApplicationContext().getExternalFilesDir(null);
            if (dir == null) return null;
            dir.mkdirs();
            return new File(dir, CRASH_FILE);
        } catch (Throwable t) {
            return null;
        }
    }

    /** Writes the full stack trace plus device details. Safe to call from any thread. */
    public static String recordCrash(Context context, Throwable error) {
        String text = describe(error);
        try {
            File file = crashFile(context);
            FileOutputStream stream = new FileOutputStream(file, false);
            OutputStreamWriter writer = new OutputStreamWriter(stream, "UTF-8");
            writer.write(text);
            writer.close();
        } catch (Throwable ignored) {
        }
        try {
            File shared = sharedCrashFile(context);
            if (shared != null) {
                FileOutputStream stream = new FileOutputStream(shared, false);
                OutputStreamWriter writer = new OutputStreamWriter(stream, "UTF-8");
                writer.write(text);
                writer.close();
            }
        } catch (Throwable ignored) {
        }
        Log.e(TAG, text);
        return text;
    }

    /** The text shown to the user and stored on the device. */
    public static String describe(Throwable error) {
        StringWriter buffer = new StringWriter();
        PrintWriter printer = new PrintWriter(buffer);
        printer.println("MedAI Hospital - startup report");
        printer.println("When:   " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()));
        printer.println("App:    MedAI Hospital (com.medai.hospital)");
        printer.println("Phone:  " + Build.MANUFACTURER + " " + Build.MODEL);
        printer.println("Android: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
        printer.println("Reason: " + (error == null ? "unknown" : error.getClass().getName() + ": " + error.getMessage()));
        printer.println();
        if (error != null) error.printStackTrace(printer);
        printer.flush();
        return buffer.toString();
    }
}
