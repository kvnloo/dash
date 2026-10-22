package app.dash.share

import android.content.ClipData
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ProviderInfo
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE)
class ShareInboxTest {
  private lateinit var context: Context
  @Before fun setup() {
    context = RuntimeEnvironment.getApplication()
    File(context.cacheDir, "incoming-shares").deleteRecursively()
    ShadowContentResolver.registerProviderInternal("dash-test", TestProvider().apply {
      attachInfo(context, ProviderInfo().apply { authority = "dash-test"; exported = true; grantUriPermissions = true })
    })
  }
  @Test fun receivesTextAndUrlsWithoutFetching() {
    val result = JSONObject(ShareInbox(context).consume(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://example.com")))
    assertEquals("https://example.com", result.getString("text"))
    assertEquals(0, result.getJSONArray("files").length())
  }
  @Test fun receivesTextPlainFileAndMixedTextUsingGrantedContentUris() {
    val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_STREAM, Uri.parse("content://dash-test/file"))
      .putExtra(Intent.EXTRA_TEXT, "caption").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val inbox = ShareInbox(context)
    val result = JSONObject(inbox.consume(intent))
    assertEquals("caption", result.getString("text"))
    assertEquals(0, result.getJSONArray("errors").length())
    val shared = result.getJSONArray("files").getJSONObject(0)
    assertEquals("notes.txt", shared.getString("name"))
    assertEquals("actual bytes", File(Uri.parse(shared.getString("uri")).path!!).readText())
    inbox.discard(result.getString("id"))
    assertFalse(File(Uri.parse(shared.getString("uri")).path!!).exists())
  }
  @Test fun clipDataWebUrlsStayTextWithoutNetworkResolution() {
    val intent = Intent(Intent.ACTION_SEND).setType("text/plain")
    intent.clipData = ClipData.newRawUri("url", Uri.parse("https://example.com/page"))
    val result = JSONObject(ShareInbox(context).consume(intent))
    assertEquals("https://example.com/page", result.getString("text"))
    assertEquals(0, result.getJSONArray("files").length())
    assertEquals(0, result.getJSONArray("errors").length())
  }
  @Test fun acceptsMultipleArbitraryFilesDeduplicatingClipData() {
    val a = Uri.parse("content://dash-test/a")
    val b = Uri.parse("content://dash-test/b")
    val intent = Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*").putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(a, b))
    intent.clipData = ClipData.newUri(context.contentResolver, "a", a)
    val result = JSONObject(ShareInbox(context).consume(intent))
    assertEquals(2, result.getJSONArray("files").length())
  }
  @Test fun clipDataOnlyFilesWorkAndFileUrisAreRejected() {
    val intent = Intent(Intent.ACTION_SEND).setType("application/zip")
    intent.clipData = ClipData.newUri(context.contentResolver, "file", Uri.parse("content://dash-test/a"))
    assertEquals(1, JSONObject(ShareInbox(context).consume(intent)).getJSONArray("files").length())
    val invalid = JSONObject(ShareInbox(context).consume(Intent(Intent.ACTION_SEND).setType("*/*").putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///etc/passwd"))))
    assertEquals(0, invalid.getJSONArray("files").length())
    assertEquals(1, invalid.getJSONArray("errors").length())
  }
  @Test fun inaccessibleAndOversizeProvidersReturnErrorsAndNoPartialFiles() {
    for (name in listOf("denied", "oversize")) {
      val result = JSONObject(ShareInbox(context).consume(Intent(Intent.ACTION_SEND).setType("*/*").putExtra(Intent.EXTRA_STREAM, Uri.parse("content://dash-test/$name"))))
      assertEquals(0, result.getJSONArray("files").length())
      assertEquals(1, result.getJSONArray("errors").length())
    }
  }
  @Test fun unknownLengthProviderIsCopiedAndTruncatedProviderIsRejected() {
    fun receive(name: String) = JSONObject(ShareInbox(context).consume(Intent(Intent.ACTION_SEND).setType("*/*").putExtra(Intent.EXTRA_STREAM, Uri.parse("content://dash-test/$name"))))
    assertEquals(1, receive("unknown").getJSONArray("files").length())
    assertEquals(0, receive("truncated").getJSONArray("files").length())
    assertEquals(1, receive("truncated").getJSONArray("errors").length())
  }
  @Test fun limitsFileCountAndTextAndExpiresOldCache() {
    val old = File(context.cacheDir, "incoming-shares/old").apply { mkdirs() }
    File(old, "data").writeText("old")
    old.setLastModified(1)
    val uris = ArrayList((1..9).map { Uri.parse("content://dash-test/file$it") })
    val intent = Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*").putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris).putExtra(Intent.EXTRA_TEXT, "x".repeat(MAX_TEXT + 1))
    val result = JSONObject(ShareInbox(context).consume(intent))
    assertEquals(MAX_FILES, result.getJSONArray("files").length())
    assertEquals(MAX_TEXT, result.getString("text").length)
    assertTrue(result.getJSONArray("errors").length() > 0)
    assertFalse(old.exists())
  }
  class TestProvider : ContentProvider() {
    override fun onCreate() = true
    override fun getType(uri: Uri) = "application/octet-stream"
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?) = MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply {
      addRow(arrayOf("../../notes.txt", when (uri.lastPathSegment) { "oversize" -> MAX_FILE_BYTES + 1; "unknown" -> null; "truncated" -> 13L; else -> 12L }))
    }
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
      if (uri.lastPathSegment == "denied") throw SecurityException("no grant")
      val file = File(requireNotNull(context).cacheDir, "source").apply { writeText("actual bytes") }
      return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
  }
}
