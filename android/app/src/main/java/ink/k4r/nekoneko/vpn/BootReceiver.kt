package ink.k4r.nekoneko.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.VpnService
import androidx.core.content.ContextCompat
import ink.k4r.nekoneko.data.Store

/**
 * Поднимает туннель после перезагрузки, если владелец этого захотел.
 * Разрешение на VPN система помнит, а вот запуск после ребута — нет;
 * поэтому включаем только когда в настройках стоит «включать при старте»
 * и профиль уже загружен.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }
        val store = Store(context)
        if (!store.autoStart) return
        if (store.profile() == null) return
        // Если система ещё не дала разрешение — молча выходим, экран сам попросит
        if (VpnService.prepare(context) != null) return
        ContextCompat.startForegroundService(
            context,
            Intent(context, TunnelService::class.java).setAction(TunnelService.ACTION_START),
        )
    }
}
