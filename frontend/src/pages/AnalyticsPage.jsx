import React from 'react';
import AnalyticsDashboard from '../components/Analytics/AnalyticsDashboard';

const AnalyticsPage = ({ activeTab }) => {
  // Get user role from localStorage
  const user = JSON.parse(localStorage.getItem('user'));
  const userRole = user?.role;

  return (
    <div className="p-6">
      <AnalyticsDashboard userRole={userRole} />
    </div>
  );
};

export default AnalyticsPage;
