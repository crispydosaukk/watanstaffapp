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
  Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Bell, AlertTriangle, ChevronRight } from 'lucide-react-native';
import Animated from 'react-native-reanimated';
import {
  useAnimatedStyle,
  withSpring,
  withTiming,
  useSharedValue,
} from 'react-native-reanimated';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Geolocation from '@react-native-community/geolocation';
import { GOOGLE_MAPS_API_KEY } from '../api/config';
import CustomAlert from '../components/CustomAlert';
import { db, auth } from '../lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp
} from 'firebase/firestore';
import { calcCalculatedMinutes } from '../lib/timeRounding';
// No longer need width/height if not used
Dimensions.get('window');

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

const formatTime = (date: any): string => {
  if (!date) return '--:--';
  const d = date instanceof Date ? date : (date?.toDate ? date.toDate() : new Date(date));
  return d.toLocaleTimeString('en-US', {
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

const minutesBetween = (from: any, to: Date): number => {
  if (!from) return 0;
  const start = (from instanceof Date ? from : (from?.toDate ? from.toDate() : new Date(from))).getTime();
  const end = to.getTime();
  const diff = Math.floor((end - start) / 60000);
  return Math.max(0, diff);
};

const calcSessionMinutes = (record: any): number => {
  if (record.clock_in && record.clock_out) {
    return calcCalculatedMinutes(record.clock_in, record.clock_out);
  }
  return 0;
};

const getAutoLogoutTime = (clockIn: Date, autoLogoutHours: number = 15): Date => {
  const logoutTime = new Date(clockIn.getTime() + autoLogoutHours * 60 * 60 * 1000);
  return logoutTime;
};

// ─── Component ──────────────────────────────────────────────────────────────

const HomeScreen = ({ navigation, route }: any) => {
  const insets = useSafeAreaInsets();
  const staff = route?.params?.staff;

  const [isClockedIn, setIsClockedIn] = useState(false);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [shiftMinutes, setShiftMinutes] = useState(0);
  const [yesterdayLog, setYesterdayLog] = useState<any[]>([]);
  const [currentLocation, setCurrentLocation] = useState('Detecting location...');
  const [greeting, setGreeting] = useState(getGreeting());
  const [currentDate, setCurrentDate] = useState(new Date());
  const [restaurantData, setRestaurantData] = useState<any>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (clockLoading) {
      pulse.value = withTiming(1.05, { duration: 800 });
      const interval = setInterval(() => {
        pulse.value = pulse.value === 1 ? withTiming(1.05, { duration: 800 }) : withTiming(1, { duration: 800 });
      }, 800);
      return () => clearInterval(interval);
    } else {
      pulse.value = withSpring(1);
    }
  }, [clockLoading]);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const [staffData, setStaffData] = useState(staff);
  const lastLocation = useRef<any>(null);
  const locationWatchId = useRef<number | null>(null);
  const [showConfirmLogout, setShowConfirmLogout] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Track shown scheduled notifications persistently across renders
  const shownNotifIds = useRef(new Set<string>());


  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    message: '',
    type: 'info' as 'success' | 'error' | 'warning' | 'info' | 'confirm',
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = setInterval(() => {
      setGreeting(getGreeting());
      setCurrentDate(new Date());
    }, 60000);
    return () => clearInterval(tick);
  }, []);

  const startTimer = useCallback((clockInTime: any, previousMinutes: number = 0) => {
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

  useEffect(() => {
    const loadData = async () => {
      if (!staffData) {
        const storedStaff = await AsyncStorage.getItem('staffData');
        if (storedStaff) setStaffData(JSON.parse(storedStaff));
      }
    };
    loadData();
  }, [staffData]);


  useEffect(() => {
    if (!staffData?.id && !staffData?.uid) return;
    const staffId = staffData.id || staffData.uid;

    let unsubProfile: (() => void) | undefined;
    let unsubAttendance: (() => void) | undefined;
    let unsubNotif: (() => void) | undefined;
    let unsubRestaurant: (() => void) | undefined;
    let releaseMonitor: any;

    // Staff Profile Real-time Sync
    unsubProfile = onSnapshot(doc(db, "staff", staffId), (docSnap) => {
      if (docSnap.exists()) {
        const updatedData = { id: docSnap.id, ...docSnap.data() };
        setStaffData(updatedData);
        // Also update AsyncStorage so it persists
        AsyncStorage.setItem('staffData', JSON.stringify(updatedData));
      }
    }, (err) => console.error("[Home] Profile sync error:", err));

    // Restaurant profile listener for dynamic geofence radius and auto logout hours
    if (staffData?.restaurant_id) {
      unsubRestaurant = onSnapshot(doc(db, "restaurants", staffData.restaurant_id), (restSnap) => {
        if (restSnap.exists()) {
          setRestaurantData(restSnap.data());
        }
      });
    }

    if (!auth.currentUser) {
      console.warn("[Home] No Firebase Auth session. Redirecting...");
      AsyncStorage.removeItem('staffData');
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }

    // Attendance Listener
    const qAttendance = query(
      collection(db, "attendance"),
      where("staff_id", "==", staffId)
    );

    unsubAttendance = onSnapshot(qAttendance, (snapshot) => {
      let allLogs = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data({ serverTimestamps: 'estimate' }) as any)
      }));

      // Manual sort to avoid index requirements
      allLogs.sort((a, b) => {
        const dateA = a.clock_in?.toDate ? a.clock_in.toDate() : new Date(a.clock_in || 0);
        const dateB = b.clock_in?.toDate ? b.clock_in.toDate() : new Date(b.clock_in || 0);
        return dateB.getTime() - dateA.getTime();
      });

      console.log(`[Firestore] Fetched and sorted ${allLogs.length} total attendance records.`);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // 1. Identify the active session (the most recent one without a clock_out)
      // Since allLogs is sorted by clock_in desc, the first one without clock_out is the active one.
      let active = allLogs.find(l => !l.clock_out);

      // 2. Filter for today's completed logs and the active one if it started today
      const todayLogs = allLogs.filter(l => {
        const cIn = l.clock_in?.toDate ? l.clock_in.toDate() : new Date(l.clock_in);
        return cIn >= today;
      });

      // 3. Filter for yesterday's logs
      const yesterdayLogs = allLogs.filter(l => {
        const cIn = l.clock_in?.toDate ? l.clock_in.toDate() : new Date(l.clock_in);
        return cIn >= yesterday && cIn < today;
      });

      setYesterdayLog(yesterdayLogs);

      if (active) {
        const cinDate = active.clock_in?.toDate ? active.clock_in.toDate() : new Date(active.clock_in);
        const autoHours = restaurantData?.auto_logout_hours !== undefined 
          ? parseFloat(restaurantData.auto_logout_hours) 
          : 15;
        const autoLogout = getAutoLogoutTime(cinDate, autoHours);
        const now = new Date();

        if (now >= autoLogout) {
          console.log(`[Clock] Auto-logout triggered for session: ${active.id}`);
          const diffMin = Math.max(1, Math.round((autoLogout.getTime() - cinDate.getTime()) / 60000));
          const safeDiffMin = Math.min(diffMin, 1440);

          updateDoc(doc(db, "attendance", active.id), {
            clock_out: autoLogout,
            total_minutes: Math.max(0, safeDiffMin),
            location_out: "System Auto-Logout"
          }).catch(err => console.error("Auto logout error:", err));

          active = undefined;
        }
      }

      if (active) {
        console.log(`[Clock] Active session found: ${active.id} (Started: ${active.clock_in?.toDate ? active.clock_in.toDate() : active.clock_in})`);
        setActiveSession(active);
        setIsClockedIn(true);

        // Calculate minutes worked today so far (excluding current active session to avoid double counting in timer)
        const previousMinutes = todayLogs.filter(l => l.id !== active.id).reduce((sum, l) => sum + calcSessionMinutes(l), 0);
        startTimer(active.clock_in, previousMinutes);
      } else {
        console.log("[Clock] No active session found.");
        setActiveSession(null);
        setIsClockedIn(false);
        stopTimer();
        const totalMin = todayLogs.reduce((sum, l) => sum + calcSessionMinutes(l), 0);
        setShiftMinutes(totalMin);
      }
    }, (error) => {
      console.error("[Firestore Attendance Query Error]:", error);
    });

    // Handled via the Ref above now

    const qNotif = query(
      collection(db, "notifications"),
      where("staff_id", "==", staffId),
      where("status", "in", ["pending", "scheduled"])
    );

    // Use a Ref to store the latest notifications so the setInterval can access them safely
    const allNotificationsRef = { current: [] as any[] };

    // Helper function to show banner smoothly
    const triggerBanner = async (notif: any) => {
      shownNotifIds.current.add(notif.id);
      
      // Show native OS notification instead of custom in-app banner
      try {
        const { default: notifee, AndroidImportance, AndroidVisibility } = await import('@notifee/react-native');
        
        await notifee.displayNotification({
          title: notif.title || 'New Notification',
          body: notif.body || 'You have a new message',
          android: {
            channelId: 'high_importance_channel',
            importance: AndroidImportance.HIGH,
            visibility: AndroidVisibility.PUBLIC,
            pressAction: {
              id: 'default',
            },
          },
        });
      } catch (err) {
        console.error("Error displaying native notification:", err);
      }
    };

    unsubNotif = onSnapshot(qNotif, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      allNotificationsRef.current = docs;

      // 1. Calculate Unread Count (Only for released/pending items)
      const visibleUnread = docs.filter((n: any) => {
        if (n.read) return false;
        if (n.status === 'scheduled' && n.scheduled_for) {
          const scheduledTime = n.scheduled_for.toDate ? n.scheduled_for.toDate().getTime() : new Date(n.scheduled_for).getTime();
          return Date.now() >= scheduledTime;
        }
        return n.status === 'pending';
      }).length;
      setUnreadCount(visibleUnread);

      // 2. Handle immediate popups for brand new arrivals
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const latest: any = { id: change.doc.id, ...change.doc.data() };
          if (shownNotifIds.current.has(latest.id)) return;

          // Only trigger banner for scheduled notifications. 
          // 'pending' (immediate) notifications are handled instantly by Firebase FCM in NotificationService.js
          if (latest.status === 'scheduled') {
            const isPast = latest.scheduled_for ? (latest.scheduled_for.toDate ? latest.scheduled_for.toDate().getTime() : new Date(latest.scheduled_for).getTime()) <= Date.now() : true;
            if (isPast) {
              triggerBanner(latest);
            }
          }
        }
      });
    });

    // 3. Time Monitor: Check the ALREADY LOADED notifications every 5 seconds
    releaseMonitor = setInterval(() => {
      // Safely access the current list of notifications from our Ref
      const currentNotifs = allNotificationsRef.current || [];

      currentNotifs.forEach((n: any) => {
        // Only trigger if it's scheduled, has a time, hasn't been shown, and IS DUE NOW
        if (n.status === 'scheduled' && n.scheduled_for && !shownNotifIds.current.has(n.id)) {
          const sTime = n.scheduled_for.toDate ? n.scheduled_for.toDate().getTime() : new Date(n.scheduled_for).getTime();

          if (Date.now() >= sTime) {
            // RELEASE IT: Show banner and add to shown list
            triggerBanner(n);

            // Instantly update the unread count so the badge on the bell icon refreshes
            const unread = currentNotifs.filter((item: any) => {
              if (item.read) return false;
              if (item.status === 'pending') return true;
              if (item.status === 'scheduled' && item.scheduled_for) {
                const itemTime = item.scheduled_for.toDate ? item.scheduled_for.toDate().getTime() : new Date(item.scheduled_for).getTime();
                return Date.now() >= itemTime;
              }
              return false;
            }).length;
            setUnreadCount(unread);
          }
        }
      });
    }, 5000);

    return () => {
      if (unsubProfile) unsubProfile();
      if (unsubAttendance) unsubAttendance();
      if (unsubNotif) unsubNotif();
      if (unsubRestaurant) unsubRestaurant();
      if (releaseMonitor) clearInterval(releaseMonitor);
    };


  }, [staffData, startTimer, stopTimer, navigation]);

  useEffect(() => {
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
        console.error('Geocode error:', error);
        setCurrentLocation('Location lookup failed');
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

    const startWatching = () => {
      if (locationWatchId.current) Geolocation.clearWatch(locationWatchId.current);
      locationWatchId.current = Geolocation.watchPosition(
        pos => {
          lastLocation.current = pos;
          const { latitude, longitude } = pos.coords;
          reverseGeocode(latitude, longitude);
        },
        err => console.log("[GPS Watch] Error:", err),
        { enableHighAccuracy: true, distanceFilter: 10, interval: 10000, fastestInterval: 5000 }
      );
    };

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

    requestLocationPermission().then(() => startWatching());

    return () => {
      if (locationWatchId.current) Geolocation.clearWatch(locationWatchId.current);
    };
  }, []);

  const getFirstName = (fullName: string) => {
    if (!fullName) return 'Staff';
    return fullName.trim().split(' ')[0];
  };

  // Helper: Calculate distance in meters between two GPS points (Haversine formula)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  };

  const performClockAction = async () => {
    if (clockLoading || !staffData) return;

    console.log("[Clock] Staff Data Debug:", staffData);

    const staffId = staffData.id || staffData.uid;
    if (!staffId) {
      setAlertConfig({ visible: true, title: 'ERROR', message: 'Staff profile not loaded. Please restart the app.', type: 'error' });
      return;
    }

    setClockLoading(true);
    setProcessingStep('📡 GPS Fetching...');

    try {
      // START PARALLEL TASKS: GPS and Restaurant Data (needed for both clock-in and clock-out)
      const restaurantDataPromise = staffData.restaurant_id
        ? getDoc(doc(db, "restaurants", staffData.restaurant_id))
        : Promise.resolve(null);

      // 1. GET GPS POSITION (OPTIMIZED)
      const position: any = await (async () => {
        // Tier 0: Instant check of our internal background cache (< 30s old)
        if (lastLocation.current && (Date.now() - lastLocation.current.timestamp) < 30000) {
          return lastLocation.current;
        }

        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timeout")), 2000);
          Geolocation.getCurrentPosition(
            (pos) => { clearTimeout(timer); resolve(pos); },
            (err) => { clearTimeout(timer); reject(err); },
            { enableHighAccuracy: true, timeout: 1500, maximumAge: 30000 }
          );
        }).catch(() => {
          setProcessingStep('🔄 Retrying GPS...');
          // Tier 2: Try 6s High Accuracy
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Timeout")), 7000);
            Geolocation.getCurrentPosition(
              (pos) => { clearTimeout(timer); resolve(pos); },
              (err) => { clearTimeout(timer); reject(err); },
              { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
            );
          });
        });
      })().catch(() => {
        setProcessingStep('⏳ Improving Signal...');
        // Tier 3: Try 10s Balanced Accuracy
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timeout")), 12000);
          Geolocation.getCurrentPosition(
            (pos) => { clearTimeout(timer); resolve(pos); },
            (err) => { clearTimeout(timer); reject(err); },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 10000 }
          );
        });
      }).catch(err => {
        console.error("GPS Error:", err);
        throw new Error("GPS Signal Weak. Please stand in a clearer area.");
      });

      const { latitude: curLat, longitude: curLng } = position.coords;
      setProcessingStep('✅ Location Found');

      // 2. GEOFENCING (Clock-In AND Clock-Out)
      let distance = 0;
      if (!staffData.restaurant_id) throw new Error("You are not assigned to any restaurant.");

      const restDoc: any = await restaurantDataPromise;
      if (!restDoc?.exists()) throw new Error("Restaurant profile not found in database.");

      const restData = restDoc.data();
      const restLat = parseFloat(restData.latitude);
      const restLng = parseFloat(restData.longitude);

      if (isNaN(restLat) || isNaN(restLng)) throw new Error("Restaurant location is not set in dashboard.");

      distance = calculateDistance(curLat, curLng, restLat, restLng);
      
      // Allow dynamic geofence radius from restaurant data, default to 50m
      const allowedRadius = restData.geofence_radius !== undefined ? parseFloat(restData.geofence_radius) : 50;

      if (distance > allowedRadius) {
        const action = isClockedIn ? 'clock out' : 'clock in';
        throw new Error(`Out of Range: You are ${Math.round(distance)}m away from ${restData.restaurant_name}. Please move within ${Math.round(allowedRadius)}m to ${action}.`);
      }

      // 3. DATABASE SAVE
      setProcessingStep('💾 Saving...');
      const locString = currentLocation || `${curLat.toFixed(4)}, ${curLng.toFixed(4)}`;

      const now = new Date();
      const staffId = staffData.id || staffData.uid;

      if (!isClockedIn) {
        await addDoc(collection(db, "attendance"), {
          staff_id: staffId,
          clock_in: serverTimestamp(),
          clock_out: null,
          total_minutes: 0,
          date: serverTimestamp(),
          restaurant_id: staffData.restaurant_id || "",
          location_in: locString,
          distance_m: Math.round(distance)
        });
        setProcessingStep('🎉 Clocked In!');
        setAlertConfig({ visible: true, title: 'SUCCESS', message: 'Location verified. You have successfully clocked in!', type: 'success' });
      } else {
        if (!activeSession?.id) throw new Error("No active session found to clock out.");

        const cinDate = activeSession.clock_in?.toDate ? activeSession.clock_in.toDate() : new Date(activeSession.clock_in);
        const diffMin = Math.max(1, Math.round((now.getTime() - cinDate.getTime()) / 60000));
        // Safety cap: no single session should exceed 24 hours (1440 min)
        const safeDiffMin = Math.min(diffMin, 1440);

        await updateDoc(doc(db, "attendance", activeSession.id), {
          clock_out: now,
          total_minutes: Math.max(0, safeDiffMin),
          location_out: locString
        });
        setProcessingStep('🎉 Clocked Out!');
        setShowConfirmLogout(false);
        setAlertConfig({ visible: true, title: 'SUCCESS', message: 'You have successfully clocked out. Great work today!', type: 'success' });
      }
    } catch (err: any) {
      console.error("[Clock Toggle Error]:", err);
      const isOutOfRange = err?.message?.includes("Out of Range");

      setAlertConfig({
        visible: true,
        title: isOutOfRange ? 'OUT OF RANGE' : 'ACTION FAILED',
        message: err.message || "An error occurred.",
        type: isOutOfRange ? 'warning' : 'error',
      });
    } finally {
      setTimeout(() => {
        setClockLoading(false);
        setProcessingStep('');
      }, 800);
    }
  };

  const handleClockToggle = async () => {
    if (clockLoading) return;
    if (isClockedIn) {
      setShowConfirmLogout(true);
    } else {
      performClockAction();
    }
  };



  const yesterdayIn = yesterdayLog.length > 0 && yesterdayLog[yesterdayLog.length - 1].clock_in
    ? formatTime(yesterdayLog[yesterdayLog.length - 1].clock_in)
    : '--';
  const yesterdayOut = yesterdayLog.length > 0 && yesterdayLog[0].clock_out
    ? formatTime(yesterdayLog[0].clock_out)
    : '--';
  const yesterdayTotal = yesterdayLog.reduce((sum: number, r: any) => sum + (r.total_minutes != null ? r.total_minutes : calcSessionMinutes(r)), 0);
  const yesterdayDateStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  })();

  const shiftLabel = isClockedIn ? 'SHIFT DURATION:' : 'CLOCK-IN TIME:';
  const shiftValue = isClockedIn
    ? formatDuration(shiftMinutes)
    : activeSession?.clock_in
      ? formatTime(activeSession.clock_in)
      : '--:-- --';

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={true} />

      {/* CUSTOM NOTIFICATION BANNER REMOVED (Replaced by Notifee) */}

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greetingText} numberOfLines={1} ellipsizeMode="tail">
            {greeting}, {getFirstName(staffData?.full_name)} 👋
          </Text>
          <View style={styles.locationBadge}>
            <Text style={{ fontSize: 12, marginRight: 4 }}>📍</Text>
            <Text style={styles.locationText} numberOfLines={1}>{currentLocation}</Text>
          </View>
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => navigation.navigate('Notification')}
          >
            <Text style={{ fontSize: 20 }}>🔔</Text>
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Profile', { staff: staffData, isClockedIn, activeSession })}>
            {staffData?.profile_image ? (
              <Image
                source={{ uri: staffData.profile_image }}
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

      <Animated.View>
        <LinearGradient colors={['#D0B079', '#B8965E']} style={styles.shiftCard}>
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
                <Text style={styles.startTimeValue}>{formatTime(activeSession.clock_in)}</Text>
              </View>
            )}
          </View>
        </LinearGradient>
      </Animated.View>

      <View style={styles.clockSection}>
        <View style={styles.clockCenterContainer}>
          <Animated.View style={[styles.clockOuterRing, animatedButtonStyle]}>
            <TouchableOpacity
              style={[styles.clockButton, isClockedIn ? styles.clockButtonOut : styles.clockButtonIn]}
              onPress={handleClockToggle}
              activeOpacity={0.7}
              disabled={clockLoading}
            >
              {clockLoading ? (
                <Text style={styles.clockStepText}>{processingStep}</Text>
              ) : (
                <>
                  <Text style={{ fontSize: 44 }}>
                    {isClockedIn ? '⏹️' : '▶️'}
                  </Text>
                  <Text style={styles.clockActionText}>
                    {isClockedIn ? 'CLOCK\nOUT' : 'CLOCK\nIN'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>

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
        <Animated.View style={styles.yesterdayCard}>
          <View style={styles.yesterdayHeader}>
            <Text style={styles.yesterdayTitle}>Yesterday's log</Text>
            <Text style={styles.yesterdayDate}>{yesterdayDateStr}</Text>
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
                <Text style={styles.logValue}>{yesterdayTotal > 0 ? formatDuration(yesterdayTotal) : '--'}</Text>
              </View>
            </View>
          </View>
        </Animated.View>
      </View>

      <View style={styles.tabContainer}>
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
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 15 },
  greetingText: { fontSize: 18, fontWeight: '700', color: '#1E293B' },
  locationBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 4, maxWidth: '85%' },
  locationText: { fontSize: 11, color: '#475569', fontWeight: '600' },
  headerIcons: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center', marginRight: 10, elevation: 2 },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white', paddingHorizontal: 4 },
  badgeText: { color: 'white', fontSize: 10, fontWeight: '900' },
  avatar: { width: 40, height: 40, borderRadius: 10, borderWidth: 2, borderColor: 'white' },
  shiftCard: { marginHorizontal: 20, borderRadius: 20, padding: 16, elevation: 6 },
  shiftHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  todayBadge: { backgroundColor: 'rgba(255, 255, 255, 0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  todayText: { color: 'white', fontSize: 11, fontWeight: '600' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statusDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'white', marginRight: 4 },
  statusText: { color: 'white', fontSize: 11, fontWeight: '700' },
  shiftMainSlim: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.15)' },
  loginLabelSlim: { color: 'rgba(255, 255, 255, 0.9)', fontSize: 14, fontWeight: '600' },
  loginTimeSlim: { color: 'white', fontSize: 20, fontWeight: '800' },
  startTimeLabel: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 10, fontWeight: '700' },
  startTimeValue: { color: 'white', fontSize: 15, fontWeight: '700' },
  clockSection: { alignItems: 'center', paddingVertical: 15, flex: 1, justifyContent: 'center' },
  clockCenterContainer: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  rippleCircle: { position: 'absolute', width: 150, height: 150, borderRadius: 75, zIndex: -1, top: '50%', left: '50%', marginTop: -75, marginLeft: -75 },
  clockOuterRing: { width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(208, 176, 121, 0.08)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(208, 176, 121, 0.15)' },
  clockButton: { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center', elevation: 8 },
  clockButtonIn: { backgroundColor: '#10B981' },
  clockButtonOut: { backgroundColor: '#EF4444' },
  clockActionText: { color: 'white', fontSize: 13, fontWeight: '900', textAlign: 'center', marginTop: 6, letterSpacing: 1 },
  clockStepText: { color: 'white', fontSize: 11, fontWeight: '700', textAlign: 'center', paddingHorizontal: 10, letterSpacing: 0.5 },
  clockStatusContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  clockStatusDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#94A3B8', marginRight: 6 },
  clockStatusDotActive: { backgroundColor: '#10B981' },
  clockStatusText: { fontSize: 12, fontWeight: '800', color: '#475569' },
  clockHint: { fontSize: 12, color: '#64748B', marginTop: 4, fontWeight: '500' },
  bottomSection: { paddingHorizontal: 20, marginBottom: 100 },
  yesterdayCard: { backgroundColor: 'white', padding: 16, borderRadius: 20, elevation: 2 },
  yesterdayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  yesterdayTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  yesterdayDate: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  logRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logItem: { flexDirection: 'row', alignItems: 'center' },
  logDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 6 },
  logLabelSmall: { fontSize: 9, color: '#94A3B8', fontWeight: '700', textTransform: 'uppercase' },
  logValue: { fontSize: 13, fontWeight: '700', color: '#334155' },
  logDivider: { width: 1, height: 20, backgroundColor: '#E2E8F0' },
  tabContainer: { position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  floatingTab: { flexDirection: 'row', backgroundColor: 'white', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 25, alignItems: 'center', elevation: 8, borderWidth: 1, borderColor: '#F1F5F9' },
  tabItem: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', paddingHorizontal: 12 },
  tabIconActive: { backgroundColor: '#FFFBEB', padding: 5, borderRadius: 8, marginRight: 6 },
  tabSeparator: { width: 1, height: 20, backgroundColor: '#E2E8F0' },
  tabLabel: { fontSize: 11, fontWeight: '600', color: '#94A3B8' },
  tabLabelActive: { fontSize: 11, fontWeight: '700', color: '#D0B079' },
  notificationBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(208, 176, 121, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#ffffff',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e293b',
    letterSpacing: 0.3,
  },
  bannerBody: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
});

export default HomeScreen;
