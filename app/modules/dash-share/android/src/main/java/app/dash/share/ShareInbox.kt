package app.dash.share

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

internal class ShareInbox(private val context: Context) {
  private val root get() = File(context.cacheDir, "incoming-shares")

  fun consume(intent: Intent): String {
    require(intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) { "Unsupported share action." }
    root.mkdirs()
    root.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 60 * 60 * 1000L }?.forEach { it.deleteRecursively() }
    val cachedBytes = root.walkTopDown().filter { it.isFile }.sumOf { it.length() }
    val id = UUID.randomUUID().toString()
    val dir = File(root, id).apply { mkdirs() }
    val errors = JSONArray()
    val files = JSONArray()
    val uris = linkedSetOf<Uri>()
    val texts = mutableListOf<String>()
    fun addUri(uri: Uri?) {
      if (uri == null || uris.contains(uri)) return
      if (uri.scheme == "https" || uri.scheme == "http") {
        val room = MAX_TEXT - texts.sumOf { it.length }
        if (room > 0) texts.add(uri.toString().take(room))
        return
      }
      if (uris.size >= MAX_FILES) { if (errors.length() == 0) errors.put("Up to 8 files per share."); return }
      uris.add(uri)
    }
    val extraText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
    if (!extraText.isNullOrBlank()) texts.add(extraText.take(MAX_TEXT))
    if ((extraText?.length ?: 0) > MAX_TEXT) errors.put("Shared text was truncated to 60,000 characters.")
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      val streams = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
      streams?.take(MAX_FILES + 1)?.forEach { addUri(it) }
    } else {
      val stream = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      addUri(stream)
    }
    intent.clipData?.let { clip ->
      for (index in 0 until minOf(clip.itemCount, MAX_FILES + 1)) {
        val item = clip.getItemAt(index)
        addUri(item.uri)
        if (extraText.isNullOrBlank() && texts.sumOf { it.length } < MAX_TEXT) {
          item.text?.toString()?.take(MAX_TEXT - texts.sumOf { it.length })?.let { texts.add(it) }
        }
      }
    }
    var total = 0L
    uris.forEachIndexed { index, uri ->
      var target: File? = null
      try {
        require(uri.scheme == "content") { "Only granted Android content URIs are accepted. Share again from Files." }
        var name = "shared-file-${index + 1}"
        var declaredSize: Long? = null
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = safeName(cursor.getString(nameIndex))
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) declaredSize = cursor.getLong(sizeIndex).takeIf { it >= 0 }
          }
        }
        val limit = minOf(MAX_FILE_BYTES, MAX_BATCH_BYTES - total, 200L * 1024 * 1024 - cachedBytes - total)
        require(limit > 0) { "Dash share cache is full. Discard old shares or clear Dash's cache in Android settings." }
        require(declaredSize == null || declaredSize!! <= limit) { "Share size limit exceeded (25 MB per file, 50 MB total)." }
        val destination = File(dir, "$index-${safeName(name)}")
        target = destination
        val size = context.contentResolver.openInputStream(uri)?.use { input ->
          destination.outputStream().use { output -> copyBounded(input, output, limit) }
        } ?: throw IllegalStateException("The source did not grant file access. Share it again.")
        require(declaredSize == null || declaredSize == size) { "Shared file changed or could not be read completely. Share it again." }
        total += size
        val mime = (context.contentResolver.getType(uri) ?: intent.type)?.takeUnless { it.contains('*') } ?: "application/octet-stream"
        files.put(JSONObject().put("uri", Uri.fromFile(destination).toString()).put("name", name)
          .put("mime", mime).put("size", size))
      } catch (error: Exception) {
        target?.delete()
        errors.put("File ${index + 1}: ${if (error is SecurityException) "Access expired. Share the file again." else error.message ?: "Could not read this file."}")
      }
    }
    if (files.length() == 0) dir.deleteRecursively()
    return JSONObject().put("id", id).put("text", texts.distinct().joinToString("\n").take(MAX_TEXT)).put("files", files).put("errors", errors).toString()
  }

  fun discard(id: String) {
    require(Regex("[a-f0-9-]{36}").matches(id))
    File(root, id).deleteRecursively()
  }
}
