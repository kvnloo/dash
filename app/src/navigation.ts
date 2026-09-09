import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Main: { tab?: number } | undefined;
  Chat: { draft?: string } | undefined;
  OrchestraDetail: { orchestraId: string };
  Conversations: undefined;
  Voice: undefined;
  Pair: undefined;
  Settings: { firstRun?: boolean } | undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
