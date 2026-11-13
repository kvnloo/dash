// Copied to app/orb-smooth-entry.jsx ONLY inside the fleet job snapshot.
// Imports the real app renderer, provider, phase definitions and React Native Web.
import React, { Profiler, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AgentOrb } from './src/components/AgentOrb';
import { OrbActivity, OrbMotionProvider, useOrbMotion } from './src/components/OrbMotion';

const Stack = createNativeStackNavigator();
let navigation;
const commits = [];
function Fixture() {
  const [config, setConfig] = useState({ phase: 'thinking', count: 1, size: 'hero', active: true, animated: true, hidden: false });
  const { clock } = useOrbMotion();
  useEffect(() => {
    window.__ORB_HARNESS__ = {
      configure: next => setConfig(previous => ({ ...previous, ...next })),
      clock: () => clock?.value ?? null,
      commits,
      focus: focused => navigation.navigate(focused ? 'Orb' : 'Blank'),
    };
    return () => { delete window.__ORB_HARNESS__; };
  }, [clock]);
  return <View style={{ flex: 1, backgroundColor: '#0c0c0a', padding: 16, gap: 24 }}>
    <Text style={{ color: '#ECE8DF', fontSize: 16 }}>Actual AgentOrb · {config.phase} · {config.count} × {config.size}</Text>
    <OrbActivity active={config.active}>
      <Profiler id="actual-agent-orbs" onRender={(id, phase, actualDuration) => commits.push({ phase, actualDuration, at: performance.now() })}>
        <View testID="orb-fixture" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, display: config.hidden ? 'none' : 'flex' }}>
          {Array.from({ length: config.count }, (_, index) => <AgentOrb key={index} thinking={{ phase: config.phase, tool: config.phase === 'tool' ? 'terminal' : undefined }} size={config.size} animated={config.animated} />)}
        </View>
      </Profiler>
    </OrbActivity>
  </View>;
}
function Blank() { return <View style={{ flex: 1, backgroundColor: '#0c0c0a' }}><Text style={{ color: 'white' }}>Orb screen unfocused</Text></View>; }
export default function OrbSmoothFixture() {
  return <OrbMotionProvider><NavigationContainer ref={ref => { navigation = ref; }}><Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}><Stack.Screen name="Orb" component={Fixture} /><Stack.Screen name="Blank" component={Blank} /></Stack.Navigator></NavigationContainer></OrbMotionProvider>;
}
