import React from 'react';
// Import the specific canvas component to ensure correctness
import { QRCodeCanvas } from 'qrcode.react';

const ProduceQRCode = ({ lotId, produceType, origin }) => {
  const qrValue = `${window.location.origin}/produce/${lotId}`;
  
  const downloadQRCode = () => {
    // Access the canvas via its unique ID for reliability
    const canvas = document.getElementById("qr-code-canvas");
    if (!canvas) return;
    
    const pngUrl = canvas.toDataURL("image/png");
    const downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = `produce-${lotId}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 text-center">
      <h3 className="text-lg font-semibold mb-4">Produce Tracking QR Code</h3>
      
      <div className="flex justify-center mb-4">
        <QRCodeCanvas
          id="qr-code-canvas" // Assign a static ID
          value={qrValue}
          size={200}
          level="H"
          includeMargin={true}
        />
      </div>
      
      <div className="mb-4">
        <p className="text-sm text-gray-600">Lot ID: {lotId}</p>
        <p className="text-sm text-gray-600">Produce: {produceType}</p>
        <p className="text-sm text-gray-600">Origin: {origin}</p>
      </div>
      
      <button
        onClick={downloadQRCode}
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
      >
        Download QR Code
      </button>
      
      <p className="text-xs text-gray-500 mt-3">
        Consumers can scan this code to view the complete history of this produce
      </p>
    </div>
  );
};

export default ProduceQRCode;