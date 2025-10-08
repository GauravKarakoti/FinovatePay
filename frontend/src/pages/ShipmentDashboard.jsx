import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { updateLotLocation } from '../utils/api';
import { BrowserMultiFormatReader } from '@zxing/browser';

const ShipmentDashboard = () => {
    const [scannedLotId, setScannedLotId] = useState(null);
    const [location, setLocation] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const videoRef = useRef(null);

    useEffect(() => {
        const codeReader = new BrowserMultiFormatReader();
        let selectedDeviceId;

        codeReader.listVideoInputDevices()
            .then((videoInputDevices) => {
                if (videoInputDevices.length > 0) {
                    selectedDeviceId = videoInputDevices[0].deviceId;
                    
                    codeReader.decodeFromVideoDevice(selectedDeviceId, videoRef.current, (result, err) => {
                        if (result) {
                            handleScan(result.getText());
                        }
                        if (err && !(err instanceof DOMException)) {
                            console.error(err);
                            toast.error("Error scanning QR Code.");
                        }
                    });
                } else {
                    toast.error("No camera found.");
                }
            })
            .catch((err) => {
                console.error(err);
                toast.error("Could not access camera.");
            });
            
        return () => {
            codeReader.reset();
        };
    }, []);

    const handleScan = (scannedText) => {
        if (scannedText) {
            try {
                const scannedData = JSON.parse(scannedText);
                if (scannedData.lotId) {
                    setScannedLotId(scannedData.lotId);
                    toast.success(`Scanned Lot ID: ${scannedData.lotId}`);
                }
            } catch (error) {
                toast.error("Invalid QR Code. Please scan a valid invoice QR code.");
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
            await updateLotLocation({ lotId: scannedLotId, location });
            toast.success("Location updated successfully!");
            setScannedLotId(null);
            setLocation('');
        } catch (error) {
            toast.error("Failed to update location.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="container mx-auto p-4">
            <h2 className="text-2xl font-bold mb-6">Shipment & Warehouse Dashboard</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-xl font-semibold mb-4">Scan Invoice QR Code</h3>
                    <video ref={videoRef} style={{ width: '100%', border: '1px solid gray' }} />
                    {scannedLotId && (
                        <p className="mt-4 text-green-600 font-semibold">Scanned Lot ID: {scannedLotId}</p>
                    )}
                </div>
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-xl font-semibold mb-4">Update Location</h3>
                    <form onSubmit={handleSubmit}>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Lot ID</label>
                            <input
                                type="text"
                                value={scannedLotId || ''}
                                readOnly
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                            <input
                                type="text"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                placeholder="e.g., Warehouse A, Shelf 3"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isSubmitting || !scannedLotId || !location}
                            className="btn-primary w-full"
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