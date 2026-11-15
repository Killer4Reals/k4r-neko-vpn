package ink.k4r.nekoneko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.drawable.toBitmap
import ink.k4r.nekoneko.R
import ink.k4r.nekoneko.data.Apps
import ink.k4r.nekoneko.data.InstalledApp
import ink.k4r.nekoneko.data.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Разделение по программам. На Android его делает сама система: приложение
 * передаёт ядру список пакетов, а не правила по именам процессов, как на ПК.
 */
@Composable
fun SplitScreen(store: Store) {
    val context = LocalContext.current
    var apps by remember { mutableStateOf(emptyList<InstalledApp>()) }
    var query by remember { mutableStateOf("") }
    var only by remember { mutableStateOf(store.splitMode == "only") }
    var chosen by remember { mutableStateOf(store.chosen()) }

    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.IO) { Apps.launchable(context) }
    }

    val visible = if (query.isBlank()) apps else apps.filter {
        it.label.contains(query, ignoreCase = true) || it.packageName.contains(query, ignoreCase = true)
    }

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        SectionTitle(stringResource(R.string.tab_split))

        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.split_title),
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 14.sp,
                )
                Text(
                    text = stringResource(if (only) R.string.split_only_hint else R.string.split_all_hint),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp,
                )
            }
            Switch(
                checked = only,
                onCheckedChange = {
                    only = it
                    store.splitMode = if (it) "only" else "all"
                },
            )
        }

        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            singleLine = true,
            label = { Text(stringResource(R.string.split_search), fontSize = 11.sp) },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = if (chosen.isEmpty() && only) stringResource(R.string.split_none)
            else stringResource(R.string.split_chosen, chosen.size),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
        )
        Spacer(Modifier.height(6.dp))

        if (apps.isEmpty()) {
            Text(
                text = stringResource(R.string.split_empty),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
            )
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxSize()) {
            items(visible, key = { it.packageName }) { app ->
                val active = app.packageName in chosen
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(
                            if (active) MaterialTheme.colorScheme.surfaceVariant
                            else MaterialTheme.colorScheme.surface
                        )
                        .border(
                            1.dp,
                            if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                            RoundedCornerShape(12.dp),
                        )
                        .clickable {
                            val next = chosen.toMutableSet()
                            if (active) next.remove(app.packageName) else next.add(app.packageName)
                            chosen = next
                            store.setChosen(next)
                        }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val icon = remember(app.packageName) {
                        try {
                            context.packageManager.getApplicationIcon(app.packageName)
                                .toBitmap(72, 72).asImageBitmap()
                        } catch (e: Exception) {
                            null
                        }
                    }
                    if (icon != null) {
                        androidx.compose.foundation.Image(
                            bitmap = icon,
                            contentDescription = null,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.size(26.dp),
                        )
                    } else {
                        Box(Modifier.size(26.dp))
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = app.label,
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = 14.sp,
                        )
                        Text(
                            text = app.packageName,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 10.sp,
                        )
                    }
                    Text(
                        text = if (active) "✓" else "",
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                    )
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}
