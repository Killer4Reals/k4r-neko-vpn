package ink.k4r.nekoneko.data

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager

/**
 * Установленные программы, которые вообще можно пустить в туннель или мимо него.
 * Список строится по ярлыкам в меню: системные службы без ярлыка пользователю
 * всё равно не нужны, а список из трёхсот строк только мешает.
 */
data class InstalledApp(
    val packageName: String,
    val label: String,
)

object Apps {

    fun launchable(context: Context): List<InstalledApp> {
        val manager = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val found = try {
            manager.queryIntentActivities(intent, 0)
        } catch (e: Exception) {
            emptyList()
        }
        return found
            .map { it.activityInfo.applicationInfo }
            .distinctBy { it.packageName }
            .map { info -> InstalledApp(info.packageName, labelOf(manager, info)) }
            .sortedBy { it.label.lowercase() }
    }

    private fun labelOf(manager: PackageManager, info: ApplicationInfo): String = try {
        manager.getApplicationLabel(info).toString()
    } catch (e: Exception) {
        info.packageName
    }
}
