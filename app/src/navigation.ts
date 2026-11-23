import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { WindowOrigin } from "./lib/chat-window";

export type RootStackParamList = {
  /** `home`: the dogfood home (self-development loop) over the pager. */
  Main: { tab?: number; home?: boolean } | undefined;
  /** `window`: opened from the Chats list as a window over the retained workspace (source row rect). */
  Chat: { draft?: string; window?: WindowOrigin } | undefined;
  OrchestraDetail: { orchestraId: string };
  Voice: { autostart?: boolean } | undefined;
  Approvals: undefined;
  Notices: undefined;
  ArtifactStage: { url?: string; html?: string; title?: string };
  Pair: { address?: string; code?: string; identityLink?: string } | undefined;
  Settings: { firstRun?: boolean } | undefined;
  Trace: undefined;
  /** Projects, features and tasks tracked in git (pm/events.jsonl). */
  Roadmap: undefined;
  RoadmapProject: { projectId: string; feature?: string };
  RoadmapTask: { taskId: string };
  Lab: undefined;
  /** Bots page prototype (DA-073): gem table, orrery, simple bot page, host tree. */
  BotsPage: undefined;
  SharedTheme: undefined;
  /** Every fixture of the shared kvnloo/ephemeral-ui card catalog; `page` is 1-based. */
  Gallery: { page?: number } | undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
