import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

const { width } = Dimensions.get('window');

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info' | 'confirm';
  onClose: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
}

const CustomAlert: React.FC<CustomAlertProps> = ({
  visible,
  title,
  message,
  type,
  onClose,
  onConfirm,
  confirmText = 'Continue',
  cancelText = 'Cancel',
}) => {
  const [scale] = React.useState(new Animated.Value(0));

  React.useEffect(() => {
    if (visible) {
      scale.setValue(1);
    } else {
      scale.setValue(0);
    }
  }, [visible]);

  const getIcon = () => {
    switch (type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      case 'confirm': return '❓';
      default: return '🔔';
    }
  };

  const getColors = () => {
    switch (type) {
      case 'success': return ['#10B981', '#059669'];
      case 'error': return ['#EF4444', '#DC2626'];
      case 'warning': return ['#F59E0B', '#D97706'];
      case 'info': return ['#3B82F6', '#2563EB'];
      case 'confirm': return ['#D0B079', '#B8965E'];
      default: return ['#D0B079', '#B8965E'];
    }
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <TouchableOpacity 
        style={styles.overlay} 
        activeOpacity={1} 
        onPress={onClose}
      >
        <TouchableWithoutFeedback>
          <Animated.View style={[styles.alertBox, { transform: [{ scale }] }]}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>

            <LinearGradient colors={getColors()} style={styles.iconCircle}>
              <Text style={styles.iconText}>{getIcon()}</Text>
            </LinearGradient>
            
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
            
            {onConfirm ? (
              <View style={styles.buttonRow}>
                <TouchableOpacity onPress={onClose} style={[styles.button, styles.cancelButton]}>
                  <Text style={styles.cancelButtonText}>{cancelText}</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={() => {
                    onConfirm();
                    onClose();
                  }} 
                  style={[styles.button, styles.confirmButton]}
                >
                  <Text style={styles.buttonText}>{confirmText}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={onClose} style={[styles.button, { width: '100%' }]}>
                <Text style={styles.buttonText}>{confirmText}</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </TouchableWithoutFeedback>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertBox: {
    width: width * 0.85,
    backgroundColor: 'white',
    borderRadius: 30,
    padding: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 15,
    right: 20,
    zIndex: 10,
    padding: 5,
  },
  closeButtonText: {
    fontSize: 22,
    color: '#94A3B8',
    fontWeight: '600',
  },
  iconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -65,
    borderWidth: 5,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  iconText: {
    fontSize: 30,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 25,
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  button: {
    flex: 1,
    height: 52,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmButton: {
    backgroundColor: '#D0B079',
  },
  cancelButton: {
    backgroundColor: '#F1F5F9',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButtonText: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default CustomAlert;
