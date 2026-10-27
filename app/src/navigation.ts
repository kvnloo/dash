import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { WindowOrigin } from "./lib/chat-window";

export type RootStackParamList = {
  Main: { tab?: number } | undefined;
  /** `window`: opened from the Chats list as a window over the retained workspace (source row rect). */
  Chat: { draft?: string; window?: WindowOrigin } | undefined;
  OrchestraDetail: { orchestraId: string };
  Voice: { autostart?: boolean } | undefined;
  Approvals: undefined;
  ArtifactStage: { url?: string; html?: string; title?: string };
  Pair: { address?: string; code?: string; identityLink?: string } | undefined;
  Settings: { firstRun?: boolean } | undefined;
  Trace: undefined;
  Lab: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
