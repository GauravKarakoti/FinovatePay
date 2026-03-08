const jwt = require('jsonwebtoken');

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      wallet_address: user.wallet_address || user.walletAddress
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

module.exports = { generateToken };
