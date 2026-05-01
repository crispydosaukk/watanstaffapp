import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  StatusBar,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db, auth } from '../lib/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  doc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import Animated, { 
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';
import { Bell, ChevronLeft, CheckCircle2, MessageSquare, Clock, X, AlertTriangle, ChevronRight } from 'lucide-react-native';

const NotificationScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBanner, setActiveBanner] = useState<any>(null);
  const bannerY = useSharedValue(-150);

  const markAllAsSeen = async (pendingList: any[]) => {
    try {
      const batch = writeBatch(db);
      pendingList.forEach(n => {
        batch.update(doc(db, "notifications", n.id), { status: 'seen' });
      });
      await batch.commit();
    } catch (error) {
      console.error("Error marking seen:", error);
    }
  };

  useEffect(() => {
    if (!auth.currentUser) return;

    // Show notifications that haven't been "read" yet
    const q = query(
      collection(db, "notifications"),
      where("staff_id", "==", auth.currentUser.uid),
      where("status", "!=", "read")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`[Debug] Notification Snapshot received. Documents: ${snapshot.size}`);
      const list = snapshot.docs
        .map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter((n: any) => {
          if (n.status === 'scheduled' && n.scheduled_for) {
            const scheduledTime = n.scheduled_for.toDate ? n.scheduled_for.toDate().getTime() : new Date(n.scheduled_for).getTime();
            return Date.now() >= scheduledTime; // Show if the time has passed
          }
          return n.status !== 'scheduled';
        }) as any[];

      // Sort in JS
      list.sort((a, b) => {
        const timeA = a.sent_at?.toDate ? a.sent_at.toDate().getTime() : 0;
        const timeB = b.sent_at?.toDate ? b.sent_at.toDate().getTime() : 0;
        return timeB - timeA;
      });

      // Check for brand new notifications to show a popup if the user is already here
      const newArrivals = snapshot.docChanges().filter(change => change.type === 'added');
      if (newArrivals.length > 0 && !loading) {
        const latest = newArrivals[0].doc.data();
        // We only show alert if it's pending (not seen/read yet)
        if (latest.status === 'pending') {
          setActiveBanner(latest);
          bannerY.value = withSpring(16, { damping: 15 });
          setTimeout(() => {
            bannerY.value = withTiming(-150);
          }, 5000);
        }
      }

      setNotifications(list);
      setLoading(false);

      // Automatically mark all as 'seen' so the Home Screen badge clears
      const pending = list.filter((n: any) => n.status === 'pending');
      if (pending.length > 0) {
        markAllAsSeen(pending);
      }
    }, (error) => {
      console.error("Firestore Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, "notifications", id), { 
        status: 'read',
        read_at: serverTimestamp()
      });
    } catch (error) {
      console.error("Error marking read:", error);
    }
  };

  const clearAll = async () => {
    try {
      if (notifications.length === 0) return;
      const batch = writeBatch(db);
      notifications.forEach(n => {
        batch.update(doc(db, "notifications", n.id), { 
          status: 'read',
          read_at: serverTimestamp()
        });
      });
      await batch.commit();
    } catch (error) {
      console.error("Error clearing all:", error);
    }
  };

  const renderNotification = ({ item, index }: { item: any, index: number }) => {
    let iconColor = "#D97706";
    let bgColor = "rgba(217, 119, 6, 0.1)";
    let borderColor = "#F1F5F9";
    
    if (item.priority === 'urgent') {
      iconColor = "#E11D48"; // Rose 600
      bgColor = "rgba(225, 29, 72, 0.1)";
      borderColor = "rgba(225, 29, 72, 0.2)";
    } else if (item.priority === 'high') {
      iconColor = "#EA580C"; // Orange 600
      bgColor = "rgba(234, 88, 12, 0.1)";
      borderColor = "rgba(234, 88, 12, 0.2)";
    } else if (item.type === 'direct_message') {
      iconColor = "#0284C7"; // Sky 600
      bgColor = "rgba(2, 132, 199, 0.1)";
    }

    return (
      <Animated.View 
        style={[styles.notificationCard, { borderColor: borderColor }]}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.iconWrapper, { backgroundColor: bgColor }]}>
            {item.priority === 'urgent' ? (
              <Bell size={18} color={iconColor} strokeWidth={3} />
            ) : item.type === 'direct_message' ? (
              <MessageSquare size={18} color={iconColor} />
            ) : (
              <Bell size={18} color={iconColor} />
            )}
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.notifTitle, item.priority === 'urgent' && { color: iconColor }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.timeText}>
              {item.sent_at?.toDate ? item.sent_at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.dismissButton}
            onPress={() => markAsRead(item.id)}
          >
            <X size={16} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      
      <Text style={styles.notifBody}>{item.body}</Text>
      
      <View style={styles.cardFooter}>
        <View style={styles.dateWrapper}>
          <Clock size={10} color="#94A3B8" style={{ marginRight: 4 }} />
          <Text style={styles.dateText}>
            {item.sent_at?.toDate ? item.sent_at.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}
          </Text>
        </View>
        
        {item.status === 'seen' && (
          <View style={styles.seenBadge}>
            <CheckCircle2 size={10} color="#D0B079" style={{ marginRight: 4 }} />
            <Text style={styles.seenText}>Seen</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
};
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent={true} />

      {/* CUSTOM NOTIFICATION BANNER */}
      <Animated.View 
        style={[
          styles.notificationBanner, 
          { top: insets.top + 8 },
          useAnimatedStyle(() => ({
            transform: [{ translateY: bannerY.value }],
            opacity: withTiming(bannerY.value > -100 ? 1 : 0)
          }))
        ]}
      >
        <Pressable 
          style={styles.bannerContent}
          onPress={() => {
            bannerY.value = withTiming(-150);
          }}
        >
          <View style={[styles.iconContainer, { backgroundColor: activeBanner?.priority === 'high' ? '#ef444420' : '#D0B07920' }]}>
            {activeBanner?.priority === 'high' ? (
              <AlertTriangle size={20} color="#ef4444" />
            ) : (
              <Bell size={20} color="#D0B079" />
            )}
          </View>
          <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              {activeBanner?.title || 'New Notification'}
            </Text>
            <Text style={styles.bannerBody} numberOfLines={1}>
              {activeBanner?.body || 'You have a new message'}
            </Text>
          </View>
          <X size={16} color="#475569" />
        </Pressable>
      </Animated.View>
      
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top || 10 }]}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <ChevronLeft size={24} color="#1E293B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity 
          onPress={clearAll}
          disabled={notifications.length === 0}
          style={[styles.clearButton, notifications.length === 0 && { opacity: 0.3 }]}
        >
          <Text style={styles.clearButtonText}>Clear All</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#D0B079" />
          </View>
        ) : notifications.length > 0 ? (
          <FlatList
            data={notifications}
            renderItem={renderNotification}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <Animated.View 
            style={styles.centerContainer}
          >
            <View style={styles.emptyIconWrapper}>
              <Bell size={40} color="#CBD5E1" />
            </View>
            <Text style={styles.emptyTitle}>No new messages</Text>
            <Text style={styles.emptySubtitle}>
              You're all caught up for now.{"\n"}Check back later for updates.
            </Text>
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    letterSpacing: 0.5,
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(208, 176, 121, 0.1)',
  },
  clearButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D0B079',
  },
  content: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  notificationCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  notifTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  timeText: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  dismissButton: {
    padding: 4,
  },
  notifBody: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 16,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  seenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(208, 176, 121, 0.05)',
  },
  seenText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#D0B079',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
  },
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

export default NotificationScreen;
