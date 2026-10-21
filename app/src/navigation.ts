import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Main: { tab?: number } | undefined;
  Chat: { draft?: string } | undefined;
  OrchestraDetail: { orchestraId: string };
  Voice: undefined;
  Approvals: undefined;
  ArtifactStage: { url?: string; html?: string; title?: string };
  Pair: { address?: string; code?: string; identityLink?: string } | undefined;
  Settings: { firstRun?: boolean } | undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
