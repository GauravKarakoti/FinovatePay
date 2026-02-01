import { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
const StatsContext = createContext(null);

const initialStats = {
  totalInvoices: 0,
  activeEscrows: 0,
  completed: 0,
  produceLots: 0,
};

const statsReducer = (state, action) => {
  switch (action.type) {
    case 'setTotals':
      return { ...state, ...action.payload };
    case 'reset':
      return initialStats;
    default:
      return state;
  }
};

export const StatsProvider = ({ children }) => {
  const [stats, dispatch] = useReducer(statsReducer, initialStats);

  const setStats = useCallback((next) => {
    dispatch({ type: 'setTotals', payload: next });
  }, []);

  const resetStats = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);

  const contextValue = useMemo(() => ({
    stats,
    setStats,
    resetStats,
  }), [stats, setStats, resetStats]);

  return (
    <StatsContext.Provider value={contextValue}>
      {children}
    </StatsContext.Provider>
  );
};

const useStatsContext = () => {
  const context = useContext(StatsContext);
  if (!context) {
    throw new Error('Stats context is unavailable outside of StatsProvider');
  }
  return context;
};

export const useStats = () => {
  return useStatsContext().stats;
};

export const useStatsActions = () => {
  const { setStats, resetStats } = useStatsContext();
  return { setStats, resetStats };
};
