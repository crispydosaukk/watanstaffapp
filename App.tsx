import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import Screens
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import ProfileScreen from './screens/ProfileScreen';
import NotificationScreen from './screens/NotificationScreen';

import { auth } from './lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { requestUserPermission, setupNotificationListeners } from './lib/NotificationService';

const Stack = createNativeStackNavigator();

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [initialRoute, setInitialRoute] = useState('Login');
  const [initialParams, setInitialParams] = useState({});

  useEffect(() => {
    // Listen for Firebase Auth changes
    const checkSession = async (user: any) => {
      try {
        if (user) {
          const staffDataStr = await AsyncStorage.getItem('staffData');
          if (staffDataStr) {
            const staffData = JSON.parse(staffDataStr);
            setInitialParams({ staff: staffData });
            setInitialRoute('Home');
            console.log('[Auth] Session restored:', staffData.full_name);
          } else {
            console.log('[Auth] Firebase user found but no local profile data');
            setInitialRoute('Login');
          }
        } else {
          console.log('[Auth] No active session found');
          setInitialRoute('Login');
        }
      } catch (err) {
        console.error('[Auth] Error during session check:', err);
        setInitialRoute('Login');
      } finally {
        setIsLoading(false);
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      checkSession(user);
    });

    // Initialize Notifications
    requestUserPermission();
    const unsubscribeNotifications = setupNotificationListeners();

    return () => {
      unsubscribeAuth();
      unsubscribeNotifications();
    };
  }, []);


  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1221' }}>
        <ActivityIndicator size="large" color="#D0B079" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <Stack.Navigator 
            initialRouteName={initialRoute}
            screenOptions={{
              headerShown: false,
              animation: 'none',
            }}
          >
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Home" component={HomeScreen} initialParams={initialParams} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Notification" component={NotificationScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
