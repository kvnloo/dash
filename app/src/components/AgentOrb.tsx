import { memo } from "react";
import { View } from "react-native";
import { aodlAgentThinking } from "../lib/aodl";
import type { Thinking } from "../lib/thinking";

const AgentThinking = aodlAgentThinking();

/**
 * A thinking-orbs orb (via aodl-views) for what an agent is doing right now.
 * thinking-orbs is tuned at 20 px (inline) and 64 px (avatar); other sizes scale the 64 px orb
 * so list rows keep their 40 px rhythm.
 */
export const AgentOrb = memo(function AgentOrb({ thinking, size = 64, caption = false, label }: { thinking: Thinking; size?: number; caption?: boolean; label?: string }) {
  if (!AgentThinking) return <View accessibilityLabel={label} style={{ width: size, height: size }} />;
  if (size === 20 || size === 64) {
    return <View accessibilityLabel={label}><AgentThinking phase={thinking.phase} tool={thinking.tool} size={size} caption={caption} /></View>;
  }
  // AgentThinking reserves a 6 px rim slot around a 64 px orb: 76 px box.
  const scale = size / 76;
  return (
    <View accessibilityLabel={label} style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ transform: [{ scale }] }}>
        <AgentThinking phase={thinking.phase} tool={thinking.tool} size={64} />
      </View>
    </View>
  );
});
