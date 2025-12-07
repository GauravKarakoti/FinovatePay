import { useState } from 'react';
import axios from 'axios';

const KYCVerification = ({ user, onVerificationComplete }) => {
  const [step, setStep] = useState(1); // 1: Input Aadhaar, 2: Input OTP
  const [idNumber, setIdNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [referenceId, setReferenceId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  const getAuthHeader = () => {
    const token = localStorage.getItem('token'); 
    return { headers: { Authorization: `Bearer ${token}` } };
  };

  const handleSendOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    if (idNumber.length !== 12) {
        setError('Please enter a valid 12-digit Aadhaar number');
        setLoading(false);
        return;
    }

    try {
      // Step 1: Initiate - Send Aadhaar Number
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/kyc/initiate`, 
        { idNumber },
        getAuthHeader()
      );
      
      if (response.data.success) {
        setReferenceId(response.data.referenceId);
        setSuccessMsg('OTP sent successfully!');
        setStep(2); // Move to OTP step
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      // Step 2: Verify - Send OTP and Reference ID
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/kyc/verify-otp`,
        { otp, referenceId },
        getAuthHeader()
      );

      if (response.data.success) {
        setSuccessMsg('Verification Successful!');
        onVerificationComplete(response.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleChangeAadhaar = () => {
    setStep(1);
    setOtp('');
    setError('');
    setSuccessMsg('');
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-6">Aadhaar KYC Verification</h2>
      
      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-100 text-green-700 rounded-md text-sm">{successMsg}</div>}
      
      {step === 1 ? (
        <form onSubmit={handleSendOTP} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Aadhaar Number</label>
                <input
                  type="text"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, ''))}
                  maxLength="12"
                  placeholder="Enter 12-digit Aadhaar"
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                />
            </div>
            <button
                type="submit"
                disabled={loading || idNumber.length !== 12}
                className="w-full px-4 py-2 bg-finovate-blue-600 text-white rounded-md disabled:opacity-50 hover:bg-finovate-blue-700 transition"
            >
                {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOTP} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Enter OTP</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter 6-digit OTP"
                className="w-full px-3 py-2 border rounded-md text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
              />
              <p className="text-xs text-gray-500 mt-2">
                  OTP sent to mobile linked with Aadhaar ending in {idNumber.slice(-4)}
              </p>
            </div>
            <div className="flex flex-col gap-3">
               <button
                type="submit"
                disabled={loading || !otp}
                className="w-full px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition"
              >
                {loading ? 'Verifying...' : 'Verify & Submit'}
              </button>
               <button 
                 type="button" 
                 onClick={handleChangeAadhaar}
                 className="text-sm text-gray-500 hover:text-gray-700 underline"
               >
                 Change Aadhaar Number
               </button>
            </div>
        </form>
      )}
    </div>
  );
};

export default KYCVerification;