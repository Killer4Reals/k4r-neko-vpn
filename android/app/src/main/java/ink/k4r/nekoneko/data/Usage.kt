package ink.k4r.nekoneko.data

import ink.k4r.nekoneko.vpn.Jso
import ink.k4r.nekoneko.vpn.Jsons

/** Сколько прошло через туннель за один день. */
data class Day(val day: String, val rx: Long, val tx: Long) {
    val total: Long get() = rx + tx
}

/**
 * Учёт трафика по дням. Считаем только то, что прошло через туннель: цифры
 * берём у ядра (счётчики интерфейса), а не у провайдера и не «на глазок».
 * Храним последние [KEEP] дней, чтобы файл настроек не рос бесконечно.
 */
object Usage {

    const val KEEP = 30

    fun parse(json: String): List<Day> {
        if (json.isBlank()) return emptyList()
        val root = try {
            Jsons.read(json)
        } catch (e: Exception) {
            return emptyList()
        }
        @Suppress("UNCHECKED_CAST")
        val items = root as? List<Any?> ?: return emptyList()
        val out = ArrayList<Day>(items.size)
        for (item in items) {
            val map = item as? Map<*, *> ?: continue
            val day = (map["day"] as? String).orEmpty()
            if (day.length != 10) continue
            out += Day(day, number(map["rx"]), number(map["tx"]))
        }
        return out.sortedBy { it.day }
    }

    fun write(list: List<Day>): String {
        val array = Jso.arr()
        for (day in list) {
            array.add(Jso.obj().put("day", day.day).put("rx", day.rx).put("tx", day.tx))
        }
        return array.toString()
    }

    /** Прибавить байты к дню; день появляется, если его ещё не было. */
    fun add(list: List<Day>, day: String, rx: Long, tx: Long): List<Day> {
        if (rx <= 0 && tx <= 0) return list
        val index = list.indexOfFirst { it.day == day }
        val next = if (index < 0) {
            list + Day(day, rx.coerceAtLeast(0), tx.coerceAtLeast(0))
        } else {
            list.toMutableList().also {
                val old = it[index]
                it[index] = old.copy(
                    rx = old.rx + rx.coerceAtLeast(0),
                    tx = old.tx + tx.coerceAtLeast(0),
                )
            }
        }
        return keep(next)
    }

    /** Оставить только последние [KEEP] дней. */
    fun keep(list: List<Day>): List<Day> =
        if (list.size <= KEEP) list else list.sortedBy { it.day }.takeLast(KEEP)

    /** Последние [days] дней по порядку, начиная с самого раннего. */
    fun window(list: List<Day>, days: Int): List<Day> =
        list.sortedBy { it.day }.takeLast(days.coerceAtLeast(1))

    fun total(list: List<Day>): Long = list.sumOf { it.total }

    /** Наибольший день — чтобы нарисовать столбики в одном масштабе. */
    fun peak(list: List<Day>): Long = list.maxOfOrNull { it.total } ?: 0

    private fun number(value: Any?): Long = (value as? Number)?.toLong() ?: 0
}
