package app.dash.share

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream

class BoundedCopyTest {
  @Test fun copiesBytesWithoutChangingThem() {
    val bytes = ByteArray(150_000) { (it % 251).toByte() }
    val output = ByteArrayOutputStream()
    assertEquals(bytes.size.toLong(), copyBounded(ByteArrayInputStream(bytes), output, bytes.size.toLong()))
    assertArrayEquals(bytes, output.toByteArray())
  }
  @Test fun stopsUnknownLengthStreamsAtTheBound() {
    var read = 0
    val infinite = object : InputStream() {
      override fun read(): Int { read++; return 1 }
    }
    val output = ByteArrayOutputStream()
    assertThrows(IllegalArgumentException::class.java) { copyBounded(infinite, output, 100) }
    assertEquals(101, read)
    assertTrue(output.size() <= 100)
  }
  @Test fun rejectsEmptyFilesAndSanitizesNames() {
    assertThrows(IllegalArgumentException::class.java) { copyBounded(ByteArrayInputStream(byteArrayOf()), ByteArrayOutputStream(), 100) }
    assertEquals("secret.txt", safeName("../../secret.txt"))
    assertEquals("secret.txt", safeName("C:\\folder\\secret.txt"))
    assertEquals("shared-file", safeName(""))
    assertTrue(safeName("x".repeat(300)).length <= 240)
  }
  /** Regression: \p{Cntrl} inside [...] crashes Android ICU regex ("near index 3"). Use [\x00-\x1F\x7F]. */
  @Test fun replacesControlCharsInFileNames() {
    // NUL (0x00), BEL (0x07), TAB (0x09), LF (0x0A), CR (0x0D), ESC (0x1B), DEL (0x7F)
    val controlChars = "\u0000\u0007\t\n\r\u001B\u007F"
    val input = "bad${controlChars}name.txt"
    val result = safeName(input)
    assertFalse("Control chars must be stripped", result.any { it.code in 0..0x1F || it.code == 0x7F })
    assertEquals("bad_______name.txt", result)
    // Pure control chars become underscores, not blank → safeName returns them as-is (not "shared-file")
    val pureCtrl = safeName(controlChars)
    assertFalse("No control chars in output", pureCtrl.any { it.code in 0..0x1F || it.code == 0x7F })
    assertEquals("_______", pureCtrl)
  }
}
