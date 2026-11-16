package ink.k4r.nekoneko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import ink.k4r.nekoneko.R
import ink.k4r.nekoneko.data.Lang
import ink.k4r.nekoneko.data.Store

/**
 * Корень интерфейса: три экрана внизу, как на ПК в боковом меню. Держим это
 * без библиотеки навигации — экранов мало, а лишний слой тут ничего не даёт.
 */
@Composable
fun App() {
    val base = LocalContext.current
    val store = remember { Store(base) }
    var tab by remember { mutableStateOf(0) }
    var theme by remember { mutableStateOf(store.theme) }
    var lang by remember { mutableStateOf(store.lang) }
    // Язык меняем на месте, без перезапуска: Compose перерисует дерево с
    // контекстом выбранной локали, и строки придут уже на новом языке.
    val localized = remember(lang, base) { Lang.context(base, lang) }
    val configuration = remember(localized) { localized.resources.configuration }

    CompositionLocalProvider(
        LocalContext provides localized,
        LocalConfiguration provides configuration,
    ) {
        NekoTheme(theme) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.background)
                    .statusBarsPadding()
                    .navigationBarsPadding(),
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    when (tab) {
                        1 -> SplitScreen(store)
                        2 -> SettingsScreen(
                            store = store,
                            theme = theme,
                            onTheme = { theme = it },
                            lang = lang,
                            onLang = {
                                lang = it
                                store.lang = it
                            },
                        )
                        else -> HomeScreen(store)
                    }
                }
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    val tabs = listOf(
                        Triple(R.string.tab_home, Icons.Filled.Home, 0),
                        Triple(R.string.tab_split, Icons.Filled.List, 1),
                        Triple(R.string.tab_settings, Icons.Filled.Settings, 2),
                    )
                    for ((labelRes, icon, index) in tabs) {
                        NavigationBarItem(
                            selected = tab == index,
                            onClick = { tab = index },
                            icon = { Icon(icon, contentDescription = null) },
                            label = { Text(stringResource(labelRes), fontSize = 12.sp) },
                        )
                    }
                }
            }
        }
    }
}

/** Версия приложения в одном месте. */
object Build {
    const val APP_VERSION = "0.1.0"
}
