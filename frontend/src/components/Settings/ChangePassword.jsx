import { useState } from 'react';
import { changePassword } from '../../utils/api';
import { toast } from 'sonner';

const ChangePassword = () => {
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });

  const validatePassword = (password) => {
    if (password.length < 8) {
      return 'Password must be at least 8 characters';
    }
    if (!/(?=.*[a-z])/.test(password)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/(?=.*[A-Z])/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/(?=.*\d)/.test(password)) {
      return 'Password must contain at least one number';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const passwordError = validatePassword(formData.newPassword);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (formData.currentPassword === formData.newPassword) {
      toast.error('New password must be different from current password');
      return;
    }

    setLoading(true);

    try {
      await changePassword(formData.currentPassword, formData.newPassword);
      toast.success('Password changed successfully!');
      setFormData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (err) {
      toast.error(err.message || 'Failed to change password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const togglePasswordVisibility = (field) => {
    setShowPasswords(prev => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Change Password</h3>
        <p className="mt-1 text-sm text-gray-500">
          Update your password to keep your account secure
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1.5">
            Current password
          </label>
          <div className="relative">
            <input
              id="currentPassword"
              name="currentPassword"
              type={showPasswords.current ? 'text' : 'password'}
              autoComplete="current-password"
              required
              className="block w-full px-4 py-2.5 rounded-lg border border-gray-300 text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-finovate-blue-500 focus:ring-2 focus:ring-finovate-blue-500/20 focus:outline-none sm:text-sm"
              placeholder="Enter current password"
              value={formData.currentPassword}
              onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
            />
            <button
              type="button"
              onClick={() => togglePasswordVisibility('current')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPasswords.current ? (
                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1.5">
            New password
          </label>
          <div className="relative">
            <input
              id="newPassword"
              name="newPassword"
              type={showPasswords.new ? 'text' : 'password'}
              autoComplete="new-password"
              required
              className="block w-full px-4 py-2.5 rounded-lg border border-gray-300 text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-finovate-blue-500 focus:ring-2 focus:ring-finovate-blue-500/20 focus:outline-none sm:text-sm"
              placeholder="Enter new password"
              value={formData.newPassword}
              onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
            />
            <button
              type="button"
              onClick={() => togglePasswordVisibility('new')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPasswords.new ? (
                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            Must be at least 8 characters with uppercase, lowercase, and number
          </p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1.5">
            Confirm new password
          </label>
          <div className="relative">
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showPasswords.confirm ? 'text' : 'password'}
              autoComplete="new-password"
              required
              className="block w-full px-4 py-2.5 rounded-lg border border-gray-300 text-gray-900 placeholder-gray-400 transition-all duration-200 focus:border-finovate-blue-500 focus:ring-2 focus:ring-finovate-blue-500/20 focus:outline-none sm:text-sm"
              placeholder="Confirm new password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            />
            <button
              type="button"
              onClick={() => togglePasswordVisibility('confirm')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPasswords.confirm ? (
                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <button
            type="submit"
            disabled={loading}
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-finovate-blue-600 hover:bg-finovate-blue-700 active:bg-finovate-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-finovate-blue-500 disabled:opacity-60 disabled:pointer-events-none transition-all duration-200 shadow-sm hover:shadow-md inline-flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Updating...
              </>
            ) : (
              'Update password'
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChangePassword;
