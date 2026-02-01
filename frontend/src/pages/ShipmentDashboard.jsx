import { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'sonner';
import { Html5Qrcode } from 'html5-qrcode';
import { updateLotLocation } from '../utils/api';

// --- Reusable UI Components ---

const LoadingSpinner = ({ size = 'md', className = '' }) => {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className={`animate-spin rounded-full border-b-2 border-indigo-600 ${sizes[size]}`} role="status">
        <span className="sr-only">Loading...</span>
      </div>
    </div>
  );
};

LoadingSpinner.propTypes = { size: PropTypes.oneOf(['sm', 'md', 'lg']), className: PropTypes.string };

const Card = ({ children, className = '', title = null, icon = null }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden ${className}`}>
    {(title || icon) && (
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        {icon && <span className="text-2xl">{icon}</span>}
        {title && <h3 className="text-lg font-semibold text-gray-900">{title}</h3>}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

Card.propTypes = { 
  children: PropTypes.node, 
  className: PropTypes.string,
  title: PropTypes.string,
  icon: PropTypes.string
};

const ActionButton = ({ 
  onClick, 
  children, 
  variant = 'primary', 
  disabled = false, 
  loading = false,
  type = 'button',
  className = '' 
}) => {
  const baseClasses = "w-full px-4 py-3 rounded-lg text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm";
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    success: "bg-green-600 text-white hover:bg-green-700",
    danger: "bg-red-600 text-white hover:bg-red-700"
  };
  
  return (
    <button 
      type={type}
      onClick={onClick} 
      disabled={disabled || loading}
      className={`${baseClasses} ${variants[variant]} ${className}`}
    >
      {loading && <span className="animate-spin">⏳</span>}
      {children}
    </button>
  );
};

ActionButton.propTypes = {
  onClick: PropTypes.func,
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['primary', 'secondary', 'success', 'danger']),
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
  type: PropTypes.oneOf(['button', 'submit', 'reset']),
  className: PropTypes.string
};

const AlertBanner = ({ type = 'info', message, onDismiss }) => {
  const styles = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800'
  };
  
  return (
    <div className={`p-4 rounded-lg border ${styles[type]} flex justify-between items-center`}>
      <span className="text-sm font-medium">{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-lg leading-none hover:opacity-70">×</button>
      )}
    </div>
  );
};

AlertBanner.propTypes = {
  type: PropTypes.oneOf(['info', 'success', 'error', 'warning']),
  message: PropTypes.string.isRequired,
  onDismiss: PropTypes.func
};

// --- QR Scanner Component ---

const QRScanner = ({ onScan, onError }) => {
  const scannerRef = useRef(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasPermission, setHasPermission] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let html5QrCode;

    const initScanner = async () => {
      try {
        // Create instance
        html5QrCode = new Html5Qrcode("qr-reader");

        const config = { 
          fps: 10, 
          qrbox: { width: 250, height: 250 },
          rememberLastUsedCamera: true,
        };

        // Start scanning
        await html5QrCode.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            if (isMounted) onScan(decodedText);
          },
          (errorMessage) => {
            // Scan failures are normal and can be ignored
          }
        );
        
        // Only update state and ref if still mounted
        if (isMounted) {
          scannerRef.current = html5QrCode;
          setIsInitialized(true);
        } else {
          // If unmounted during startup, stop immediately
          html5QrCode.stop().catch(console.warn);
        }

      } catch (err) {
        if (isMounted) {
          console.error("Scanner initialization failed:", err);
          setHasPermission(false);
          onError?.(err);
        }
      }
    };

    initScanner();

    // Cleanup function
    return () => {
      isMounted = false;
      
      // Only stop if the scanner was fully initialized (assigned to ref)
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => {
             try {
               // Optional: Clear the element to remove the video feed UI
               scannerRef.current.clear(); 
             } catch (e) {
               console.warn("Scanner clear error:", e);
             }
          })
          .catch((err) => {
            console.warn("Scanner stop error:", err);
          });
        scannerRef.current = null;
      }
    };
  }, [onScan, onError]);

  if (!hasPermission) {
    return (
      <div className="bg-red-50 border-2 border-dashed border-red-200 rounded-lg p-8 text-center">
        <div className="text-4xl mb-2">📷</div>
        <h4 className="text-red-800 font-semibold mb-1">Camera Access Denied</h4>
        <p className="text-red-600 text-sm">Please allow camera access to scan QR codes</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div id="qr-reader" className="w-full rounded-lg overflow-hidden bg-black"></div>
      {!isInitialized && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-lg">
          <LoadingSpinner size="lg" />
        </div>
      )}
      <div className="absolute inset-0 border-2 border-indigo-500/30 rounded-lg pointer-events-none">
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-indigo-500 rounded-lg"></div>
      </div>
    </div>
  );
};

QRScanner.propTypes = {
  onScan: PropTypes.func.isRequired,
  onError: PropTypes.func
};

// --- Main Component ---

const ShipmentDashboard = () => {
  const [scannedLotId, setScannedLotId] = useState(null);
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [recentUpdates, setRecentUpdates] = useState([]);

  // Parse scanned QR data
  const handleScan = useCallback((scannedText) => {
    if (!scannedText) return;
    
    try {
      let lotId = null;
      
      // Try JSON parsing first
      try {
        const parsed = JSON.parse(scannedText);
        if (parsed?.lotId) {
          lotId = parsed.lotId;
        } else if (typeof parsed === 'string') {
          lotId = parsed;
        }
      } catch {
        // If JSON fails, use raw text
        lotId = scannedText;
      }
      
      if (lotId) {
        setScannedLotId(String(lotId));
        setScanError(null);
        toast.success(`Scanned Lot #${String(lotId).substring(0, 8)}...`, {
          description: 'Ready to update location'
        });
      } else {
        throw new Error('No Lot ID found in QR code');
      }
    } catch (error) {
      console.error('Scan parsing error:', error);
      setScanError('Invalid QR Code format. Please scan a valid produce lot code.');
      toast.error('Invalid QR Code');
    }
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (!scannedLotId || !location.trim()) {
      toast.error('Please scan a QR code and enter a location');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Updating location...');

    try {
      await updateLotLocation({ 
        lotId: String(scannedLotId), 
        location: location.trim() 
      });
      
      // Add to recent updates
      setRecentUpdates(prev => [{
        lotId: scannedLotId,
        location: location.trim(),
        timestamp: new Date().toISOString()
      }, ...prev.slice(0, 4)]); // Keep last 5
      
      toast.success('Location updated successfully!', { 
        id: toastId,
        description: `Lot #${String(scannedLotId).substring(0, 8)}... → ${location.trim()}`
      });
      
      // Reset form
      setScannedLotId(null);
      setLocation('');
    } catch (error) {
      console.error('Update failed:', error);
      toast.error(error.response?.data?.error || 'Failed to update location', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  }, [scannedLotId, location]);

  // Clear scanned data
  const handleClear = useCallback(() => {
    setScannedLotId(null);
    setLocation('');
    setScanError(null);
    toast.info('Scanner reset. Ready for new scan.');
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Shipment & Warehouse Dashboard
          </h1>
          <p className="text-gray-600">
            Scan produce lot QR codes to update their location in real-time
          </p>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Scanner Card */}
          <Card title="QR Code Scanner" icon="📷">
            <QRScanner 
              onScan={handleScan} 
              onError={(err) => setScanError('Camera initialization failed')} 
            />
            
            {scanError && (
              <div className="mt-4">
                <AlertBanner type="error" message={scanError} onDismiss={() => setScanError(null)} />
              </div>
            )}
            
            {scannedLotId && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-green-600 font-semibold uppercase tracking-wide">Scanned Lot</p>
                    <p className="text-lg font-mono font-bold text-green-900">#{scannedLotId}</p>
                  </div>
                  <button 
                    onClick={handleClear}
                    className="text-green-700 hover:text-green-900 text-sm font-medium underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </Card>

          {/* Update Form Card */}
          <Card title="Update Location" icon="📍">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="lotId" className="block text-sm font-medium text-gray-700 mb-1">
                  Lot ID
                </label>
                <input
                  id="lotId"
                  type="text"
                  value={scannedLotId || ''}
                  placeholder="Scan a QR code..."
                  readOnly
                  className={`w-full px-4 py-3 rounded-lg border ${
                    scannedLotId 
                      ? 'bg-green-50 border-green-300 text-green-900 font-mono' 
                      : 'bg-gray-50 border-gray-300 text-gray-400'
                  } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors`}
                />
                {!scannedLotId && (
                  <p className="mt-1 text-xs text-gray-500">Waiting for QR scan...</p>
                )}
              </div>

              <div>
                <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
                  New Location <span className="text-red-500">*</span>
                </label>
                <input
                  id="location"
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g., Warehouse A, Shelf 3, Cold Storage"
                  required
                  disabled={!scannedLotId}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Enter the current physical location of this lot
                </p>
              </div>

              <div className="pt-2 space-y-3">
                <ActionButton
                  type="submit"
                  variant="primary"
                  loading={isSubmitting}
                  disabled={!scannedLotId || !location.trim()}
                >
                  {isSubmitting ? 'Updating Blockchain...' : 'Update Location'}
                </ActionButton>
                
                {scannedLotId && (
                  <ActionButton
                    type="button"
                    variant="secondary"
                    onClick={handleClear}
                    disabled={isSubmitting}
                  >
                    Scan Different Lot
                  </ActionButton>
                )}
              </div>
            </form>
          </Card>
        </div>

        {/* Recent Activity */}
        {recentUpdates.length > 0 && (
          <Card title="Recent Updates" icon="📝" className="mt-6">
            <div className="space-y-3">
              {recentUpdates.map((update, index) => (
                <div 
                  key={`${update.lotId}-${index}`} 
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xs">
                      #{String(update.lotId).slice(-4)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{update.location}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(update.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    Updated
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
          <h4 className="font-semibold text-blue-900 mb-2">How it works</h4>
          <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
            <li>Point your camera at the produce lot QR code</li>
            <li>Wait for the scanner to detect and parse the Lot ID</li>
            <li>Enter the current physical location (warehouse, truck, shelf, etc.)</li>
            <li>Submit to record the location on the blockchain</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default ShipmentDashboard;