import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { updateLotLocation } from '../utils/api';
import { Html5Qrcode } from 'html5-qrcode';

const ShipmentDashboard = () => {
    const [scannedLotId, setScannedLotId] = useState(null);
    const [location, setLocation] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Using a ref to hold the scanner instance is correct, but we'll manage it inside the effect.
    const scannerRef = useRef(null);

    // This useEffect hook handles the scanner's lifecycle.
    useEffect(() => {
        const qrCodeRegionId = "qr-reader";
        
        // Initialize the scanner instance
        const html5QrCodeScanner = new Html5Qrcode(qrCodeRegionId);
        scannerRef.current = html5QrCodeScanner;

        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            handleScan(decodedText);
        };

        const config = { 
            fps: 10, 
            qrbox: { width: 250, height: 250 },
            rememberLastUsedCamera: true, // Improves user experience on subsequent loads
        };

        // Start the scanner
        html5QrCodeScanner.start(
            { facingMode: "environment" }, // Prefer the rear camera
            config,
            qrCodeSuccessCallback,
            (errorMessage) => { 
                // This callback is for scan failures, which can be ignored.
            }
        ).catch((err) => {
            console.error("Unable to start scanning.", err);
            toast.error("Could not start QR scanner. Please grant camera permission.");
        });

        // Cleanup function to stop the scanner when the component unmounts
        return () => {
            // The try/catch block is the key to preventing the "transition" error in StrictMode.
            try {
                if (scannerRef.current && scannerRef.current.isScanning) {
                    scannerRef.current.stop()
                        .then(() => console.log("QR Code scanning stopped."))
                        .catch(err => console.error("Failed to stop the scanner cleanly.", err));
                }
            } catch (error) {
                console.warn("Failed to stop scanner, probably due to React StrictMode.", error);
            }
        };
    }, []); // Empty dependency array ensures this runs only once on mount and cleanup on unmount.

    const handleScan = (scannedText) => {
        if (scannedText) {
            try {
                let lotId;
                // Try to parse as JSON first
                try {
                    const scannedData = JSON.parse(scannedText);
                    console.log("Scanned Data:", scannedData);
                    // Check if it's an object with a lotId property
                    if (scannedData && typeof scannedData === 'object' && scannedData.lotId) {
                        lotId = scannedData.lotId;
                    } else {
                        // If it's valid JSON but not the expected object,
                        // stringify it to treat it as a plain ID (e.g., JSON "123" becomes 123)
                        lotId = String(scannedData);
                    }
                } catch (e) {
                    // If parsing fails, assume the whole text is the lotId
                    lotId = scannedText;
                }
                
                if (lotId) {
                    setScannedLotId(lotId);
                    toast.success(`Scanned Lot ID: ${lotId}`);
                } else {
                    toast.error("QR Code does not contain a valid Lot ID.");
                }
            } catch (error) {
                toast.error("Invalid QR Code format.");
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!scannedLotId || !location) {
            toast.error("Please scan a QR code and enter a location.");
            return;
        }

        setIsSubmitting(true);
        try {
            await updateLotLocation({ lotId: String(scannedLotId), location });
            toast.success("Location updated successfully!");
            // Reset the form for the next scan
            setScannedLotId(null);
            setLocation('');
        } catch (error) {
            console.error("Failed to update location:", error);
            toast.error(error.response?.data?.error || "Failed to update location.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="container mx-auto p-4 bg-gray-50 min-h-screen">
            <h2 className="text-3xl font-bold mb-6 text-gray-800 text-center">Shipment & Warehouse Dashboard</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                <div className="bg-white rounded-lg shadow-xl p-6 border border-gray-200">
                    <h3 className="text-xl font-semibold mb-4 text-gray-700">Scan Produce Lot QR Code</h3>
                    <div id="qr-reader" className="w-full rounded-md overflow-hidden"></div>
                    {scannedLotId && (
                        <div className="mt-4 p-3 bg-green-100 border border-green-300 rounded-md">
                            <p className="text-green-800 font-semibold text-center">Scanned Lot ID: {scannedLotId}</p>
                        </div>
                    )}
                </div>
                <div className="bg-white rounded-lg shadow-xl p-6 border border-gray-200">
                    <h3 className="text-xl font-semibold mb-4 text-gray-700">Update Location</h3>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Lot ID</label>
                            <input
                                type="text"
                                value={scannedLotId || 'Scan a QR code...'}
                                readOnly
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">New Location</label>
                            <input
                                type="text"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                                placeholder="e.g., Warehouse A, Shelf 3"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isSubmitting || !scannedLotId || !location}
                            className="w-full bg-indigo-600 text-white font-bold py-2.5 px-4 rounded-md hover:bg-indigo-700 disabled:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
                        >
                            {isSubmitting ? 'Updating...' : 'Update Location'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ShipmentDashboard;
