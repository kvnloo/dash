package app.dash.share

import java.io.InputStream
import java.io.OutputStream

internal const val MAX_FILE_BYTES = 25L * 1024 * 1024
internal const val MAX_BATCH_BYTES = 50L * 1024 * 1024
internal const val MAX_FILES = 8
internal const val MAX_TEXT = 60_000

// \p{Cntrl} is a Java-specific POSIX class name that Android's ICU regex engine rejects
// inside a character class [...], producing PatternSyntaxException near index 3 at the '{'.
// Use explicit hex escapes that are valid in both Java and ICU regex.
private val CNTRL_REGEX = Regex("[\\x00-\\x1F\\x7F]")

internal fun safeName(name: String): String = name
  .substringAfterLast('/').substringAfterLast('\\')
  .replace(CNTRL_REGEX, "_").take(240).ifBlank { "shared-file" }

internal fun copyBounded(input: InputStream, output: OutputStream, limit: Long): Long {
  val buffer = ByteArray(64 * 1024)
  var total = 0L
  while (true) {
    val count = input.read(buffer, 0, minOf(buffer.size.toLong(), limit - total + 1).toInt())
    if (count < 0) break
    if (count == 0) throw IllegalStateException("The shared file could not be read.")
    total += count
    require(total <= limit) { "Share size limit exceeded (25 MB per file, 50 MB total)." }
    output.write(buffer, 0, count)
  }
  require(total > 0) { "The shared file is empty." }
  return total
}
