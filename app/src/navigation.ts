import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Chat: undefined;
  Conversations: undefined;
  Pair: undefined;
  Settings: { firstRun?: boolean } | undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
