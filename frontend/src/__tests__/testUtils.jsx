import { vi } from 'vitest';
import React from 'react';

// Mock react-router-dom
const mockNavigate = vi.fn();
const mockLocation = { state: null };

export const MemoryRouter = ({ children }) => children;

export const useNavigate = () => mockNavigate;

export const useLocation = () => mockLocation;

export const Link = ({ to, children, className }) => (
  <a href={to} className={className}>
    {children}
  </a>
);

export const resetMocks = () => {
  mockNavigate.mockClear();
};

// Export navigate for assertions
export { mockNavigate };
