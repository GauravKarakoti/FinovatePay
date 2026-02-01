import { createContext, useContext, useReducer, useCallback } from 'react';

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

  return (
    <StatsContext.Provider value={{ stats, dispatch, setStats }}>
      {children}
    </StatsContext.Provider>
  );
};

export const useStats = () => {
  const context = useContext(StatsContext);
  if (!context) {
    throw new Error('useStats must be used within a StatsProvider');
  }
  return context;
};
