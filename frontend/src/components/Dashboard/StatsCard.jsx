import React from 'react';

const StatsCard = ({ title, value, change, icon, color = 'blue' }) => {
  const colorClasses = {
    blue: 'bg-finovate-blue-100 text-finovate-blue-800',
    green: 'bg-finovate-green-100 text-finovate-green-800',
    orange: 'bg-orange-100 text-orange-800',
    purple: 'bg-purple-100 text-purple-800',
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 flex items-center">
      <div className={`p-3 rounded-full ${colorClasses[color]} mr-4`}>
        <span className="text-xl">{icon}</span>
      </div>
      <div>
        <h3 className="text-sm text-gray-500">{title}</h3>
        <p className="text-2xl font-bold">{value}</p>
        {change && (
          <p className={`text-xs ${change > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {change > 0 ? '↑' : '↓'} {Math.abs(change)}% from last month
          </p>
        )}
      </div>
    </div>
  );
};

export default StatsCard;