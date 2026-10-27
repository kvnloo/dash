import {
  FadeInUp,
  FadeOutUp,
  ReduceMotion,
} from "react-native-reanimated";
import {
  BOT_CHAT_MS,
  BOT_CHAT_OFFSETS,
  GEL,
  SNAP,
} from "../motion";

export { BOT_CHAT_MS, BOT_CHAT_OFFSETS, GEL, MOTION_MS, SNAP } from "../motion";

const botChatSpring = { ...SNAP, reduceMotion: ReduceMotion.System };

/** Bot-chat chrome enter. Transform + opacity only. Never FlashList rows. */
export const botChatEnter = FadeInUp.springify()
  .mass(botChatSpring.mass)
  .stiffness(SNAP.stiffness)
  .damping(SNAP.damping)
  .withInitialValues({
    opacity: 0,
    transform: [{ translateY: BOT_CHAT_OFFSETS.enterY }],
  })
  .reduceMotion(ReduceMotion.System);

/** Bot-chat chrome exit. Duration from MOTION_MS via BOT_CHAT_MS (<300ms). */
export const botChatExit = FadeOutUp.duration(BOT_CHAT_MS.exit)
  .withInitialValues({
    opacity: 1,
    transform: [{ translateY: 0 }],
  })
  .reduceMotion(ReduceMotion.System);

export function staggerBotChat(index: number) {
  return botChatEnter.delay(index * BOT_CHAT_MS.stagger);
}

/** Sheet-style settle uses the existing nav gel, not a third spring. */
export const botChatGel = { ...GEL, reduceMotion: ReduceMotion.System };
export const botChatSnap = botChatSpring;
