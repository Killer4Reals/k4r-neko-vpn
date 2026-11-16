package ink.k4r.nekoneko

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import ink.k4r.nekoneko.data.Lang
import ink.k4r.nekoneko.data.Store
import ink.k4r.nekoneko.ui.App

class MainActivity : ComponentActivity() {

    /**
     * Язык выбирается до первого кадра. Менять локаль через LocalContext в
     * Compose нельзя: вместе с ним ломается поиск владельца результатов
     * активности (краш «No ActivityResultRegistryOwner»), поэтому язык
     * применяется здесь, а при смене экран пересоздаётся.
     */
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(Lang.context(newBase, Store(newBase).lang))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Постоянное уведомление туннеля — часть работы VPN: без разрешения
        // Android 13+ его не покажет, и человек не увидит, что туннель включён.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        enableEdgeToEdge()
        setContent {
            App()
        }
    }
}
