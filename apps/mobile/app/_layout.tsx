import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: true }}>
          {/* index decides login vs map by auth state; it renders no header. */}
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: 'Sign in' }} />
          <Stack.Screen name="map" options={{ title: 'Live map' }} />
          <Stack.Screen name="shift" options={{ title: 'Shift' }} />
          <Stack.Screen name="checkpoint" options={{ title: 'Checkpoint' }} />
          <Stack.Screen
            name="tracking-health"
            options={{ title: 'Tracking health' }}
          />
          {/* Disclosure is presented as a blocking modal before the OS prompt. */}
          <Stack.Screen
            name="disclosure"
            options={{ title: 'Before we start', presentation: 'modal' }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
