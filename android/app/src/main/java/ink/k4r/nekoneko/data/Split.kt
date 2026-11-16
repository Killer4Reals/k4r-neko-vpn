package ink.k4r.nekoneko.data

/**
 * Кого пускать в туннель. Пустой список разрешённых означает «все приложения» —
 * это правило Android, и его легко нарушить, добавив в список хотя бы себя.
 * Поэтому себя добавляем только тогда, когда человек выбрал конкретные
 * программы: иначе «только выбранные» тихо превращалось бы в «только это
 * приложение», а браузер и мессенджеры шли бы напрямую.
 */
object Split {

    const val ONLY = "only"

    /** Кому разрешён туннель; пустой список — всем. */
    fun allowed(mode: String, chosen: Set<String>, self: String): List<String> =
        if (mode == ONLY && chosen.isNotEmpty()) (chosen + self).toList() else emptyList()

    /** Кого исключить из туннеля: в режиме «все, кроме выбранных». */
    fun excluded(mode: String, chosen: Set<String>): List<String> =
        if (mode == ONLY) emptyList() else chosen.toList()
}
