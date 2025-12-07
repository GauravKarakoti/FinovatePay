import { useState } from 'react';
import { verifyKYC } from '../../utils/api';
import axios from 'axios'; // Using axios directly or import from utils/api

const KYCVerification = ({ user, onVerificationComplete }) => {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dob: '',
    address: '',
    city: '',
    country: '',
    idNumber: '', // Aadhaar Number
    otp: ''
  });
  const [referenceId, setReferenceId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  const getAuthHeader = () => {
    const token = localStorage.getItem('token'); // Or however you store your JWT
    return { headers: { Authorization: `Bearer ${token}` } };
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSendOTP = async () => {
    setLoading(true);
    setError('');
    try {
      // Step 1: Initiate - Send Aadhaar Number
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/kyc/initiate`, 
        { idNumber: formData.idNumber },
        getAuthHeader()
      );
      
      if (response.data.success) {
        setReferenceId(response.data.referenceId);
        setSuccessMsg('OTP sent successfully!');
        setStep(4); // Move to OTP step
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
        { otp: formData.otp, referenceId },
        getAuthHeader()
      );

      if (response.data.success) {
        onVerificationComplete(response.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    setFormData(prev => ({ ...prev, idImage: e.target.files[0] }));
  };

  const handleNext = () => {
    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const apiPayload = {
        // In a real app, you would first upload idImage to a service (like S3)
        // and get a URL to send in the payload.
        // For now, we are assuming id_image_url is handled elsewhere.
        firstName: formData.firstName,
        lastName: formData.lastName,
        dob: formData.dob,
        address: formData.address,
        city: formData.city,
        country: formData.country,
        idType: formData.idType,
        idNumber: formData.idNumber,
      };

      const result = await verifyKYC(apiPayload);

      // FIX: Check for success on the `data` property of the Axios response
      if (result.data.success) {
        onVerificationComplete(result.data);
      } else {
        setError(result.data.message || 'KYC verification failed');
      }
    } catch (err) {
      // Axios errors often have a more specific message in `err.response.data.error`
      const errorMessage = err.response?.data?.error || err.message || 'An error occurred during KYC verification';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Personal Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  First Name
                </label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  name="dob"
                  value={formData.dob}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                  required
                />
              </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Aadhaar Number</label>
                <input
                  type="text"
                  name="idNumber"
                  value={formData.idNumber}
                  onChange={handleChange}
                  maxLength="12"
                  placeholder="Enter 12-digit Aadhaar"
                  className="w-full px-3 py-2 border rounded-md"
                />
             </div>
             <div className="flex justify-end">
               <button
                 type="button"
                 onClick={handleSendOTP}
                 disabled={loading || formData.idNumber.length !== 12}
                 className="px-4 py-2 bg-finovate-blue-600 text-white rounded-md disabled:opacity-50"
               >
                 {loading ? 'Sending...' : 'Send OTP'}
               </button>
             </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleNext}
                className="px-4 py-2 bg-finovate-blue-600 text-white rounded-md hover:bg-finovate-blue-700"
              >
                Next
              </button>
            </div>
          </div>
        );
      
      case 2:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Address Information</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Country
                  </label>
                  <input
                    type="text"
                    name="country"
                    value={formData.country}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                    required
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="px-4 py-2 bg-finovate-blue-600 text-white rounded-md hover:bg-finovate-blue-700"
              >
                Next
              </button>
            </div>
          </div>
        );
      
      case 3:
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Identity Verification</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ID Type
                </label>
                <select
                  name="idType"
                  value={formData.idType}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                >
                  <option value="passport">Passport</option>
                  <option value="drivers_license">Driver's License</option>
                  <option value="national_id">National ID</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ID Number
                </label>
                <input
                  type="text"
                  name="idNumber"
                  value={formData.idNumber}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Upload ID Document
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Upload a clear photo or scan of your ID document
                </p>
              </div>
            </div>
            <div className="flex justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="px-4 py-2 bg-finovate-blue-600 text-white rounded-md hover:bg-finovate-blue-700"
              >
                Next
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-finovate-green-600 text-white rounded-md hover:bg-finovate-green-700 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Submit Verification'}
              </button>
            </div>
          </div>
        );
      
      case 4: // OTP Verification Step
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Enter OTP</h3>
            <p className="text-sm text-gray-600">Please enter the OTP sent to your Aadhaar-linked mobile.</p>
            <div>
              <input
                type="text"
                name="otp"
                value={formData.otp}
                onChange={handleChange}
                placeholder="Enter 6-digit OTP"
                className="w-full px-3 py-2 border rounded-md text-center text-xl tracking-widest"
              />
            </div>
            <div className="flex justify-between items-center">
               <button 
                 type="button" 
                 onClick={() => setStep(1)}
                 className="text-sm text-gray-500 hover:text-gray-700"
               >
                 Change Aadhaar Number
               </button>
               <button
                type="submit"
                onClick={handleVerifyOTP}
                disabled={loading || !formData.otp}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify & Submit'}
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-6">KYC Verification</h2>
      
      <div className="mb-6">
        <div className="flex justify-between mb-2">
          <span className={`text-sm font-medium ${step >= 1 ? 'text-finovate-blue-600' : 'text-gray-500'}`}>
            Personal Info
          </span>
          <span className={`text-sm font-medium ${step >= 2 ? 'text-finovate-blue-600' : 'text-gray-500'}`}>
            Address
          </span>
          <span className={`text-sm font-medium ${step >= 3 ? 'text-finovate-blue-600' : 'text-gray-500'}`}>
            Identity
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-finovate-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          ></div>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-100 text-green-700 rounded-md">{successMsg}</div>}
      
      <form onSubmit={handleSubmit}>
        {renderStep()}
        
        {error && (
          <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-md">
            {error}
          </div>
        )}
      </form>
    </div>
  );
};

export default KYCVerification;