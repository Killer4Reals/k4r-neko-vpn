package ink.k4r.nekoneko.vpn

import android.content.Intent
import android.graphics.drawable.Icon
import android.net.VpnService
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.content.ContextCompat
import ink.k4r.nekoneko.R
import ink.k4r.nekoneko.data.Store

/**
 * Плитка в шторке: включить и выключить туннель, не открывая приложение.
 * Состояние берём из [TunnelState], а не из своего флага — иначе плитка
 * показывала бы «включено» при мёртвом туннеле.
 */
class TunnelTile : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        render()
    }

    override fun onClick() {
        super.onClick()
        val running = TunnelState.state.value.phase == TunnelState.Phase.Connected ||
            TunnelState.state.value.phase == TunnelState.Phase.Connecting
        if (running) {
            startService(Intent(this, TunnelService::class.java).setAction(TunnelService.ACTION_STOP))
        } else {
            if (Store(this).profile() == null) return
            val permission = VpnService.prepare(this)
            if (permission != null) {
                // Без разрешения плитка открывает приложение: диалог показывает оно
                val open = Intent(this, ink.k4r.nekoneko.MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivityAndCollapse(open)
                return
            }
            ContextCompat.startForegroundService(
                this,
                Intent(this, TunnelService::class.java).setAction(TunnelService.ACTION_START),
            )
        }
        render()
    }

    private fun render() {
        val tile = qsTile ?: return
        val phase = TunnelState.state.value.phase
        tile.state = when (phase) {
            TunnelState.Phase.Connected, TunnelState.Phase.Connecting -> Tile.STATE_ACTIVE
            else -> Tile.STATE_INACTIVE
        }
        tile.label = getString(R.string.app_name)
        tile.icon = Icon.createWithResource(this, R.drawable.ic_tile)
        tile.updateTile()
    }
}
