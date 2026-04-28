import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  Image,
  PermissionsAndroid,
  Platform,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { 
  FadeInUp, 
  FadeInDown, 
  useAnimatedStyle, 
  withSpring, 
  withSequence,
  useSharedValue,
} from 'react-native-reanimated';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Geolocation from '@react-native-community/geolocation';
import { BASE_URL, GOOGLE_MAPS_API_KEY } from '../api/config';
import CustomAlert from '../components/CustomAlert';

const { width, height } = Dimensions.get('window');

// ─── Helpers ────────────────────────────────────────────────────────────────

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
};

const formatTime = (date: Date): string => {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const formatDuration = (minutes: number): string => {
  const absMin = Math.max(0, minutes);
  const h = Math.floor(absMin / 60);
  const m = absMin % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
};

const minutesBetween = (from: string | Date, to: Date): number => {
  const start = new Date(from).getTime();
  const end = to.getTime();
  const diff = Math.floor((end - start) / 60000);
  return Math.max(0, diff);
};

// ─── Component ──────────────────────────────────────────────────────────────

const HomeScreen = ({ navigation, route }: any) => {
  const insets = useSafeAreaInsets();
  const staff = route?.params?.staff;
  const token = route?.params?.token;

  const [isClockedIn, setIsClockedIn] = useState(false);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [shiftMinutes, setShiftMinutes] = useState(0);
  const [yesterdayLog, setYesterdayLog] = useState<any[]>([]);
  const [todayLog, setTodayLog] = useState<any[]>([]);
  const [currentLocation, setCurrentLocation] = useState('Detecting location...');
  const [greeting, setGreeting] = useState(getGreeting());
  const [currentDate, setCurrentDate] = useState(new Date());
  const [clockLoading, setClockLoading] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [staffData, setStaffData] = useState(staff);
  const [authToken, setAuthToken] = useState(token);
  const [showConfirmLogout, setShowConfirmLogout] = useState(false);
  
  // Custom Alert State
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    message: '',
    type: 'info' as 'success' | 'error' | 'warning' | 'info' | 'confirm',
  });

  const scale = useSharedValue(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Update greeting & date every minute ──
  useEffect(() => {
    const tick = setInterval(() => {
      setGreeting(getGreeting());
      setCurrentDate(new Date());
    }, 60000);
    return () => clearInterval(tick);
  }, []);

  // ── Shift duration live timer ──
  const startTimer = useCallback((clockInTime: string, previousMinutes: number = 0) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const updateTime = () => {
      setShiftMinutes(previousMinutes + minutesBetween(clockInTime, new Date()));
    };
    updateTime();
    timerRef.current = setInterval(updateTime, 60000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setShiftMinutes(0);
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Load session/token if missing ──
  useEffect(() => {
    const loadData = async () => {
      if (!authToken || !staffData) {
        console.log('[Home] Missing token/staff in params, checking AsyncStorage...');
        const storedStaff = await AsyncStorage.getItem('staffData');
        const storedToken = await AsyncStorage.getItem('staffToken');
        if (storedStaff) setStaffData(JSON.parse(storedStaff));
        if (storedToken) setAuthToken(storedToken);
      }
    };
    loadData();
  }, [authToken, staffData]);

  // ── Fetch session status on mount ──
  const fetchSessionStatus = useCallback(async () => {
    if (!authToken) {
      console.log('[Home] No token available for session status fetch');
      return;
    }
    try {
      console.log('[Home] Fetching session status from:', `${BASE_URL}/staff/session-status`);
      const res = await fetch(`${BASE_URL}/staff/session-status`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();
      console.log('[Home] Session status response:', json);
      if (json.status === 1) {
        const { activeSession: session, yesterdayLog: yLog, todayLog: tLog } = json.data;
        setYesterdayLog(yLog || []);
        setTodayLog(tLog || []);
        
        const previousMinutes = (tLog || []).reduce((sum: number, s: any) => sum + (s.total_minutes || 0), 0);
        
        if (session) {
          setActiveSession(session);
          setIsClockedIn(true);
          startTimer(session.clock_in, previousMinutes);
        } else {
          setIsClockedIn(false);
          setActiveSession(null);
          stopTimer();
          setShiftMinutes(previousMinutes);
        }
      }
    } catch (err) {
      console.warn('Session fetch error:', err);
    } finally {
      setSessionLoaded(true);
    }
  }, [authToken, startTimer, stopTimer]);

  useEffect(() => {
    fetchSessionStatus();
  }, [fetchSessionStatus]);

  // ── Location ──
  useEffect(() => {
    const requestLocationPermission = async () => {
      if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: 'Location Permission',
              message: 'App needs access to your location.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            },
          );
          if (granted === PermissionsAndroid.RESULTS.GRANTED) getCurrentLocation();
          else setCurrentLocation('Location permission denied');
        } catch (err) {
          console.warn(err);
        }
      } else {
        getCurrentLocation();
      }
    };

    const getCurrentLocation = () => {
      Geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude } = position.coords;
          reverseGeocode(latitude, longitude);
        },
        error => {
          console.log(error);
          setCurrentLocation('Unable to fetch GPS');
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 }
      );
    };

    const reverseGeocode = async (latitude: number, longitude: number) => {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`
        );
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          setCurrentLocation(data.results[0].formatted_address);
        } else {
          setCurrentLocation('Unknown Location');
        }
      } catch (error) {
        setCurrentLocation('Location lookup failed');
      }
    };

    requestLocationPermission();
  }, []);

  // ── Helpers ──
  const getFirstName = (fullName: string) => {
    if (!fullName) return 'Staff';
    return fullName.split(' ')[0];
  };

  const performClockAction = async () => {
    if (clockLoading || !authToken) return;
    setClockLoading(true);
    scale.value = withSequence(withSpring(1.2), withSpring(1));

    try {
      const endpoint = !isClockedIn ? '/staff/clock-in' : '/staff/clock-out';
      console.log(`[Home] Attempting ${isClockedIn ? 'Clock-Out' : 'Clock-In'} at:`, `${BASE_URL}${endpoint}`);
      
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      });
      
      const json = await res.json();
      console.log(`[Home] ${endpoint} response:`, json);

      if (json.status === 1) {
        if (!isClockedIn) {
          // CLOCK IN Success
          const session = json.data;
          setActiveSession(session);
          setIsClockedIn(true);
          
          // Calculate previous minutes from today's log before starting timer
          const previousMinutes = todayLog.reduce((sum: number, s: any) => sum + (s.total_minutes || 0), 0);
          startTimer(session.clock_in, previousMinutes);
        } else {
          // CLOCK OUT Success
          setIsClockedIn(false);
          setActiveSession(null);
          stopTimer();
          fetchSessionStatus();
        }
      } else {
        // Clean up professional message
        let msg = json.message || 'Operation failed';
        if (msg.includes('Midnight to Midnight')) {
          msg = 'Daily shift limit reached. You can only CLOCK IN once per day. Please contact your manager for assistance.';
        }
        
        setAlertConfig({
          visible: true,
          title: 'SHIFT LIMIT',
          message: msg,
          type: 'warning',
        });
      }
    } catch (err) {
      console.warn('Clock toggle error:', err);
      setAlertConfig({
        visible: true,
        title: 'CONNECTION ERROR',
        message: 'Unable to connect to the server. Please check your internet.',
        type: 'error',
      });
    } finally {
      setClockLoading(false);
    }
  };

  // ── Clock toggle ──
  const handleClockToggle = async () => {
    if (clockLoading) return;
    if (!authToken) {
      setAlertConfig({
        visible: true,
        title: 'ERROR',
        message: 'Authentication token missing. Please log in again.',
        type: 'error',
      });
      return;
    }

    if (isClockedIn) {
      setShowConfirmLogout(true);
    } else {
      performClockAction();
    }
  };

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // ── Yesterday summary ──
  const yesterdayIn = yesterdayLog.length > 0
    ? formatTime(new Date(yesterdayLog[0].clock_in))
    : '--';
  const yesterdayOut = yesterdayLog.length > 0 && yesterdayLog[yesterdayLog.length - 1].clock_out
    ? formatTime(new Date(yesterdayLog[yesterdayLog.length - 1].clock_out))
    : '--';
  const yesterdayTotal = yesterdayLog.reduce((sum: number, r: any) => sum + (r.total_minutes || 0), 0);
  const yesterdayDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  })();

  // ── Shift card label ──
  const shiftLabel = isClockedIn ? 'SHIFT DURATION:' : 'CLOCK-IN TIME:';
  const shiftValue = isClockedIn
    ? formatDuration(shiftMinutes)
    : activeSession?.clock_in
      ? formatTime(new Date(activeSession.clock_in))
      : '--:-- --';

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="dark-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greetingText}>{greeting}, {getFirstName(staffData?.full_name)} 👋</Text>
          <View style={styles.locationBadge}>
            <Text style={{ fontSize: 12, marginRight: 4 }}>📍</Text>
            <Text style={styles.locationText} numberOfLines={1} ellipsizeMode="tail">{currentLocation}</Text>
          </View>
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.iconButton}>
            <Text style={{ fontSize: 20 }}>🔔</Text>
            <View style={styles.badge} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Profile', { staff: staffData })}>
            {staffData?.profile_image ? (
              <Image 
                source={{ uri: `http://192.168.1.7:4000/uploads/${staffData.profile_image}` }} 
                style={styles.avatar} 
              />
            ) : (
              <View style={[styles.avatar, { backgroundColor: '#D0B079', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: 'white', fontWeight: 'bold' }}>{staffData?.full_name?.charAt(0)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Shift Card */}
      <Animated.View entering={FadeInDown.delay(200).duration(800)}>
        <LinearGradient
          colors={['#D0B079', '#B8965E']}
          style={styles.shiftCard}
        >
          <View style={styles.shiftHeader}>
            <View style={styles.todayBadge}>
              <Text style={styles.todayText}>Today, {formatDate(currentDate)}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: isClockedIn ? '#10B981' : '#64748B' }]}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>{isClockedIn ? 'ON DUTY' : 'OFF DUTY'}</Text>
            </View>
          </View>
          
          <View style={styles.shiftMainSlim}>
            <View>
              <Text style={styles.loginLabelSlim}>{shiftLabel}</Text>
              <Text style={styles.loginTimeSlim}>{shiftValue}</Text>
            </View>
            {isClockedIn && activeSession?.clock_in && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.startTimeLabel}>CLOCKED IN AT:</Text>
                <Text style={styles.startTimeValue}>{formatTime(new Date(activeSession.clock_in))}</Text>
              </View>
            )}
          </View>
        </LinearGradient>
      </Animated.View>

      {/* Clock Button Section */}
      <View style={styles.clockSection}>
        <Animated.View style={[styles.clockOuterRing, animatedButtonStyle]}>
          <TouchableOpacity 
            style={[
              styles.clockButton, 
              isClockedIn ? styles.clockButtonOut : styles.clockButtonIn
            ]} 
            onPress={handleClockToggle}
            activeOpacity={0.8}
            disabled={clockLoading}
          >
            <Text style={{ fontSize: 50 }}>{isClockedIn ? '⏹️' : '▶️'}</Text>
            <Text style={styles.clockActionText}>
              {clockLoading ? 'WAIT...' : (isClockedIn ? 'CLOCK\nOUT' : 'CLOCK\nIN')}
            </Text>
          </TouchableOpacity>
        </Animated.View>
        
        <View style={styles.clockStatusContainer}>
          <View style={[styles.clockStatusDot, isClockedIn && styles.clockStatusDotActive]} />
          <Text style={styles.clockStatusText}>
            {isClockedIn ? 'CURRENTLY CLOCKED IN' : 'READY TO START'}
          </Text>
        </View>
        <Text style={styles.clockHint}>
          {isClockedIn ? 'System is recording your hours...' : 'Tap the button to start your shift'}
        </Text>
      </View>

      <View style={styles.bottomSection}>
        {/* Yesterday's Log */}
        <Animated.View entering={FadeInUp.delay(500)} style={styles.yesterdayCard}>
          <View style={styles.yesterdayHeader}>
            <Text style={styles.yesterdayTitle}>Yesterday's log</Text>
            <Text style={styles.yesterdayDate}>{yesterdayDate}</Text>
          </View>
          <View style={styles.logRow}>
            <View style={styles.logItem}>
              <View style={[styles.logDot, { backgroundColor: '#10B981' }]} />
              <View>
                <Text style={styles.logLabelSmall}>IN</Text>
                <Text style={styles.logValue}>{yesterdayIn}</Text>
              </View>
            </View>
            <View style={styles.logDivider} />
            <View style={styles.logItem}>
              <View style={[styles.logDot, { backgroundColor: '#EF4444' }]} />
              <View>
                <Text style={styles.logLabelSmall}>OUT</Text>
                <Text style={styles.logValue}>{yesterdayOut}</Text>
              </View>
            </View>
            <View style={styles.logDivider} />
            <View style={styles.logItem}>
              <View style={[styles.logDot, { backgroundColor: '#D0B079' }]} />
              <View>
                <Text style={styles.logLabelSmall}>TOTAL</Text>
                <Text style={styles.logValue}>
                  {yesterdayTotal > 0 ? formatDuration(yesterdayTotal) : '--'}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>
      </View>

      {/* Floating Bottom Tab Bar */}
      <View style={[styles.tabContainer, { bottom: 20 }]}>
        <View style={styles.floatingTab}>
          <TouchableOpacity style={styles.tabItem}>
            <View style={styles.tabIconActive}>
               <Text style={{ fontSize: 20 }}>🏠</Text>
            </View>
            <Text style={styles.tabLabelActive}>Home</Text>
          </TouchableOpacity>
          
          <View style={styles.tabSeparator} />

          <TouchableOpacity style={styles.tabItem} onPress={() => navigation.navigate('Profile', { staff: staffData })}>
            <Text style={{ fontSize: 20 }}>👤</Text>
            <Text style={styles.tabLabel}>Profile</Text>
          </TouchableOpacity>
        </View>
      </View>

      <CustomAlert
        visible={showConfirmLogout}
        title="CLOCK OUT"
        message="Are you sure you want to end your shift for today?"
        type="confirm"
        confirmText="CONFIRM"
        cancelText="CANCEL"
        onClose={() => setShowConfirmLogout(false)}
        onConfirm={performClockAction}
      />

      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        confirmText="OK"
        onClose={() => setAlertConfig({ ...alertConfig, visible: false })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 15,
  },
  greetingText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
  },
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 4,
    maxWidth: '85%',
  },
  locationText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
    flexShrink: 1,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: 'white',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'white',
  },
  shiftCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#D0B079',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  shiftHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  todayBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  todayText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'white',
    marginRight: 4,
  },
  statusText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
  },
  shiftMainSlim: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
  },
  loginLabelSlim: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    fontWeight: '600',
  },
  loginTimeSlim: {
    color: 'white',
    fontSize: 20,
    fontWeight: '800',
  },
  startTimeLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  startTimeValue: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
  },
  clockSection: {
    alignItems: 'center',
    paddingVertical: 15,
    flex: 1,
    justifyContent: 'center',
  },
  clockOuterRing: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(208, 176, 121, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(208, 176, 121, 0.15)',
  },
  clockButton: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  clockButtonIn: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
  },
  clockButtonOut: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
  },
  clockActionText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 6,
    letterSpacing: 1,
  },
  clockStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  clockStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#94A3B8',
    marginRight: 6,
  },
  clockStatusDotActive: {
    backgroundColor: '#10B981',
  },
  clockStatusText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
  },
  clockHint: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    fontWeight: '500',
  },
  bottomSection: {
    paddingHorizontal: 20,
    marginBottom: 100,
  },
  yesterdayCard: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  yesterdayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  yesterdayTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  yesterdayDate: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 6,
  },
  logLabelSmall: {
    fontSize: 9,
    color: '#94A3B8',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  logValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  logDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#E2E8F0',
  },
  tabContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingTab: {
    flexDirection: 'row',
    backgroundColor: 'white',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 12,
  },
  tabIconActive: {
    backgroundColor: '#FFFBEB',
    padding: 5,
    borderRadius: 8,
    marginRight: 6,
  },
  tabSeparator: {
    width: 1,
    height: 20,
    backgroundColor: '#E2E8F0',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  tabLabelActive: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D0B079',
  },
});

export default HomeScreen;
