import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Main: undefined;
  Chat: { draft?: string } | undefined;
  OrchestraDetail: { orchestraId: string };
  Conversations: undefined;
  Pair: undefined;
  Settings: { firstRun?: boolean } | undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
