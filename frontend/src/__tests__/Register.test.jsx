import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Register from '../components/Register';

// Mock the API module
vi.mock('../utils/api', () => ({
  register: vi.fn(),
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, className }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: vi.fn(),
  useLocation: vi.fn(),
}));

import { register } from '../utils/api';

describe('Register Component', () => {
  const mockOnLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders registration form with all required fields', () => {
    render(<Register onLogin={mockOnLogin} />);
    
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/wallet address/i)).toBeInTheDocument();
  });

  it('renders link to login page', () => {
    render(<Register onLogin={mockOnLogin} />);
    
    expect(screen.getByText(/sign in/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('renders account type selector with options', () => {
    render(<Register onLogin={mockOnLogin} />);
    
    expect(screen.getByLabelText(/account type/i)).toBeInTheDocument();
    expect(screen.getByText(/seller - create invoices and receive payments/i)).toBeInTheDocument();
    expect(screen.getByText(/buyer - pay invoices and confirm delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/investor - purchase fractional invoice tokens/i)).toBeInTheDocument();
    expect(screen.getByText(/shipper - track and update shipment status/i)).toBeInTheDocument();
  });

  it('defaults to seller role', () => {
    render(<Register onLogin={mockOnLogin} />);
    
    const roleSelect = screen.getByLabelText(/account type/i);
    expect(roleSelect.value).toBe('seller');
  });

  it('updates form data when user types', () => {
    render(<Register onLogin={mockOnLogin} />);
    
    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/email address/i);
    
    fireEvent.change(firstNameInput, { target: { name: 'firstName', value: 'John' } });
    fireEvent.change(lastNameInput, { target: { name: 'lastName', value: 'Doe' } });
    fireEvent.change(emailInput, { target: { name: 'email', value: 'john@example.com' } });
    
    expect(firstNameInput.value).toBe('John');
    expect(lastNameInput.value).toBe('Doe');
    expect(emailInput.value).toBe('john@example.com');
  });

  it('shows error when passwords do not match', async () => {
    render(<Register onLogin={mockOnLogin} />);
    
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
    const submitButton = screen.getByRole('button', { name: /create account/i });
    
    // Fill required fields
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { name: 'firstName', value: 'John' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { name: 'lastName', value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { name: 'email', value: 'john@example.com' } });
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { name: 'companyName', value: 'Test Co' } });
    fireEvent.change(screen.getByLabelText(/wallet address/i), { target: { name: 'walletAddress', value: '0x123' } });
    
    fireEvent.change(passwordInput, { target: { name: 'password', value: 'password123' } });
    fireEvent.change(confirmPasswordInput, { target: { name: 'confirmPassword', value: 'password456' } });
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
  });

  it('shows loading state when form is submitted', async () => {
    register.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
    
    render(<Register onLogin={mockOnLogin} />);
    
    // Fill all required fields with matching passwords
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { name: 'firstName', value: 'John' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { name: 'lastName', value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { name: 'email', value: 'john@example.com' } });
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { name: 'companyName', value: 'Test Co' } });
    fireEvent.change(screen.getByLabelText(/wallet address/i), { target: { name: 'walletAddress', value: '0x123' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { name: 'password', value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { name: 'confirmPassword', value: 'password123' } });
    
    const submitButton = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitButton);
    
    expect(screen.getByText(/creating account/i)).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
  });

  it('calls onLogin on successful registration', async () => {
    const mockUser = { id: 1, email: 'john@example.com' };
    register.mockResolvedValue({ data: { user: mockUser } });
    
    render(<Register onLogin={mockOnLogin} />);
    
    // Fill all required fields
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { name: 'firstName', value: 'John' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { name: 'lastName', value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { name: 'email', value: 'john@example.com' } });
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { name: 'companyName', value: 'Test Co' } });
    fireEvent.change(screen.getByLabelText(/wallet address/i), { target: { name: 'walletAddress', value: '0x123' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { name: 'password', value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { name: 'confirmPassword', value: 'password123' } });
    
    const submitButton = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(register).toHaveBeenCalled();
      expect(mockOnLogin).toHaveBeenCalledWith(mockUser);
    });
  });

  it('displays error message on registration failure', async () => {
    const errorMessage = 'Email already exists';
    register.mockRejectedValue({
      response: { data: { error: errorMessage } }
    });
    
    render(<Register onLogin={mockOnLogin} />);
    
    // Fill all required fields
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { name: 'firstName', value: 'John' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { name: 'lastName', value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { name: 'email', value: 'john@example.com' } });
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { name: 'companyName', value: 'Test Co' } });
    fireEvent.change(screen.getByLabelText(/wallet address/i), { target: { name: 'walletAddress', value: '0x123' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { name: 'password', value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { name: 'confirmPassword', value: 'password123' } });
    
    const submitButton = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it('displays generic error message when no specific error provided', async () => {
    register.mockRejectedValue({});
    
    render(<Register onLogin={mockOnLogin} />);
    
    // Fill all required fields
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { name: 'firstName', value: 'John' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { name: 'lastName', value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { name: 'email', value: 'john@example.com' } });
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { name: 'companyName', value: 'Test Co' } });
    fireEvent.change(screen.getByLabelText(/wallet address/i), { target: { name: 'walletAddress', value: '0x123' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { name: 'password', value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { name: 'confirmPassword', value: 'password123' } });
    
    const submitButton = screen.getByRole('button', { name: /create account/i });
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText(/registration failed/i)).toBeInTheDocument();
    });
  });

  it('renders brand information and feature cards', () => {
    render(<Register onLogin={mockOnLogin} />);
    
    expect(screen.getByText(/join the platform built for supply chain payments/i)).toBeInTheDocument();
    expect(screen.getByText(/secure escrow/i)).toBeInTheDocument();
    expect(screen.getByText(/instant settlement/i)).toBeInTheDocument();
    expect(screen.getByText(/full transparency/i)).toBeInTheDocument();
  });
});
