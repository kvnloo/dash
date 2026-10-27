package app.dash.glass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GlassRadiiTest {
  @Test fun belowApi31IsUnsupportedAndApplyNothing() {
    val p = GlassRadii.plan(30, true, 60, 40)
    assertEquals(GlassRadii.Mode.UNSUPPORTED, p.mode)
    assertEquals(0, p.backgroundPx); assertEquals(0, p.behindPx); assertFalse(p.blurBehindFlag)
  }

  @Test fun batterySaverDisablesBlurLive() {
    val p = GlassRadii.plan(37, false, 60, 40)
    assertEquals(GlassRadii.Mode.DISABLED, p.mode)
    assertEquals(0, p.backgroundPx); assertFalse(p.blurBehindFlag)
  }

  @Test fun enabledAppliesBothAndFlagOnlyWithBehindRadius() {
    val p = GlassRadii.plan(37, true, 60, 40)
    assertEquals(GlassRadii.Mode.BLUR, p.mode)
    assertEquals(60, p.backgroundPx); assertEquals(40, p.behindPx); assertTrue(p.blurBehindFlag)
    assertFalse(GlassRadii.plan(37, true, 60, 0).blurBehindFlag)
  }

  @Test fun dpToPxClampsAndRounds() {
    assertEquals(84, GlassRadii.toPx(28.0, 3f))
    assertEquals(360, GlassRadii.toPx(500.0, 3f))
    assertEquals(0, GlassRadii.toPx(-4.0, 3f))
    assertEquals(0, GlassRadii.toPx(Double.NaN, 3f))
  }
}
