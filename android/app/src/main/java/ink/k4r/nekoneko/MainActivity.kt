package ink.k4r.nekoneko

import android.content.Context
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
        enableEdgeToEdge()
        setContent {
            App()
        }
    }
}
