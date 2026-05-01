import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { staffLogin } from '../api/staffAuth';
import CustomAlert from '../components/CustomAlert';

const { width, height } = Dimensions.get('window');

const LoginScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Alert State
  const [alertConfig, setAlertConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
  }>({
    visible: false,
    title: '',
    message: '',
    type: 'info',
  });

  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => {
    setAlertConfig({ visible: true, title, message, type });
  };

  const handleLogin = async () => {
    if (!email || !password) {
      showAlert('Required', 'Please enter your email and password to continue.', 'warning');
      return;
    }

    setLoading(true);
    try {
      const result = await staffLogin(email, password);
      setLoading(false);

      if (result.status === 1 && result.data) {
        showAlert('Success', 'Login successful! Welcome back.', 'success');
        
        // Save staff data and token to AsyncStorage
        const staffObj = result.data;
        await AsyncStorage.setItem('staffData', JSON.stringify(staffObj));
        await AsyncStorage.setItem('staffToken', staffObj.token);

        setTimeout(() => {
          setAlertConfig(prev => ({ ...prev, visible: false }));
          navigation.reset({
            index: 0,
            routes: [{ name: 'Home', params: { staff: staffObj, token: staffObj.token } }],
          });
        }, 500);

      } else {
        showAlert('Access Denied', result.message || 'Invalid credentials provided.', 'error');
      }
    } catch (error) {
      setLoading(false);
      showAlert('Connection Error', 'Could not connect to the server. Please try again.', 'error');
    }
  };



  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <LinearGradient
          colors={['#D0B079', '#B8965E']}
          style={[styles.headerBackground, { paddingTop: insets.top }]}
        >
          <View style={styles.headerContent}>
            {/* Logo Wrapper */}
            <Animated.View style={styles.logoWrapper}>
              <Image 
                source={require('../public/watanstafflogo.png')} 
                style={styles.logoImage}
                resizeMode="contain"
              />
            </Animated.View>

            {/* App Branding - Perfectly Centered */}
            <Animated.View style={styles.brandingContainer}>
              <View style={styles.titleRow}>
                <Text style={{ fontSize: 24, marginRight: 8 }}>🕒</Text>
                <Text style={styles.appName}>WatanStaff</Text>
              </View>
              <Text style={styles.appSubtitle}>Restaurant Staff Management</Text>
            </Animated.View>
          </View>
        </LinearGradient>

        {/* Login Card */}
        <Animated.View 
          style={styles.formContainer}
        >
          <Text style={styles.welcomeTitle}>Sign in to your account</Text>
          <Text style={styles.welcomeSubtitle}>Enter your email and password</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputIcon}>📧</Text>
              <TextInput
                style={styles.input}
                placeholder="name@restaurant.co.uk"
                placeholderTextColor="#94A3B8"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputIcon}>🔒</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#94A3B8"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Text style={{ fontSize: 16 }}>{showPassword ? '👁️‍🗨️' : '👁️'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.row}>
            <TouchableOpacity 
              style={styles.rememberMe}
              onPress={() => setRememberMe(!rememberMe)}
            >
              <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]} />
              <Text style={styles.rememberMeText}>Remember me</Text>
            </TouchableOpacity>
            <TouchableOpacity>
              <Text style={styles.forgotPassword}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={[styles.loginButton, loading && { opacity: 0.8 }]} 
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.loginButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>

      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        onClose={() => setAlertConfig(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  headerBackground: {
    height: height * 0.45,
    width: '100%',
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 60, // Give space for the card overlap
  },
  logoWrapper: {
    width: 100,
    height: 100,
    backgroundColor: '#000000',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    marginBottom: 16,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  brandingContainer: {
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    fontSize: 30,
    fontWeight: '800',
    color: 'white',
    letterSpacing: 0.8,
  },
  appSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 6,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  formContainer: {
    backgroundColor: 'white',
    marginHorizontal: 24,
    marginTop: -80, // Integrated overlap
    borderRadius: 28,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 6,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  inputIcon: {
    marginRight: 12,
    fontSize: 18,
  },
  input: {
    flex: 1,
    color: '#1E293B',
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  rememberMe: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    marginRight: 8,
  },
  checkboxChecked: {
    backgroundColor: '#D0B079',
    borderColor: '#D0B079',
  },
  rememberMeText: {
    fontSize: 14,
    color: '#64748B',
  },
  forgotPassword: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D0B079',
  },
  loginButton: {
    backgroundColor: '#D0B079',
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D0B079',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '700',
  },
});

export default LoginScreen;
