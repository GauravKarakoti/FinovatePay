import { useState } from 'react';
import { Link } from 'react-router-dom';
import { register } from '../utils/api';

const inputClass =
  'block w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 text-gray-900 placeholder-gray-400 transition-all duration-200 focus:bg-white focus:border-finovate-blue-500 focus:ring-2 focus:ring-finovate-blue-500/20 focus:outline-none sm:text-sm';

const Register = ({ onLogin }) => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    companyName: '',
    walletAddress: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      const { confirmPassword, ...registerData } = formData;
      const response = await register(registerData);
      onLogin(response.data.user);

    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left: Brand panel (hidden on small screens) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-finovate-blue-700 via-finovate-blue-800 to-finovate-blue-900">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-72 h-72 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-32 right-16 w-96 h-96 rounded-full bg-finovate-green-400 blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col justify-center gap-10 p-12 text-white">
          <div className="space-y-6">
            <h2 className="text-3xl xl:text-4xl font-bold leading-tight">
              Join the platform built for supply chain payments.
            </h2>
            <p className="text-finovate-blue-200 text-lg max-w-md">
              Create your account to connect with buyers and sellers, manage escrows, and grow your business with confidence.
            </p>
          </div>
          <p className="text-finovate-blue-300 text-sm">
            © FinovatePay. Built for trust and transparency.
          </p>

          {/* Feature cards */}
          <div className="space-y-4">
            {[
              { icon: '🔒', title: 'Secure Escrow', desc: 'Smart-contract powered payment protection' },
              { icon: '⚡', title: 'Instant Settlement', desc: 'Real-time cross-border transactions' },
              { icon: '📊', title: 'Full Transparency', desc: 'On-chain audit trail for every trade' },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-4 bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <span className="text-2xl">{f.icon}</span>
                <div>
                  <p className="font-semibold text-sm">{f.title}</p>
                  <p className="text-finovate-blue-200 text-sm">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Register form */}
      <div className="w-full lg:w-1/2 flex flex-col bg-gray-50/80 px-6 py-8 sm:px-12 lg:px-16 overflow-y-auto">
        <div className="mx-auto w-full max-w-md flex flex-col min-h-full justify-center py-8">
          {/* Mobile brand */}
          <div className="lg:hidden text-center mb-6">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-finovate-blue-600 to-finovate-blue-800 bg-clip-text text-transparent">
              FinovatePay
            </h1>
          </div>

          <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/60 border border-gray-100 p-8 sm:p-10">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                Create your account
              </h2>
              <p className="mt-1.5 text-gray-500 text-sm">
                Get started with FinovatePay in a few steps.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1.5">
                    First name
                  </label>
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    required
                    className={inputClass}
                    placeholder="Jane"
                    value={formData.firstName}
                    onChange={handleChange}
                  />
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    required
                    className={inputClass}
                    placeholder="Doe"
                    value={formData.lastName}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Company name
                </label>
                <input
                  id="companyName"
                  name="companyName"
                  type="text"
                  autoComplete="organization"
                  required
                  className={inputClass}
                  placeholder="Acme Trading Co."
                  value={formData.companyName}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={inputClass}
                  placeholder="you@example.com"
                  value={formData.email}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label htmlFor="walletAddress" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Wallet address
                </label>
                <input
                  id="walletAddress"
                  name="walletAddress"
                  type="text"
                  required
                  className={inputClass}
                  placeholder="0x..."
                  value={formData.walletAddress}
                  onChange={handleChange}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    className={inputClass}
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={handleChange}
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Confirm password
                  </label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    className={inputClass}
                    placeholder="••••••••"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-100 p-4 flex gap-3">
                  <svg className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm font-medium text-red-800">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center items-center gap-2 py-3.5 px-4 rounded-xl text-sm font-semibold text-white bg-finovate-blue-600 hover:bg-finovate-blue-700 active:bg-finovate-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-finovate-blue-500 disabled:opacity-60 disabled:pointer-events-none transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Creating account...
                  </>
                ) : (
                  'Create account'
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-500">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-semibold text-finovate-blue-600 hover:text-finovate-blue-700 transition-colors"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
