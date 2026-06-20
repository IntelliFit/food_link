import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from './src/providers/AuthProvider'
import { DialogProvider } from './src/providers/DialogProvider'
import { RootNavigator } from './src/navigation/RootNavigator'
import { installConsoleLogCapture } from './src/diagnostics/consoleLogBuffer'
import { configureTextScaling } from './src/utils/textScaling'
import { colors } from './src/theme'

installConsoleLogCapture()
configureTextScaling()

export default function App() {
  const [fontsLoaded] = useFonts({
    iconfont: require('./assets/fonts/iconfont.ttf'),
  })

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <DialogProvider>
          <RootNavigator />
        </DialogProvider>
      </AuthProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
})
