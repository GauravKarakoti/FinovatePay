/**
 * Manual Test Script for Issue #125
 * Tests that password hashes are NOT exposed in auth API responses
 * 
 * Run with: node backend/test-password-exposure.js
 * Make sure the backend server is running on port 3000
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';
const testEmail = `test-${Date.now()}@example.com`;
const testPassword = 'TestPassword123!';
const testWallet = `0x${Math.random().toString(16).substr(2, 40)}`;

console.log('🔒 Testing Password Hash Exposure (Issue #125)\n');
console.log('=' .repeat(60));

async function testRegister() {
  console.log('\n📝 Test 1: Register Endpoint');
  console.log('-'.repeat(60));
  
  try {
    const response = await axios.post(`${API_BASE}/auth/register`, {
      email: testEmail,
      password: testPassword,
      walletAddress: testWallet,
      company_name: 'Test Company',
      tax_id: 'TEST123',
      first_name: 'Test',
      last_name: 'User'
    });

    const { user, token } = response.data;
    
    console.log('✅ Registration successful');
    console.log(`   User ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    
    // Check for password_hash exposure
    if (user.password_hash || user.password) {
      console.log('❌ SECURITY ISSUE: password_hash found in response!');
      console.log('   Response:', JSON.stringify(user, null, 2));
      return { passed: false, token };
    } else {
      console.log('✅ SECURE: No password_hash in response');
      return { passed: true, token };
    }
  } catch (error) {
    console.log('❌ Test failed:', error.response?.data || error.message);
    return { passed: false, token: null };
  }
}

async function testLogin() {
  console.log('\n🔐 Test 2: Login Endpoint');
  console.log('-'.repeat(60));
  
  try {
    const response = await axios.post(`${API_BASE}/auth/login`, {
      email: testEmail,
      password: testPassword
    });

    const { user, token } = response.data;
    
    console.log('✅ Login successful');
    console.log(`   User ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    
    // Check for password_hash exposure
    if (user.password_hash || user.password) {
      console.log('❌ SECURITY ISSUE: password_hash found in response!');
      console.log('   Response:', JSON.stringify(user, null, 2));
      return { passed: false, token };
    } else {
      console.log('✅ SECURE: No password_hash in response');
      return { passed: true, token };
    }
  } catch (error) {
    console.log('❌ Test failed:', error.response?.data || error.message);
    return { passed: false, token: null };
  }
}

async function testProfile(token) {
  console.log('\n👤 Test 3: Profile Endpoint');
  console.log('-'.repeat(60));
  
  try {
    const response = await axios.get(`${API_BASE}/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const user = response.data;
    
    console.log('✅ Profile fetch successful');
    console.log(`   User ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    
    // Check for password_hash exposure
    if (user.password_hash || user.password) {
      console.log('❌ SECURITY ISSUE: password_hash found in response!');
      console.log('   Response:', JSON.stringify(user, null, 2));
      return false;
    } else {
      console.log('✅ SECURE: No password_hash in response');
      return true;
    }
  } catch (error) {
    console.log('❌ Test failed:', error.response?.data || error.message);
    return false;
  }
}

async function testRoleUpdate(token) {
  console.log('\n🔄 Test 4: Role Update Endpoint');
  console.log('-'.repeat(60));
  
  try {
    const response = await axios.put(`${API_BASE}/auth/role`, 
      { role: 'seller' },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const { user } = response.data;
    
    console.log('✅ Role update successful');
    console.log(`   User ID: ${user.id}`);
    console.log(`   New Role: ${user.role}`);
    
    // Check for password_hash exposure
    if (user.password_hash || user.password) {
      console.log('❌ SECURITY ISSUE: password_hash found in response!');
      console.log('   Response:', JSON.stringify(user, null, 2));
      return false;
    } else {
      console.log('✅ SECURE: No password_hash in response');
      return true;
    }
  } catch (error) {
    console.log('❌ Test failed:', error.response?.data || error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('\n🚀 Starting Security Tests...\n');
  
  const results = {
    register: false,
    login: false,
    profile: false,
    roleUpdate: false
  };

  // Test 1: Register
  const registerResult = await testRegister();
  results.register = registerResult.passed;
  const token = registerResult.token;

  if (!token) {
    console.log('\n❌ Cannot continue tests without valid token');
    return results;
  }

  // Test 2: Login
  const loginResult = await testLogin();
  results.login = loginResult.passed;

  // Test 3: Profile
  results.profile = await testProfile(token);

  // Test 4: Role Update
  results.roleUpdate = await testRoleUpdate(token);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Register:     ${results.register ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Login:        ${results.login ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Profile:      ${results.profile ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Role Update:  ${results.roleUpdate ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('='.repeat(60));

  const allPassed = Object.values(results).every(r => r === true);
  
  if (allPassed) {
    console.log('\n🎉 ALL TESTS PASSED! Issue #125 is FIXED!');
    console.log('✅ No password hashes are exposed in API responses\n');
  } else {
    console.log('\n⚠️  SOME TESTS FAILED! Security issue still exists\n');
  }

  return results;
}

// Run tests
runAllTests().catch(error => {
  console.error('\n💥 Fatal error:', error.message);
  console.error('\nMake sure:');
  console.error('1. Backend server is running (npm run dev in backend folder)');
  console.error('2. Database is connected');
  console.error('3. Port 3000 is accessible\n');
});
